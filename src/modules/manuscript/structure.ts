import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { NotFoundError, RuleError } from "@/lib/errors";
import { planInsertAfter, positionAtEnd, sortByPosition, type Positioned } from "@/lib/ordering";
import { assertReviewed, attachmentsOf, buildReport } from "@/modules/impact";
import { getBook } from "@/modules/library";
import { createStoryNode, purgeStoryNodes } from "@/modules/story-graph";
import type { AuthorContext } from "@/server/context";
import { assertCan, assertCanView } from "@/server/policy";

import { structureTitle } from "./schemas";

// ─── Reading the tree ───────────────────────────────────────────────────────

export type SceneItem = {
  kind: "scene";
  id: string;
  title: string;
  status: string;
  wordCount: number;
  position: string;
};
export type ChapterItem = {
  kind: "chapter";
  id: string;
  title: string;
  partId: string | null;
  position: string;
  wordCount: number;
  scenes: SceneItem[];
};
export type PartItem = {
  kind: "part";
  id: string;
  title: string;
  position: string;
  wordCount: number;
  chapters: ChapterItem[];
};
/** A book's top level: an ordered mix of parts and part-less chapters. */
export type BookLevelItem = PartItem | ChapterItem;

export type BookTree = {
  items: BookLevelItem[];
  wordCount: number;
  sceneCount: number;
  /** Every scene in reading order. */
  sceneOrder: { id: string; title: string; chapterTitle: string }[];
};

/**
 * The visible structure of a book. Rows in the Trash, and children of rows in
 * the Trash, are excluded.
 */
export async function getBookTree(ctx: AuthorContext, bookId: string): Promise<BookTree> {
  assertCanView(ctx, "manuscript", { kind: "BOOK", id: bookId });
  await getBook(ctx, bookId);
  const where = { bookId, workspaceId: ctx.workspaceId, deletedAt: null };
  const [parts, chapters, scenes] = await Promise.all([
    db.part.findMany({ where, select: { id: true, title: true, position: true } }),
    db.chapter.findMany({ where, select: { id: true, title: true, position: true, partId: true } }),
    db.scene.findMany({
      where,
      select: {
        id: true,
        title: true,
        position: true,
        status: true,
        wordCount: true,
        chapterId: true,
      },
    }),
  ]);

  const scenesByChapter = groupBy(scenes, (s) => s.chapterId);
  const partIds = new Set(parts.map((p) => p.id));

  const chapterItems = sortByPosition(chapters)
    .filter((c) => c.partId === null || partIds.has(c.partId))
    .map((c): ChapterItem => {
      const sceneItems = sortByPosition(scenesByChapter.get(c.id) ?? []).map((s): SceneItem => ({
        kind: "scene",
        id: s.id,
        title: s.title,
        status: s.status,
        wordCount: s.wordCount,
        position: s.position,
      }));
      return { kind: "chapter", ...c, scenes: sceneItems, wordCount: sum(sceneItems) };
    });

  const chaptersByPart = groupBy(chapterItems, (c) => c.partId ?? "");
  const partItems = parts.map((p): PartItem => {
    const partChapters = chaptersByPart.get(p.id) ?? [];
    return { kind: "part", ...p, chapters: partChapters, wordCount: sum(partChapters) };
  });

  const items = sortByPosition<BookLevelItem>([...partItems, ...(chaptersByPart.get("") ?? [])]);
  const sceneOrder = items
    .flatMap((i) => (i.kind === "part" ? i.chapters : [i]))
    .flatMap((c) => c.scenes.map((s) => ({ id: s.id, title: s.title, chapterTitle: c.title })));

  return { items, wordCount: sum(items), sceneCount: sceneOrder.length, sceneOrder };
}

function groupBy<T>(items: T[], key: (item: T) => string) {
  const map = new Map<string, T[]>();
  for (const item of items) map.set(key(item), [...(map.get(key(item)) ?? []), item]);
  return map;
}

function sum(items: { wordCount: number }[]) {
  return items.reduce((total, i) => total + i.wordCount, 0);
}

// ─── Lookups ────────────────────────────────────────────────────────────────

async function requirePart(ctx: AuthorContext, id: string) {
  const part = await db.part.findFirst({
    where: { id, workspaceId: ctx.workspaceId, deletedAt: null },
    select: { id: true, bookId: true, position: true },
  });
  if (!part) throw new NotFoundError("Part");
  await getBook(ctx, part.bookId);
  return part;
}

async function requireChapter(ctx: AuthorContext, id: string) {
  const chapter = await db.chapter.findFirst({
    where: {
      id,
      workspaceId: ctx.workspaceId,
      deletedAt: null,
      OR: [{ partId: null }, { part: { deletedAt: null } }],
    },
    select: { id: true, bookId: true, partId: true },
  });
  if (!chapter) throw new NotFoundError("Chapter");
  await getBook(ctx, chapter.bookId);
  return chapter;
}

export async function requireScene(ctx: AuthorContext, id: string) {
  const scene = await db.scene.findFirst({
    where: {
      id,
      workspaceId: ctx.workspaceId,
      deletedAt: null,
      chapter: { deletedAt: null, OR: [{ partId: null }, { part: { deletedAt: null } }] },
    },
    select: { id: true, bookId: true, chapterId: true },
  });
  if (!scene) throw new NotFoundError("Scene");
  await getBook(ctx, scene.bookId);
  return scene;
}

type Client = Prisma.TransactionClient | typeof db;

/** Siblings at the book's top level: parts and part-less chapters. */
async function bookLevelSiblings(
  bookId: string,
  exclude?: string,
  client: Client = db,
): Promise<Positioned[]> {
  const where = { bookId, deletedAt: null, ...(exclude ? { id: { not: exclude } } : {}) };
  // Sequential, not Promise.all: a transaction client runs one query at a time.
  const parts = await client.part.findMany({ where, select: { id: true, position: true } });
  const chapters = await client.chapter.findMany({
    where: { ...where, partId: null },
    select: { id: true, position: true },
  });
  return [...parts, ...chapters];
}

async function partSiblings(
  partId: string,
  exclude?: string,
  client: Client = db,
): Promise<Positioned[]> {
  return client.chapter.findMany({
    where: { partId, deletedAt: null, ...(exclude ? { id: { not: exclude } } : {}) },
    select: { id: true, position: true },
  });
}

async function sceneSiblings(
  chapterId: string,
  exclude?: string,
  client: Client = db,
): Promise<Positioned[]> {
  return client.scene.findMany({
    where: { chapterId, deletedAt: null, ...(exclude ? { id: { not: exclude } } : {}) },
    select: { id: true, position: true },
  });
}

/** Writes rebalanced sibling keys to whichever table each sibling lives in. */
function rebalanceOps(
  rebalanced: Positioned[],
  partIds: Set<string>,
  table: "bookLevel" | "chapter" | "scene",
) {
  return rebalanced.map((r) => {
    if (table === "scene")
      return db.scene.update({ where: { id: r.id }, data: { position: r.position } });
    if (table === "bookLevel" && partIds.has(r.id)) {
      return db.part.update({ where: { id: r.id }, data: { position: r.position } });
    }
    return db.chapter.update({ where: { id: r.id }, data: { position: r.position } });
  });
}

async function partIdsOf(bookId: string) {
  const parts = await db.part.findMany({ where: { bookId }, select: { id: true } });
  return new Set(parts.map((p) => p.id));
}

// ─── Creating ───────────────────────────────────────────────────────────────
//
// Each create locks its parent row, so concurrent adds (a double click, two
// tabs) are serialized: positions never collide and default titles count up.

async function lockRow(
  tx: Prisma.TransactionClient,
  table: "books" | "parts" | "chapters",
  id: string,
) {
  // `table` is one of three literals, never user input.
  await tx.$queryRawUnsafe(`SELECT 1 FROM "${table}" WHERE "id" = $1::uuid FOR UPDATE`, id);
}

/** Adds a part at the end of the book's top level. Default title: "Part N". */
export async function createPart(ctx: AuthorContext, bookId: string, title?: string) {
  assertCan(ctx, "edit", "manuscript");
  await getBook(ctx, bookId);
  const explicit = title === undefined ? undefined : structureTitle.parse(title);
  return db.$transaction(async (tx) => {
    await lockRow(tx, "books", bookId);
    const count = await tx.part.count({ where: { bookId, deletedAt: null } });
    const position = positionAtEnd(await bookLevelSiblings(bookId, undefined, tx));
    const id = await createStoryNode(tx, ctx.workspaceId, "PART");
    return tx.part.create({
      data: {
        id,
        workspaceId: ctx.workspaceId,
        bookId,
        title: explicit ?? `Part ${count + 1}`,
        position,
      },
      select: { id: true },
    });
  });
}

/**
 * Adds a chapter at the end of a part, or of the book's top level
 * (`partId: null`). Default title: "Chapter N", counting the whole book.
 */
export async function createChapter(
  ctx: AuthorContext,
  bookId: string,
  { title, partId = null }: { title?: string; partId?: string | null } = {},
) {
  assertCan(ctx, "edit", "manuscript");
  await getBook(ctx, bookId);
  if (partId) {
    const part = await requirePart(ctx, partId);
    if (part.bookId !== bookId) throw new RuleError("That part belongs to another book.");
  }
  const explicit = title === undefined ? undefined : structureTitle.parse(title);
  return db.$transaction(async (tx) => {
    await lockRow(tx, "books", bookId);
    const count = await tx.chapter.count({ where: { bookId, deletedAt: null } });
    const siblings = partId
      ? await partSiblings(partId, undefined, tx)
      : await bookLevelSiblings(bookId, undefined, tx);
    const id = await createStoryNode(tx, ctx.workspaceId, "CHAPTER");
    return tx.chapter.create({
      data: {
        id,
        workspaceId: ctx.workspaceId,
        bookId,
        partId,
        title: explicit ?? `Chapter ${count + 1}`,
        position: positionAtEnd(siblings),
      },
      select: { id: true },
    });
  });
}

/** Adds a scene at the end of a chapter. Default title: "Scene N" within the chapter. */
export async function createScene(ctx: AuthorContext, chapterId: string, title?: string) {
  assertCan(ctx, "edit", "manuscript");
  const chapter = await requireChapter(ctx, chapterId);
  const explicit = title === undefined ? undefined : structureTitle.parse(title);
  return db.$transaction(async (tx) => {
    await lockRow(tx, "chapters", chapterId);
    const siblings = await sceneSiblings(chapterId, undefined, tx);
    const id = await createStoryNode(tx, ctx.workspaceId, "SCENE");
    return tx.scene.create({
      data: {
        id,
        workspaceId: ctx.workspaceId,
        bookId: chapter.bookId,
        chapterId,
        title: explicit ?? `Scene ${siblings.length + 1}`,
        position: positionAtEnd(siblings),
      },
      select: { id: true },
    });
  });
}

// ─── Renaming ───────────────────────────────────────────────────────────────

export async function renamePart(ctx: AuthorContext, id: string, title: string) {
  assertCan(ctx, "edit", "manuscript");
  await requirePart(ctx, id);
  await db.part.update({ where: { id }, data: { title: structureTitle.parse(title) } });
}

export async function renameChapter(ctx: AuthorContext, id: string, title: string) {
  assertCan(ctx, "edit", "manuscript");
  await requireChapter(ctx, id);
  await db.chapter.update({ where: { id }, data: { title: structureTitle.parse(title) } });
}

// ─── Moving ─────────────────────────────────────────────────────────────────

/** Moves a part within its book's top level, after `afterId` (a part or chapter; null = first). */
export async function movePart(ctx: AuthorContext, id: string, afterId: string | null) {
  assertCan(ctx, "edit", "manuscript");
  const part = await requirePart(ctx, id);
  const plan = planInsertAfter(await bookLevelSiblings(part.bookId, id), afterId);
  const partIds = await partIdsOf(part.bookId);
  await db.$transaction([
    ...rebalanceOps(plan.rebalanced, partIds, "bookLevel"),
    db.part.update({ where: { id }, data: { position: plan.position } }),
  ]);
}

/**
 * Moves a chapter into a part (or the book's top level when `partId` is null),
 * after `afterId` (null = first). Chapters stay within their book.
 */
export async function moveChapter(
  ctx: AuthorContext,
  id: string,
  { partId, afterId }: { partId: string | null; afterId: string | null },
) {
  assertCan(ctx, "edit", "manuscript");
  const chapter = await requireChapter(ctx, id);
  if (partId) {
    const part = await requirePart(ctx, partId);
    if (part.bookId !== chapter.bookId)
      throw new RuleError("Chapters can only move within their book.");
  }
  const siblings = partId
    ? await partSiblings(partId, id)
    : await bookLevelSiblings(chapter.bookId, id);
  const plan = planInsertAfter(siblings, afterId);
  const partIds = await partIdsOf(chapter.bookId);
  await db.$transaction([
    ...rebalanceOps(plan.rebalanced, partIds, partId ? "chapter" : "bookLevel"),
    db.chapter.update({ where: { id }, data: { partId, position: plan.position } }),
  ]);
}

/** Moves a scene into a chapter of the same book, after `afterId` (null = first). */
export async function moveScene(
  ctx: AuthorContext,
  id: string,
  { chapterId, afterId }: { chapterId: string; afterId: string | null },
) {
  assertCan(ctx, "edit", "manuscript");
  const scene = await requireScene(ctx, id);
  const chapter = await requireChapter(ctx, chapterId);
  if (chapter.bookId !== scene.bookId)
    throw new RuleError("Scenes can only move within their book.");
  const plan = planInsertAfter(await sceneSiblings(chapterId, id), afterId);
  await db.$transaction([
    ...rebalanceOps(plan.rebalanced, new Set(), "scene"),
    db.scene.update({ where: { id }, data: { chapterId, position: plan.position } }),
  ]);
}

/**
 * Removes a part but keeps its chapters: they move to the book's top level,
 * in order, where the part was.
 */
/**
 * "What will this affect?" for removing a part: its chapters move to the
 * book's top level; links, field values and dates of the part itself go.
 */
export async function previewDissolvePart(ctx: AuthorContext, id: string) {
  assertCanView(ctx, "manuscript", { kind: "PART", id: id });
  const part = await requirePart(ctx, id);
  const [title, chapters, attached] = await Promise.all([
    db.part.findUniqueOrThrow({ where: { id }, select: { title: true } }),
    partSiblings(id),
    attachmentsOf(ctx, [id]),
  ]);
  return buildReport({
    title: `Remove the part “${title.title}”?`,
    description: "Its chapters and scenes stay in the book, in the same order.",
    groups: [
      {
        key: "CHAPTERS",
        label: "Chapters of this part",
        noun: { one: "chapter", many: "chapters" },
        effect: "Move to the book’s top level, in order",
        affected: false,
        count: chapters.length,
        items: [],
      },
      ...attached,
    ],
    extra: [id, part.bookId],
  });
}

export async function dissolvePart(ctx: AuthorContext, id: string, token?: string) {
  assertCan(ctx, "edit", "manuscript");
  const part = await requirePart(ctx, id);
  assertReviewed(await previewDissolvePart(ctx, id), token);
  const chapters = sortByPosition(await partSiblings(id));
  const siblings = sortByPosition(await bookLevelSiblings(part.bookId));
  const index = siblings.findIndex((s) => s.id === id);
  const afterId = index > 0 ? siblings[index - 1].id : null;

  await db.$transaction(async (tx) => {
    let previous = afterId;
    let level = siblings.filter((s) => s.id !== id);
    for (const chapter of chapters) {
      const plan = planInsertAfter(level, previous);
      await applyRebalance(tx, plan.rebalanced, await partIdsOf(part.bookId));
      await tx.chapter.update({
        where: { id: chapter.id },
        data: { partId: null, position: plan.position },
      });
      const rekeyed = new Map(plan.rebalanced.map((r) => [r.id, r.position]));
      level = [
        ...level.map((s) => ({ ...s, position: rekeyed.get(s.id) ?? s.position })),
        { id: chapter.id, position: plan.position },
      ];
      previous = chapter.id;
    }
    await purgeStoryNodes(tx, ctx.workspaceId, [id]);
  });
}

async function applyRebalance(
  tx: Prisma.TransactionClient,
  rebalanced: Positioned[],
  partIds: Set<string>,
) {
  for (const r of rebalanced) {
    if (partIds.has(r.id))
      await tx.part.update({ where: { id: r.id }, data: { position: r.position } });
    else await tx.chapter.update({ where: { id: r.id }, data: { position: r.position } });
  }
}

// ─── Trash ──────────────────────────────────────────────────────────────────

/** Moves a part, with its chapters and scenes, to the Trash. */
export async function trashPart(ctx: AuthorContext, id: string) {
  assertCan(ctx, "edit", "manuscript");
  await requirePart(ctx, id);
  await db.part.update({ where: { id }, data: { deletedAt: new Date() } });
}

export async function trashChapter(ctx: AuthorContext, id: string) {
  assertCan(ctx, "edit", "manuscript");
  await requireChapter(ctx, id);
  await db.chapter.update({ where: { id }, data: { deletedAt: new Date() } });
}

export async function trashScene(ctx: AuthorContext, id: string) {
  assertCan(ctx, "edit", "manuscript");
  await requireScene(ctx, id);
  await db.scene.update({ where: { id }, data: { deletedAt: new Date() } });
}
