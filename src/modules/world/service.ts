import "server-only";

import { db } from "@/lib/db";
import { assertNotStale, staleError, type EditGuard } from "@/lib/concurrency";
import { NotFoundError, RuleError } from "@/lib/errors";
import { formatCount } from "@/lib/format";
import { recordFieldHistory } from "@/modules/history";
import { getPenNameForNewWork, requireAssignablePenName } from "@/modules/pen-names";
import {
  createStoryNode,
  livePlace,
  liveScene,
  liveSeries,
  liveWorldEntry,
} from "@/modules/story-graph";
import type { AuthorContext } from "@/server/context";
import { assertCan, assertCanView } from "@/server/policy";

import { SUGGESTED_ENTRY_TYPES } from "./labels";
import { placeInput, worldEntryInput, type PlaceInput, type WorldEntryInput } from "./schemas";

/**
 * World objects (decision 113, M15): places, and world entries (an
 * organization, an item, or any type the author names). Story objects of
 * one pen name, optionally of one of its series, like characters: identities
 * stay private from each other, so they only link within their pen name.
 *
 * - A place's scenes are its Scene Setting (the `setting` module); a world
 *   entry links to other objects through Universal Connections.
 * - Moving to another pen name happens with the book or series it belongs
 *   to, through that move's Change Impact review; on its own, its pen name
 *   only changes while nothing links it to other work (as characters).
 * - Long-form text (summaries) keeps its history; stale forms are refused.
 * - Genre-neutral: a lens over the common model, never a genre data model.
 */

const placeSelect = {
  id: true,
  name: true,
  summary: true,
  updatedAt: true,
  penNameId: true,
  penName: { select: { id: true, name: true } },
  series: { select: { id: true, title: true } },
} as const;

const entrySelect = { ...placeSelect, entryType: true } as const;

export type PlaceSummary = Awaited<ReturnType<typeof getPlace>>;
export type WorldEntrySummary = Awaited<ReturnType<typeof getWorldEntry>>;

// ─── Home: pen name and series ──────────────────────────────────────────────

async function requireSeries(ctx: AuthorContext, seriesId: string) {
  const series = await db.series.findFirst({
    where: { id: seriesId, workspaceId: ctx.workspaceId, ...liveSeries },
    select: { id: true, penNameId: true },
  });
  if (!series) throw new NotFoundError("Series");
  return series;
}

/**
 * Where a world object lives: its identity, and optionally a series of that
 * identity. A series decides the identity; otherwise the given pen name, else
 * the one the author is writing as (or the default).
 */
async function resolveHome(
  ctx: AuthorContext,
  { seriesId, penNameId }: { seriesId?: string | null; penNameId?: string },
) {
  if (seriesId) {
    const series = await requireSeries(ctx, seriesId);
    if (penNameId && penNameId !== series.penNameId)
      throw new RuleError("A series’ world belongs to the series’ pen name.");
    return { seriesId: series.id, penNameId: series.penNameId };
  }
  const pen = penNameId
    ? await requireAssignablePenName(ctx, penNameId)
    : await getPenNameForNewWork(ctx);
  return { seriesId: null, penNameId: pen.id };
}

/** Linked to other work: connections, and for places their scenes. */
async function isLinked(id: string) {
  const [connections, settings] = await Promise.all([
    db.connection.count({ where: { OR: [{ sourceId: id }, { targetId: id }] } }),
    db.sceneSetting.count({ where: { placeId: id } }),
  ]);
  return connections + settings > 0;
}

/** Refuses a change of pen name while the object is linked (no data crosses identities). */
async function assertIdentityChange(id: string, from: string, to: string, noun: string) {
  if (from !== to && (await isLinked(id)))
    throw new RuleError(
      `This ${noun} is linked to scenes or other story objects, so it stays with its pen name. It moves with its book or series when that changes pen name.`,
    );
}

// ─── Places ─────────────────────────────────────────────────────────────────

/**
 * Places with how many scenes are set in each. With `penNameId`, only that
 * identity's places; null = every identity ("All identities").
 */
export async function listPlaces(
  ctx: AuthorContext,
  { penNameId = null }: { penNameId?: string | null } = {},
) {
  assertCanView(ctx, "storyBible");
  const rows = await db.place.findMany({
    where: { workspaceId: ctx.workspaceId, ...livePlace, ...(penNameId ? { penNameId } : {}) },
    orderBy: { name: "asc" },
    select: placeSelect,
  });
  const settings = await db.sceneSetting.groupBy({
    by: ["placeId"],
    where: {
      workspaceId: ctx.workspaceId,
      placeId: { in: rows.map((r) => r.id) },
      // Scenes in the Trash don't count.
      scene: liveScene,
    },
    _count: true,
  });
  const counts = new Map(settings.map((s) => [s.placeId, s._count]));
  return rows.map((r) => ({ ...r, sceneCount: counts.get(r.id) ?? 0 }));
}

export async function getPlace(ctx: AuthorContext, id: string) {
  assertCanView(ctx, "storyBible", { kind: "PLACE", id });
  const row = await db.place.findFirst({
    where: { id, workspaceId: ctx.workspaceId, ...livePlace },
    select: placeSelect,
  });
  if (!row) throw new NotFoundError("Place");
  return row;
}

export async function createPlace(ctx: AuthorContext, input: PlaceInput) {
  assertCan(ctx, "edit", "storyBible");
  const data = placeInput.parse(input);
  const home = await resolveHome(ctx, data);
  return db.$transaction(async (tx) => {
    const id = await createStoryNode(tx, ctx.workspaceId, "PLACE");
    return tx.place.create({
      data: {
        id,
        workspaceId: ctx.workspaceId,
        ...home,
        name: data.name,
        summary: data.summary ?? null,
      },
      select: { id: true },
    });
  });
}

/**
 * Updates a place. Its series may change within its identity, as long as the
 * scenes set in it stay in that series' books; its identity only while
 * nothing links it to other work.
 */
export async function updatePlace(
  ctx: AuthorContext,
  id: string,
  input: PlaceInput,
  guard: EditGuard = {},
) {
  assertCan(ctx, "edit", "storyBible");
  const data = placeInput.parse(input);
  const current = await getPlace(ctx, id);
  const home = await resolveHome(ctx, {
    seriesId: data.seriesId,
    penNameId: data.penNameId ?? (data.seriesId ? undefined : current.penNameId),
  });
  await assertIdentityChange(id, current.penNameId, home.penNameId, "place");
  if (home.seriesId && home.seriesId !== (current.series?.id ?? null)) {
    const outside = await db.sceneSetting.count({
      where: {
        workspaceId: ctx.workspaceId,
        placeId: id,
        scene: { book: { OR: [{ seriesId: null }, { seriesId: { not: home.seriesId } }] } },
      },
    });
    if (outside > 0)
      throw new RuleError(
        `${formatCount(outside, "scene")} set in ${current.name} ${outside === 1 ? "is" : "are"} outside that series. Take the place out of those scenes first, or keep its series.`,
      );
  }
  await db.$transaction(async (tx) => {
    const row = await tx.place.findUniqueOrThrow({
      where: { id },
      select: { summary: true, updatedAt: true },
    });
    assertNotStale(row.updatedAt, guard.expectedUpdatedAt, "place");
    await recordFieldHistory(tx, ctx, id, row, { summary: data.summary ?? null });
    const { count } = await tx.place.updateMany({
      where: { id, updatedAt: row.updatedAt },
      data: { ...home, name: data.name, summary: data.summary ?? null },
    });
    if (count === 0) throw staleError("place");
  });
}

/** Moves a place to the Trash; the scenes set in it come back to it when restored. */
export async function trashPlace(ctx: AuthorContext, id: string) {
  assertCan(ctx, "edit", "storyBible");
  await getPlace(ctx, id);
  await db.place.update({ where: { id }, data: { deletedAt: new Date() } });
}

// ─── World entries ──────────────────────────────────────────────────────────

/** World entries, by type then name. `penNameId` as for places. */
export async function listWorldEntries(
  ctx: AuthorContext,
  { penNameId = null }: { penNameId?: string | null } = {},
) {
  assertCanView(ctx, "storyBible");
  return db.worldEntry.findMany({
    where: {
      workspaceId: ctx.workspaceId,
      ...liveWorldEntry,
      ...(penNameId ? { penNameId } : {}),
    },
    orderBy: [{ entryType: "asc" }, { name: "asc" }],
    select: entrySelect,
  });
}

export async function getWorldEntry(ctx: AuthorContext, id: string) {
  assertCanView(ctx, "storyBible", { kind: "WORLD_ENTRY", id });
  const row = await db.worldEntry.findFirst({
    where: { id, workspaceId: ctx.workspaceId, ...liveWorldEntry },
    select: entrySelect,
  });
  if (!row) throw new NotFoundError("World entry");
  return row;
}

/**
 * The types to offer: the suggestions, then the ones the author already
 * uses (their spelling), without repeats ignoring case.
 */
export async function listWorldEntryTypes(ctx: AuthorContext): Promise<string[]> {
  assertCanView(ctx, "storyBible");
  const used = await db.worldEntry.findMany({
    where: { workspaceId: ctx.workspaceId, ...liveWorldEntry },
    distinct: ["entryType"],
    orderBy: { entryType: "asc" },
    select: { entryType: true },
  });
  const types = new Map<string, string>();
  for (const t of [...SUGGESTED_ENTRY_TYPES, ...used.map((u) => u.entryType)])
    if (!types.has(t.toLowerCase())) types.set(t.toLowerCase(), t);
  return [...types.values()];
}

export async function createWorldEntry(ctx: AuthorContext, input: WorldEntryInput) {
  assertCan(ctx, "edit", "storyBible");
  const data = worldEntryInput.parse(input);
  const home = await resolveHome(ctx, data);
  return db.$transaction(async (tx) => {
    const id = await createStoryNode(tx, ctx.workspaceId, "WORLD_ENTRY");
    return tx.worldEntry.create({
      data: {
        id,
        workspaceId: ctx.workspaceId,
        ...home,
        entryType: data.entryType,
        name: data.name,
        summary: data.summary ?? null,
      },
      select: { id: true },
    });
  });
}

/** Updates a world entry; its identity only changes while nothing links it to other work. */
export async function updateWorldEntry(
  ctx: AuthorContext,
  id: string,
  input: WorldEntryInput,
  guard: EditGuard = {},
) {
  assertCan(ctx, "edit", "storyBible");
  const data = worldEntryInput.parse(input);
  const current = await getWorldEntry(ctx, id);
  const home = await resolveHome(ctx, {
    seriesId: data.seriesId,
    penNameId: data.penNameId ?? (data.seriesId ? undefined : current.penNameId),
  });
  await assertIdentityChange(id, current.penNameId, home.penNameId, "world entry");
  await db.$transaction(async (tx) => {
    const row = await tx.worldEntry.findUniqueOrThrow({
      where: { id },
      select: { summary: true, updatedAt: true },
    });
    assertNotStale(row.updatedAt, guard.expectedUpdatedAt, "world entry");
    await recordFieldHistory(tx, ctx, id, row, { summary: data.summary ?? null });
    const { count } = await tx.worldEntry.updateMany({
      where: { id, updatedAt: row.updatedAt },
      data: {
        ...home,
        entryType: data.entryType,
        name: data.name,
        summary: data.summary ?? null,
      },
    });
    if (count === 0) throw staleError("world entry");
  });
}

export async function trashWorldEntry(ctx: AuthorContext, id: string) {
  assertCan(ctx, "edit", "storyBible");
  await getWorldEntry(ctx, id);
  await db.worldEntry.update({ where: { id }, data: { deletedAt: new Date() } });
}
