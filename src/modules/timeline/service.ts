import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { assertNotStale, staleError, type EditGuard } from "@/lib/concurrency";
import { db } from "@/lib/db";
import { ConflictError, NotFoundError, RuleError } from "@/lib/errors";
import {
  planInsertAfter,
  positionAtEnd,
  positionsAfter,
  sortByPosition,
  type Positioned,
} from "@/lib/ordering";
import { recordFieldHistory, recordStoryTimeChange } from "@/modules/history";
import { listCharacterScenes, type ParticipationRole } from "@/modules/participation";
import {
  createStoryNode,
  liveBook,
  liveScene,
  liveSeries,
  liveTimelineEvent,
  resolveNode,
  resolveNodes,
  type NodeSummary,
} from "@/modules/story-graph";
import type { AuthorContext } from "@/server/context";
import { assertCan, assertCanView } from "@/server/policy";

import {
  newTimelineEventInput,
  placementInput,
  storyTimeLabelInput,
  timelineEventInput,
  type NewTimelineEventInput,
  type PlacementInput,
  type StoryTimeLabelInput,
  type TimelineEventInput,
} from "./schemas";

/**
 * Story Time (decision 109, M12): the story's own chronology, separate from
 * reading order (the binder) and from real-world time.
 *
 * - A **timeline** is a standalone book's, or its series' when the book is
 *   in one (derived from the book, never stored). Scenes and timeline
 *   events share its ordering space: fractional positions (`lib/ordering`).
 * - A scene is a single point (`scene_story_times`); no row = not placed
 *   yet. Nothing is ever placed for the author or inferred from the text,
 *   and nothing here changes reading order or manuscript text.
 * - Labels are free-form narrative time ("Day 3, evening"), never dates.
 * - A scene's story time needs manuscript edit rights; timeline events are
 *   story-bible objects. Reads go through the Story Graph funnel.
 * - Every change to a scene's story time is kept in its Story History.
 */

type Client = Prisma.TransactionClient | typeof db;

export type TimelineEntry = {
  kind: "SCENE" | "TIMELINE_EVENT";
  id: string;
  title: string;
  href: string;
  label: string | null;
  /** Book › chapter for scenes; the owning book or series for events. */
  context: string | null;
  /** 1-based position in reading order (scenes only). */
  readingIndex: number | null;
};

export type Timeline = {
  owner: { id: string; kind: "BOOK" | "SERIES"; title: string; href: string };
  /** In story order. */
  entries: TimelineEntry[];
  /** Scenes not placed yet, in reading order. */
  unplaced: TimelineEntry[];
};

// ─── Timelines and their ordering space ────────────────────────────────────

/** The timeline a book belongs to: its series', or its own. All rows, for positions. */
async function timelineOfBook(client: Client, bookId: string) {
  const book = await client.book.findUniqueOrThrow({
    where: { id: bookId },
    select: { seriesId: true },
  });
  return timelineOf(client, book.seriesId ? { seriesId: book.seriesId } : { bookId });
}

async function timelineOf(client: Client, owner: { seriesId: string } | { bookId: string }) {
  const bookIds =
    "seriesId" in owner
      ? (
          await client.book.findMany({ where: { seriesId: owner.seriesId }, select: { id: true } })
        ).map((b) => b.id)
      : [owner.bookId];
  return { seriesId: "seriesId" in owner ? owner.seriesId : null, bookIds };
}

type Item = Positioned & { type: "scene" | "event" };

/** Every positioned row of a timeline (Trash included: positions stay unique). */
async function timelineItems(
  client: Client,
  ctx: AuthorContext,
  t: { seriesId: string | null; bookIds: string[] },
): Promise<Item[]> {
  // Sequential: a transaction client runs one query at a time.
  const scenes = await client.sceneStoryTime.findMany({
    where: { workspaceId: ctx.workspaceId, scene: { bookId: { in: t.bookIds } } },
    select: { sceneId: true, position: true },
  });
  const events = await client.timelineEvent.findMany({
    where: {
      workspaceId: ctx.workspaceId,
      OR: [{ bookId: { in: t.bookIds } }, ...(t.seriesId ? [{ seriesId: t.seriesId }] : [])],
    },
    select: { id: true, position: true },
  });
  return [
    ...scenes.map((s) => ({ id: s.sceneId, position: s.position, type: "scene" as const })),
    ...events.map((e) => ({ ...e, type: "event" as const })),
  ];
}

/** The position right after `afterId` (null = first), re-keying siblings if needed. */
async function positionAfter(
  tx: Prisma.TransactionClient,
  items: Item[],
  itemId: string,
  afterId: string | null,
) {
  const siblings = items.filter((i) => i.id !== itemId);
  if (afterId !== null && !siblings.some((s) => s.id === afterId))
    throw new RuleError("That isn’t on this timeline.");
  const plan = planInsertAfter(siblings, afterId);
  const typeOf = new Map(siblings.map((s) => [s.id, s.type]));
  for (const r of plan.rebalanced) {
    if (typeOf.get(r.id) === "scene")
      await tx.sceneStoryTime.update({ where: { sceneId: r.id }, data: { position: r.position } });
    else await tx.timelineEvent.update({ where: { id: r.id }, data: { position: r.position } });
  }
  return plan.position;
}

/** `afterId` must be a scene or event the author can see. */
async function requireNeighbour(ctx: AuthorContext, afterId: string | null | undefined) {
  if (!afterId) return;
  const node = await resolveNode(ctx, afterId);
  if (!node || (node.kind !== "SCENE" && node.kind !== "TIMELINE_EVENT"))
    throw new NotFoundError("Timeline item");
}

async function requireScene(ctx: AuthorContext, sceneId: string) {
  const node = await resolveNode(ctx, sceneId);
  if (!node || node.kind !== "SCENE") throw new NotFoundError("Scene");
  const { bookId } = await db.scene.findUniqueOrThrow({
    where: { id: sceneId },
    select: { bookId: true },
  });
  return { node, bookId };
}

// ─── Reads ──────────────────────────────────────────────────────────────────

/** The timelines the author can open: each series, and each standalone book. */
export async function listTimelines(
  ctx: AuthorContext,
  { penNameId = null }: { penNameId?: string | null } = {},
) {
  assertCanView(ctx, "manuscript");
  const pen = penNameId ? { penNameId } : {};
  const [series, books] = await Promise.all([
    db.series.findMany({
      where: { workspaceId: ctx.workspaceId, ...liveSeries, ...pen },
      select: { id: true },
    }),
    db.book.findMany({
      where: { workspaceId: ctx.workspaceId, ...liveBook, seriesId: null, ...pen },
      select: { id: true },
    }),
  ]);
  const nodes = await resolveNodes(
    ctx,
    [...series, ...books].map((r) => r.id),
  );
  return [...nodes.values()]
    .map((n) => ({ id: n.id, kind: n.kind, title: n.title, href: `/timeline/${n.id}` }))
    .sort((a, b) => a.title.localeCompare(b.title));
}

/**
 * A timeline in story order, with the scenes not placed yet. `ownerId` is a
 * series or a book (a book in a series opens its series' timeline). With
 * `characterId`, only scenes that character is in (all, or by their part:
 * Scene Participation); events, which have no characters, stay.
 */
export async function getTimeline(
  ctx: AuthorContext,
  ownerId: string,
  { characterId, role = "all" }: { characterId?: string; role?: ParticipationRole } = {},
): Promise<Timeline> {
  assertCanView(ctx, "manuscript", { kind: "NODE", id: ownerId });
  let owner = await resolveNode(ctx, ownerId);
  if (!owner || (owner.kind !== "BOOK" && owner.kind !== "SERIES"))
    throw new NotFoundError("Timeline");
  if (owner.kind === "BOOK" && owner.seriesId) {
    owner = await resolveNode(ctx, owner.seriesId);
    if (!owner) throw new NotFoundError("Timeline");
  }
  const isSeries = owner.kind === "SERIES";
  const books = await db.book.findMany({
    where: {
      workspaceId: ctx.workspaceId,
      ...liveBook,
      ...(isSeries ? { seriesId: owner.id } : { id: owner.id }),
    },
    orderBy: { seriesPosition: "asc" },
    select: { id: true, title: true, seriesPosition: true },
  });
  const bookIndex = new Map(
    sortByPosition(books.map((b) => ({ id: b.id, position: b.seriesPosition ?? "" }))).map(
      (b, i) => [b.id, i],
    ),
  );
  const [scenes, events, only] = await Promise.all([
    db.scene.findMany({
      where: { workspaceId: ctx.workspaceId, ...liveScene, bookId: { in: books.map((b) => b.id) } },
      select: {
        id: true,
        bookId: true,
        position: true,
        chapter: { select: { position: true, part: { select: { position: true } } } },
        storyTime: { select: { position: true, label: true } },
      },
    }),
    db.timelineEvent.findMany({
      where: {
        workspaceId: ctx.workspaceId,
        ...liveTimelineEvent,
        OR: [
          { bookId: { in: books.map((b) => b.id) } },
          ...(isSeries ? [{ seriesId: owner.id }] : []),
        ],
      },
      select: { id: true, position: true, label: true },
    }),
    characterId
      ? listCharacterScenes(ctx, characterId, { role }).then(
          (list) => new Set(list.map((s) => s.scene.id)),
        )
      : Promise.resolve(null),
  ]);

  // Reading order: book in its series, then the binder (parts and chapters
  // at book level, chapters in a part, scenes in a chapter).
  const readingKey = (s: (typeof scenes)[number]) => [
    String(bookIndex.get(s.bookId) ?? 0).padStart(6, "0"),
    s.chapter.part?.position ?? s.chapter.position,
    s.chapter.part ? s.chapter.position : "",
    s.position,
  ];
  const inReadingOrder = [...scenes].sort((a, b) => {
    const [x, y] = [readingKey(a), readingKey(b)];
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
    return a.id < b.id ? -1 : 1;
  });
  const readingIndex = new Map(inReadingOrder.map((s, i) => [s.id, i + 1]));

  // Only what this reader may see (scenes: manuscript; events: story bible).
  const nodes = await resolveNodes(ctx, [...scenes.map((s) => s.id), ...events.map((e) => e.id)]);
  const entry = (n: NodeSummary, label: string | null): TimelineEntry => ({
    kind: n.kind as TimelineEntry["kind"],
    id: n.id,
    title: n.title,
    href: n.href,
    label,
    context: n.kind === "TIMELINE_EVENT" ? (n.context?.split(" › ")[0] ?? null) : n.context,
    readingIndex: readingIndex.get(n.id) ?? null,
  });
  const keep = (id: string) => nodes.has(id) && (!only || only.has(id));

  const placed = sortByPosition([
    ...scenes.flatMap((s) =>
      s.storyTime && keep(s.id)
        ? [{ id: s.id, position: s.storyTime.position, label: s.storyTime.label }]
        : [],
    ),
    ...events.flatMap((e) => (nodes.has(e.id) ? [e] : [])),
  ]);
  return {
    owner: {
      id: owner.id,
      kind: owner.kind as "BOOK" | "SERIES",
      title: owner.title,
      href: `/timeline/${owner.id}`,
    },
    entries: placed.map((p) => entry(nodes.get(p.id)!, p.label)),
    unplaced: inReadingOrder
      .filter((s) => !s.storyTime && keep(s.id))
      .map((s) => entry(nodes.get(s.id)!, null)),
  };
}

export type SceneStoryTime = {
  placed: boolean;
  label: string | null;
  /** 1-based place in story order among what the reader can see. */
  order: number | null;
  timeline: Timeline;
};

/** A scene's place in Story Time, with its timeline (for "Place after…"). */
export async function getSceneStoryTime(
  ctx: AuthorContext,
  sceneId: string,
): Promise<SceneStoryTime> {
  assertCanView(ctx, "manuscript", { kind: "SCENE", id: sceneId });
  const { bookId } = await requireScene(ctx, sceneId);
  const [row, timeline] = await Promise.all([
    db.sceneStoryTime.findUnique({ where: { sceneId }, select: { label: true } }),
    getTimeline(ctx, bookId),
  ]);
  const index = timeline.entries.findIndex((e) => e.id === sceneId);
  return {
    placed: Boolean(row),
    label: row?.label ?? null,
    order: index === -1 ? null : index + 1,
    timeline,
  };
}

export type TimelineEventView = {
  id: string;
  title: string;
  label: string | null;
  description: string | null;
  updatedAt: Date;
  owner: { id: string; title: string; href: string; kind: "BOOK" | "SERIES" };
  timelineHref: string;
  node: NodeSummary;
};

export async function getTimelineEvent(ctx: AuthorContext, id: string): Promise<TimelineEventView> {
  assertCanView(ctx, "storyBible", { kind: "TIMELINE_EVENT", id });
  const node = await resolveNode(ctx, id);
  if (!node || node.kind !== "TIMELINE_EVENT") throw new NotFoundError("Timeline event");
  const row = await db.timelineEvent.findUniqueOrThrow({
    where: { id },
    select: {
      title: true,
      label: true,
      description: true,
      updatedAt: true,
      book: { select: { id: true, title: true, seriesId: true } },
      series: { select: { id: true, title: true } },
    },
  });
  const owner = row.book
    ? {
        id: row.book.id,
        title: row.book.title,
        href: `/books/${row.book.id}`,
        kind: "BOOK" as const,
      }
    : {
        id: row.series!.id,
        title: row.series!.title,
        href: `/library/series/${row.series!.id}`,
        kind: "SERIES" as const,
      };
  return {
    id,
    title: row.title,
    label: row.label,
    description: row.description,
    updatedAt: row.updatedAt,
    owner,
    timelineHref: `/timeline/${row.book?.seriesId ?? owner.id}`,
    node,
  };
}

// ─── A scene's story time ───────────────────────────────────────────────────

/**
 * Places a scene in Story Time right after `afterId` (a scene or event of
 * its timeline; null = first), or moves it there. Reading order and the
 * scene's text are untouched.
 */
export async function placeSceneInTime(ctx: AuthorContext, sceneId: string, input: PlacementInput) {
  assertCan(ctx, "edit", "manuscript");
  const data = placementInput.parse(input);
  const { bookId } = await requireScene(ctx, sceneId);
  if (data.afterId === sceneId) throw new RuleError("A scene can’t be placed after itself.");
  await requireNeighbour(ctx, data.afterId);
  await db.$transaction(async (tx) => {
    const t = await timelineOfBook(tx, bookId);
    const before = await tx.sceneStoryTime.findUnique({
      where: { sceneId },
      select: { label: true },
    });
    const position = await positionAfter(
      tx,
      await timelineItems(tx, ctx, t),
      sceneId,
      data.afterId,
    );
    const label = data.label !== undefined ? data.label : (before?.label ?? null);
    await tx.sceneStoryTime.upsert({
      where: { sceneId },
      create: { sceneId, workspaceId: ctx.workspaceId, position, label, createdById: ctx.userId },
      update: { position, label },
    });
    await recordStoryTimeChange(tx, ctx, sceneId, {
      action: before ? "moved" : "placed",
      afterId: data.afterId,
      label,
    });
  });
}

/** Changes a placed scene's story-time label. Refused if it changed since the author saw it. */
export async function setStoryTimeLabel(
  ctx: AuthorContext,
  sceneId: string,
  input: StoryTimeLabelInput,
) {
  assertCan(ctx, "edit", "manuscript");
  const data = storyTimeLabelInput.parse(input);
  await requireScene(ctx, sceneId);
  await db.$transaction(async (tx) => {
    const row = await tx.sceneStoryTime.findUnique({
      where: { sceneId },
      select: { label: true },
    });
    if (!row) throw new RuleError("Place the scene in story time first.");
    if (data.expected !== undefined && (row.label ?? null) !== (data.expected || null))
      throw new ConflictError(
        "This scene’s story time was changed somewhere else. Reload to see it, then try again.",
      );
    if ((row.label ?? null) === data.label) return;
    await tx.sceneStoryTime.update({ where: { sceneId }, data: { label: data.label } });
    await recordStoryTimeChange(tx, ctx, sceneId, {
      action: "label",
      label: data.label,
      previousLabel: row.label,
    });
  });
}

/** Takes a scene out of Story Time ("not placed yet"). Nothing else changes. */
export async function removeSceneFromTime(ctx: AuthorContext, sceneId: string) {
  assertCan(ctx, "edit", "manuscript");
  await requireScene(ctx, sceneId);
  await db.$transaction(async (tx) => {
    const row = await tx.sceneStoryTime.findUnique({
      where: { sceneId },
      select: { label: true },
    });
    if (!row) return;
    await tx.sceneStoryTime.delete({ where: { sceneId } });
    await recordStoryTimeChange(tx, ctx, sceneId, { action: "unplaced", previousLabel: row.label });
  });
}

// ─── Timeline events ────────────────────────────────────────────────────────

async function requireEvent(ctx: AuthorContext, id: string) {
  const node = await resolveNode(ctx, id);
  if (!node || node.kind !== "TIMELINE_EVENT") throw new NotFoundError("Timeline event");
  return db.timelineEvent.findUniqueOrThrow({
    where: { id },
    select: { bookId: true, seriesId: true },
  });
}

async function timelineOfEvent(
  client: Client,
  e: { bookId: string | null; seriesId: string | null },
) {
  return e.bookId
    ? timelineOfBook(client, e.bookId)
    : timelineOf(client, { seriesId: e.seriesId! });
}

/**
 * Something that happens in the story world, on a book's or a series'
 * timeline: after `afterId` (null = first), or at the end when omitted.
 */
export async function createTimelineEvent(ctx: AuthorContext, input: NewTimelineEventInput) {
  assertCan(ctx, "edit", "storyBible");
  const data = newTimelineEventInput.parse(input);
  const owner = await resolveNode(ctx, data.ownerId);
  if (!owner || (owner.kind !== "BOOK" && owner.kind !== "SERIES"))
    throw new NotFoundError("Book or series");
  await requireNeighbour(ctx, data.afterId);
  const ownedBy =
    owner.kind === "BOOK"
      ? { bookId: owner.id, seriesId: null }
      : { bookId: null, seriesId: owner.id };
  return db.$transaction(async (tx) => {
    const t = await timelineOfEvent(tx, ownedBy);
    const items = await timelineItems(tx, ctx, t);
    const id = await createStoryNode(tx, ctx.workspaceId, "TIMELINE_EVENT");
    const position =
      data.afterId === undefined
        ? positionAtEnd(items)
        : await positionAfter(tx, items, id, data.afterId);
    await tx.timelineEvent.create({
      data: {
        id,
        workspaceId: ctx.workspaceId,
        ...ownedBy,
        title: data.title,
        label: data.label ?? null,
        description: data.description || null,
        position,
      },
    });
    return { id };
  });
}

/** Renames an event, or changes its label or description (description history kept). */
export async function updateTimelineEvent(
  ctx: AuthorContext,
  id: string,
  input: TimelineEventInput,
  guard: EditGuard = {},
) {
  assertCan(ctx, "edit", "storyBible");
  const data = timelineEventInput.parse(input);
  await requireEvent(ctx, id);
  await db.$transaction(async (tx) => {
    const row = await tx.timelineEvent.findUniqueOrThrow({
      where: { id },
      select: { description: true, updatedAt: true },
    });
    assertNotStale(row.updatedAt, guard.expectedUpdatedAt, "event");
    const description = data.description === undefined ? undefined : data.description || null;
    await recordFieldHistory(tx, ctx, id, row, { description });
    const { count } = await tx.timelineEvent.updateMany({
      where: { id, updatedAt: row.updatedAt },
      data: {
        title: data.title,
        ...(data.label !== undefined && { label: data.label }),
        ...(description !== undefined && { description }),
      },
    });
    if (count === 0) throw staleError("event");
  });
}

/** Moves an event right after `afterId` on its timeline (null = first). */
export async function moveTimelineEvent(ctx: AuthorContext, id: string, afterId: string | null) {
  assertCan(ctx, "edit", "storyBible");
  const event = await requireEvent(ctx, id);
  if (afterId === id) throw new RuleError("An event can’t be placed after itself.");
  await requireNeighbour(ctx, afterId);
  await db.$transaction(async (tx) => {
    const items = await timelineItems(tx, ctx, await timelineOfEvent(tx, event));
    const position = await positionAfter(tx, items, id, afterId);
    await tx.timelineEvent.update({ where: { id }, data: { position } });
  });
}

export async function trashTimelineEvent(ctx: AuthorContext, id: string) {
  assertCan(ctx, "edit", "storyBible");
  await requireEvent(ctx, id);
  await db.timelineEvent.update({ where: { id }, data: { deletedAt: new Date() } });
}

// ─── Series changes (Change Impact, called by the library) ──────────────────

/** What of a book is in Story Time: its placed scenes and its own events. */
export async function getBookStoryTime(ctx: AuthorContext, bookId: string, client: Client = db) {
  assertCanView(ctx, "manuscript", { kind: "BOOK", id: bookId });
  const scenes = await client.sceneStoryTime.findMany({
    where: { workspaceId: ctx.workspaceId, scene: { bookId } },
    select: { sceneId: true },
  });
  const events = await client.timelineEvent.findMany({
    where: { workspaceId: ctx.workspaceId, bookId },
    select: { id: true },
  });
  const visible = await resolveNodes(ctx, [
    ...scenes.map((s) => s.sceneId),
    ...events.map((e) => e.id),
  ]);
  return {
    count: scenes.length + events.length,
    items: [...visible.values()].map((n) => ({ id: n.id, title: n.title, href: n.href })),
  };
}

/**
 * Inside a reviewed series change (Red): a book joining a series brings its
 * placed scenes and its own events after everything already on the series'
 * timeline, in their own order. Leaving keeps their order as it is (the
 * book's own timeline is the same items). Call before changing the book.
 */
export async function moveBookStoryTime(
  ctx: AuthorContext,
  bookId: string,
  toSeriesId: string | null,
  tx: Prisma.TransactionClient,
) {
  assertCan(ctx, "edit", "manuscript");
  if (!toSeriesId) return;
  const own = await timelineItems(tx, ctx, { seriesId: null, bookIds: [bookId] });
  if (!own.length) return;
  const target = await timelineOf(tx, { seriesId: toSeriesId });
  const existing = await timelineItems(tx, ctx, {
    seriesId: toSeriesId,
    bookIds: target.bookIds.filter((id) => id !== bookId),
  });
  const last = sortByPosition(existing).at(-1)?.position ?? null;
  const keys = positionsAfter(last, own.length);
  for (const [i, item] of sortByPosition(own).entries()) {
    if (item.type === "scene")
      await tx.sceneStoryTime.update({ where: { sceneId: item.id }, data: { position: keys[i] } });
    else await tx.timelineEvent.update({ where: { id: item.id }, data: { position: keys[i] } });
  }
}
