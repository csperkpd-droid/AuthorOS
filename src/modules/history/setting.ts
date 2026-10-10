import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { NotFoundError } from "@/lib/errors";
import { resolveNode, resolveNodes } from "@/modules/story-graph";
import type { AuthorContext } from "@/server/context";
import { assertCanView } from "@/server/policy";

/**
 * Story History of Scene Setting (M15): every place set or taken out of a
 * scene is kept on the scene, in the same transaction as the change, in the
 * field history table (field `setting:<place id>`, the value is the
 * change), like Scene Participation. A record, not earlier text: left out
 * of the text field history and never "restored".
 */

export const SETTING_FIELD = "setting:";

type Tx = Prisma.TransactionClient;

export async function recordSettingChange(
  tx: Tx,
  ctx: AuthorContext,
  sceneId: string,
  placeId: string,
  change: "SET" | "REMOVED",
) {
  await tx.fieldRevision.create({
    data: {
      workspaceId: ctx.workspaceId,
      nodeId: sceneId,
      field: `${SETTING_FIELD}${placeId}`,
      value: JSON.stringify({ change }),
      source: "BEFORE_EDIT",
      createdById: ctx.userId,
    },
  });
}

export type SettingChangeView = {
  id: string;
  /** Null when the place can't be shown (in the Trash, deleted, or not viewable). */
  place: { id: string; name: string; href: string } | null;
  change: "SET" | "REMOVED";
  createdAt: Date;
};

function parseChange(value: string): "SET" | "REMOVED" {
  try {
    return (JSON.parse(value) as { change?: string }).change === "REMOVED" ? "REMOVED" : "SET";
  } catch {
    return "SET";
  }
}

/**
 * Changes to where a scene is set, newest first. Places the reader can't
 * view are never named: the entry stays, without which place it was.
 */
export async function listSettingHistory(
  ctx: AuthorContext,
  sceneId: string,
): Promise<SettingChangeView[]> {
  assertCanView(ctx, "manuscript", { kind: "SCENE", id: sceneId });
  const scene = await resolveNode(ctx, sceneId);
  if (!scene || scene.kind !== "SCENE") throw new NotFoundError("Scene");
  const rows = await db.fieldRevision.findMany({
    where: { workspaceId: ctx.workspaceId, nodeId: sceneId, field: { startsWith: SETTING_FIELD } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { id: true, field: true, value: true, createdAt: true },
    take: 200,
  });
  const places = await resolveNodes(
    ctx,
    rows.map((r) => r.field.slice(SETTING_FIELD.length)),
  );
  return rows.map((r) => {
    const p = places.get(r.field.slice(SETTING_FIELD.length));
    return {
      id: r.id,
      place: p && p.kind === "PLACE" ? { id: p.id, name: p.title, href: p.href } : null,
      change: parseChange(r.value),
      createdAt: r.createdAt,
    };
  });
}
