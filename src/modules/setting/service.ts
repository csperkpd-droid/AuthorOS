import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { ConflictError, NotFoundError, RuleError } from "@/lib/errors";
import { recordSettingChange } from "@/modules/history";
import { resolveNode, resolveNodes, sameIdentity, type NodeSummary } from "@/modules/story-graph";
import { createPlace } from "@/modules/world";
import type { AuthorContext } from "@/server/context";
import { assertCan, assertCanView } from "@/server/policy";

import { newPlaceName } from "./schemas";

/**
 * Scene Setting (decision 113, M15): where a scene takes place. A dedicated
 * relationship (`scene_settings`), not a Universal Connection.
 *
 * Rules, enforced here and by the database:
 * - The author's statement: never inferred from the manuscript text, and
 *   changing it never touches the text. A scene may be set in several places.
 * - Places and scenes keep their identity rules: same pen name, and a
 *   series' places only in that series' books.
 * - Changing it needs edit rights on the manuscript; reading it goes through
 *   the Story Graph, so places or scenes in the Trash or not viewable are
 *   not shown (and come back when restored). Nothing is removed by the Trash.
 * - Every change is kept in the scene's Story History.
 */

async function requireScene(ctx: AuthorContext, sceneId: string) {
  const scene = await resolveNode(ctx, sceneId);
  if (!scene || scene.kind !== "SCENE") throw new NotFoundError("Scene");
  return scene;
}

async function requirePlace(ctx: AuthorContext, placeId: string) {
  const place = await resolveNode(ctx, placeId);
  if (!place || place.kind !== "PLACE") throw new NotFoundError("Place");
  return place;
}

function isUniqueViolation(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

// ─── Reads ──────────────────────────────────────────────────────────────────

/** Where a scene is set, by name. Places the reader can't view are left out. */
export async function listScenePlaces(ctx: AuthorContext, sceneId: string): Promise<NodeSummary[]> {
  assertCanView(ctx, "manuscript", { kind: "SCENE", id: sceneId });
  await requireScene(ctx, sceneId);
  const rows = await db.sceneSetting.findMany({
    where: { workspaceId: ctx.workspaceId, sceneId },
    select: { placeId: true },
  });
  const places = await resolveNodes(
    ctx,
    rows.map((r) => r.placeId),
  );
  return [...places.values()].sort((a, b) => a.title.localeCompare(b.title));
}

/**
 * The scenes set in a place, in manuscript order (book, chapter, scene).
 * Scenes the reader can't view (Trash, other access) are left out.
 */
export async function listPlaceScenes(ctx: AuthorContext, placeId: string): Promise<NodeSummary[]> {
  assertCanView(ctx, "storyBible", { kind: "PLACE", id: placeId });
  await requirePlace(ctx, placeId);
  const rows = await db.sceneSetting.findMany({
    where: { workspaceId: ctx.workspaceId, placeId },
    orderBy: [
      { scene: { book: { title: "asc" } } },
      { scene: { chapter: { position: "asc" } } },
      { scene: { position: "asc" } },
    ],
    select: { sceneId: true },
  });
  const scenes = await resolveNodes(
    ctx,
    rows.map((r) => r.sceneId),
  );
  return rows.flatMap((r) => scenes.get(r.sceneId) ?? []);
}

// ─── Changes ────────────────────────────────────────────────────────────────

/** Sets a scene in a place (in addition to any others). */
export async function setScenePlace(ctx: AuthorContext, sceneId: string, placeId: string) {
  assertCan(ctx, "edit", "manuscript");
  const [scene, place] = await Promise.all([
    requireScene(ctx, sceneId),
    requirePlace(ctx, placeId),
  ]);
  if (!sameIdentity(scene, place))
    throw new RuleError(
      `${place.title} belongs to another pen name, so this scene can’t be set there.`,
    );
  if (place.seriesId && place.seriesId !== scene.seriesId)
    throw new RuleError(
      `${place.title} belongs to a series, so only that series’ scenes can be set there.`,
    );
  try {
    await db.$transaction(async (tx) => {
      const existing = await tx.sceneSetting.findUnique({
        where: { sceneId_placeId: { sceneId, placeId } },
        select: { placeId: true },
      });
      if (existing) throw new ConflictError(`This scene is already set in ${place.title}.`);
      await tx.sceneSetting.create({
        data: { workspaceId: ctx.workspaceId, sceneId, placeId, createdById: ctx.userId },
      });
      await recordSettingChange(tx, ctx, sceneId, placeId, "SET");
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    throw new ConflictError(`This scene is already set in ${place.title}.`);
  }
}

/**
 * Creates a place from a name and sets the scene there (the place joins the
 * scene's pen name and series).
 */
export async function setSceneInNewPlace(ctx: AuthorContext, sceneId: string, name: string) {
  assertCan(ctx, "edit", "manuscript");
  const scene = await requireScene(ctx, sceneId);
  const home = scene.seriesId
    ? { seriesId: scene.seriesId }
    : { penNameId: scene.penNameId ?? undefined };
  const { id } = await createPlace(ctx, { name: newPlaceName.parse(name), ...home });
  await setScenePlace(ctx, sceneId, id);
  return { id };
}

/** Takes a place out of a scene's setting. The place and the scene are untouched. */
export async function removeScenePlace(ctx: AuthorContext, sceneId: string, placeId: string) {
  assertCan(ctx, "edit", "manuscript");
  await requireScene(ctx, sceneId);
  await requirePlace(ctx, placeId);
  await db.$transaction(async (tx) => {
    const { count } = await tx.sceneSetting.deleteMany({
      where: { workspaceId: ctx.workspaceId, sceneId, placeId },
    });
    if (count === 0) throw new NotFoundError("Place in this scene");
    await recordSettingChange(tx, ctx, sceneId, placeId, "REMOVED");
  });
}
