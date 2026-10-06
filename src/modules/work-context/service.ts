import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { NotFoundError } from "@/lib/errors";
import type { PlaceAnchor } from "@/lib/work-place";
import { resolveNode, resolveNodes } from "@/modules/story-graph";
import type { AuthorContext } from "@/server/context";
import { assertCanView } from "@/server/policy";

import { placeAnchorInput } from "./schemas";

/**
 * Work Context (M10): the member's own working place. It is navigation
 * state, never story data and never an authorization: every read goes
 * through the Story Graph funnel, so a place the member can no longer view
 * simply isn't there (nothing about it is revealed).
 */

export type WritingPlace = {
  sceneId: string;
  href: string;
  title: string;
  /** Book › chapter. */
  context: string | null;
  anchor: PlaceAnchor | null;
};

/**
 * Continue Writing: the scene this member last wrote in, with where they
 * were. Null when there is none, or it's in the Trash, deleted, or no
 * longer viewable (all the same to the caller).
 */
export async function getWritingPlace(ctx: AuthorContext): Promise<WritingPlace | null> {
  assertCanView(ctx, "manuscript");
  const member = await db.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId: ctx.workspaceId, userId: ctx.userId } },
    select: { writingSceneId: true, writingAnchor: true },
  });
  if (!member?.writingSceneId) return null;
  const scene = await resolveNode(ctx, member.writingSceneId);
  if (!scene || scene.kind !== "SCENE") return null;
  const anchor = placeAnchorInput.safeParse(member.writingAnchor);
  return {
    sceneId: scene.id,
    href: scene.href,
    title: scene.title,
    context: scene.context,
    anchor: anchor.success ? anchor.data : null,
  };
}

/**
 * Records where this member is writing (a scene they can view). The
 * member's own state: no role needed beyond viewing the scene.
 */
export async function setWritingPlace(
  ctx: AuthorContext,
  sceneId: string,
  anchor: PlaceAnchor | null,
) {
  assertCanView(ctx, "manuscript", { kind: "SCENE", id: sceneId });
  const data = anchor === null ? null : placeAnchorInput.parse(anchor);
  const scene = await resolveNode(ctx, sceneId);
  if (!scene || scene.kind !== "SCENE") throw new NotFoundError("Item");
  await db.workspaceMember.update({
    where: { workspaceId_userId: { workspaceId: ctx.workspaceId, userId: ctx.userId } },
    data: { writingSceneId: sceneId, writingAnchor: data ?? Prisma.DbNull, writingAt: new Date() },
  });
}

export type WorkPlace = { id: string; title: string; context: string | null; href: string };

/**
 * Return to Work: the current titles of the given working places (scenes
 * and notes), only those this member can view. Titles come from here, never
 * from the browser, so nothing is shown about a place that is gone.
 */
export async function listWorkPlaces(ctx: AuthorContext, ids: string[]): Promise<WorkPlace[]> {
  assertCanView(ctx, "any");
  const nodes = await resolveNodes(ctx, ids.slice(0, 20));
  return [...nodes.values()]
    .filter((n) => n.kind === "SCENE" || n.kind === "NOTE")
    .map((n) => ({ id: n.id, title: n.title, context: n.context, href: n.href }));
}
