import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { NotFoundError } from "@/lib/errors";
import { resolveNode, resolveNodes } from "@/modules/story-graph";
import type { AuthorContext } from "@/server/context";
import { assertCanView } from "@/server/policy";

/**
 * Story History of Scene Participation (M11): every change to who is in a
 * scene (added, removed, presence changed, point of view given or taken)
 * is kept on the scene, in the same transaction as the change. It uses the
 * field history table (`field_revisions`, field `participation:<character
 * id>`, the value is the change), so there is one history store. These
 * entries are a record, not earlier text: they are left out of the text
 * field history and can't be "restored" (changes go through the
 * participation actions and their point-of-view rule).
 */

export const PARTICIPATION_FIELD = "participation:";

export type ParticipationSnapshot = { presence: "PRESENT" | "MENTIONED"; pov: boolean } | null;

type Tx = Prisma.TransactionClient;

export async function recordParticipationChange(
  tx: Tx,
  ctx: AuthorContext,
  sceneId: string,
  characterId: string,
  from: ParticipationSnapshot,
  to: ParticipationSnapshot,
) {
  if (JSON.stringify(from) === JSON.stringify(to)) return;
  await tx.fieldRevision.create({
    data: {
      workspaceId: ctx.workspaceId,
      nodeId: sceneId,
      field: `${PARTICIPATION_FIELD}${characterId}`,
      value: JSON.stringify({ from, to }),
      source: "BEFORE_EDIT",
      createdById: ctx.userId,
    },
  });
}

export type ParticipationChangeView = {
  id: string;
  /** Null when the character can't be shown (in the Trash, deleted, or not viewable). */
  character: { id: string; name: string; href: string } | null;
  from: ParticipationSnapshot;
  to: ParticipationSnapshot;
  createdAt: Date;
};

function parseChange(value: string) {
  try {
    const v = JSON.parse(value) as { from?: ParticipationSnapshot; to?: ParticipationSnapshot };
    return { from: v.from ?? null, to: v.to ?? null };
  } catch {
    return { from: null, to: null };
  }
}

/**
 * Changes to who is in a scene, newest first. Characters the reader can't
 * view are never named: the entry stays, without who it was.
 */
export async function listParticipationHistory(
  ctx: AuthorContext,
  sceneId: string,
): Promise<ParticipationChangeView[]> {
  assertCanView(ctx, "manuscript", { kind: "SCENE", id: sceneId });
  const scene = await resolveNode(ctx, sceneId);
  if (!scene || scene.kind !== "SCENE") throw new NotFoundError("Scene");
  const rows = await db.fieldRevision.findMany({
    where: {
      workspaceId: ctx.workspaceId,
      nodeId: sceneId,
      field: { startsWith: PARTICIPATION_FIELD },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { id: true, field: true, value: true, createdAt: true },
    take: 200,
  });
  const characters = await resolveNodes(
    ctx,
    rows.map((r) => r.field.slice(PARTICIPATION_FIELD.length)),
  );
  return rows.map((r) => {
    const c = characters.get(r.field.slice(PARTICIPATION_FIELD.length));
    return {
      id: r.id,
      character: c && c.kind === "CHARACTER" ? { id: c.id, name: c.title, href: c.href } : null,
      ...parseChange(r.value),
      createdAt: r.createdAt,
    };
  });
}
