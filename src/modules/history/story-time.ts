import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { NotFoundError } from "@/lib/errors";
import { resolveNode, resolveNodes } from "@/modules/story-graph";
import type { AuthorContext } from "@/server/context";
import { assertCanView } from "@/server/policy";

/**
 * Story History of a scene's Story Time (M12): placed, moved, label
 * changed, taken out. Kept on the scene in the field history table (field
 * `storyTime`, the change as its value), in the same transaction as the
 * change, like Scene Participation. A record, not earlier text: left out
 * of the text history and not "restorable".
 */

export const STORY_TIME_FIELD = "storyTime";

export type StoryTimeChange =
  | { action: "placed" | "moved"; afterId: string | null; label: string | null }
  | { action: "label"; label: string | null; previousLabel: string | null }
  | { action: "unplaced"; previousLabel: string | null };

export async function recordStoryTimeChange(
  tx: Prisma.TransactionClient,
  ctx: AuthorContext,
  sceneId: string,
  change: StoryTimeChange,
) {
  await tx.fieldRevision.create({
    data: {
      workspaceId: ctx.workspaceId,
      nodeId: sceneId,
      field: STORY_TIME_FIELD,
      value: JSON.stringify(change),
      source: "BEFORE_EDIT",
      createdById: ctx.userId,
    },
  });
}

export type StoryTimeChangeView = {
  id: string;
  change: StoryTimeChange;
  /** What it was placed after, when the reader may see it (null otherwise, or first). */
  after: { id: string; title: string; href: string } | null;
  createdAt: Date;
};

/** A scene's Story Time changes, newest first. Hidden neighbours are never named. */
export async function listStoryTimeHistory(
  ctx: AuthorContext,
  sceneId: string,
): Promise<StoryTimeChangeView[]> {
  assertCanView(ctx, "manuscript", { kind: "SCENE", id: sceneId });
  const scene = await resolveNode(ctx, sceneId);
  if (!scene || scene.kind !== "SCENE") throw new NotFoundError("Scene");
  const rows = await db.fieldRevision.findMany({
    where: { workspaceId: ctx.workspaceId, nodeId: sceneId, field: STORY_TIME_FIELD },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { id: true, value: true, createdAt: true },
    take: 200,
  });
  const changes = rows.map((r) => ({ ...r, change: JSON.parse(r.value) as StoryTimeChange }));
  const neighbours = await resolveNodes(
    ctx,
    changes.flatMap(({ change }) =>
      "afterId" in change && change.afterId ? [change.afterId] : [],
    ),
  );
  return changes.map(({ id, change, createdAt }) => {
    const n = "afterId" in change && change.afterId ? neighbours.get(change.afterId) : null;
    return { id, change, after: n ? { id: n.id, title: n.title, href: n.href } : null, createdAt };
  });
}
