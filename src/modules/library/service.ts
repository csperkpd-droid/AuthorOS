import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { NotFoundError, RuleError } from "@/lib/errors";
import { planInsertAfter, positionAtEnd, sortByPosition } from "@/lib/ordering";
import { getPenNameForNewWork, requireAssignablePenName } from "@/modules/pen-names";
import { createStoryNode, liveBook } from "@/modules/story-graph";
import type { AuthorContext } from "@/server/context";

import {
  bookInput,
  newBookInput,
  seriesInput,
  type BookInput,
  type NewBookInput,
  type SeriesInput,
} from "./schemas";

// A book is visible when neither it nor its series is in the Trash.
export const visibleBookWhere = liveBook;

const penNameRef = { select: { id: true, name: true, archivedAt: true } } as const;

const bookCardSelect = {
  id: true,
  title: true,
  subtitle: true,
  status: true,
  targetWordCount: true,
  seriesId: true,
  seriesPosition: true,
  updatedAt: true,
  penName: penNameRef,
} as const;

export type BookCard = Prisma.BookGetPayload<{ select: typeof bookCardSelect }> & {
  wordCount: number;
};

/** Total words per book, counting only scenes that are not in the Trash. */
export async function wordCountsByBook(
  ctx: AuthorContext,
  bookIds: string[],
): Promise<Map<string, number>> {
  if (bookIds.length === 0) return new Map();
  const rows = await db.scene.groupBy({
    by: ["bookId"],
    where: {
      workspaceId: ctx.workspaceId,
      bookId: { in: bookIds },
      deletedAt: null,
      chapter: { deletedAt: null, OR: [{ partId: null }, { part: { deletedAt: null } }] },
    },
    _sum: { wordCount: true },
  });
  return new Map(rows.map((r) => [r.bookId, r._sum.wordCount ?? 0]));
}

async function withWordCounts<T extends { id: string }>(ctx: AuthorContext, books: T[]) {
  const counts = await wordCountsByBook(
    ctx,
    books.map((b) => b.id),
  );
  return books.map((b) => ({ ...b, wordCount: counts.get(b.id) ?? 0 }));
}

// ─── Library ────────────────────────────────────────────────────────────────

/**
 * Series and standalone books, optionally narrowed to one pen name.
 * `penNameId: null` returns every identity's work.
 */
export async function listLibrary(ctx: AuthorContext, { penNameId }: { penNameId: string | null }) {
  const penFilter = penNameId ? { penNameId } : {};
  const [series, standalone] = await Promise.all([
    db.series.findMany({
      where: { workspaceId: ctx.workspaceId, deletedAt: null, ...penFilter },
      orderBy: { title: "asc" },
      select: {
        id: true,
        title: true,
        description: true,
        penName: penNameRef,
        books: { where: { deletedAt: null }, select: bookCardSelect },
      },
    }),
    db.book.findMany({
      where: { workspaceId: ctx.workspaceId, deletedAt: null, seriesId: null, ...penFilter },
      orderBy: { updatedAt: "desc" },
      select: bookCardSelect,
    }),
  ]);

  const counts = await wordCountsByBook(ctx, [
    ...series.flatMap((s) => s.books.map((b) => b.id)),
    ...standalone.map((b) => b.id),
  ]);
  const card = <B extends { id: string }>(b: B) => ({ ...b, wordCount: counts.get(b.id) ?? 0 });

  return {
    series: series.map((s) => ({ ...s, books: sortBySeriesPosition(s.books).map(card) })),
    standalone: standalone.map(card),
  };
}

function sortBySeriesPosition<T extends { id: string; seriesPosition: string | null }>(books: T[]) {
  return sortByPosition(books.map((b) => ({ ...b, position: b.seriesPosition ?? "" })));
}

// ─── Series ─────────────────────────────────────────────────────────────────

export async function getSeries(ctx: AuthorContext, id: string) {
  const series = await db.series.findFirst({
    where: { id, workspaceId: ctx.workspaceId, deletedAt: null },
    select: {
      id: true,
      title: true,
      description: true,
      penName: penNameRef,
      books: { where: { deletedAt: null }, select: bookCardSelect },
    },
  });
  if (!series) throw new NotFoundError("Series");
  return { ...series, books: await withWordCounts(ctx, sortBySeriesPosition(series.books)) };
}

/** Series an author can put a book into, for pickers. */
export async function listSeriesOptions(ctx: AuthorContext) {
  return db.series.findMany({
    where: { workspaceId: ctx.workspaceId, deletedAt: null },
    orderBy: { title: "asc" },
    select: { id: true, title: true, penName: penNameRef },
  });
}

export async function createSeries(ctx: AuthorContext, input: SeriesInput) {
  const data = seriesInput.parse(input);
  const penName = data.penNameId
    ? await requireAssignablePenName(ctx, data.penNameId)
    : await getPenNameForNewWork(ctx);

  return db.$transaction(async (tx) => {
    const id = await createStoryNode(tx, ctx.workspaceId, "SERIES");
    return tx.series.create({
      data: {
        id,
        workspaceId: ctx.workspaceId,
        penNameId: penName.id,
        title: data.title,
        description: data.description ?? null,
      },
      select: { id: true },
    });
  });
}

/** Changing a series' pen name moves all of its books to that pen name too. */
export async function updateSeries(ctx: AuthorContext, id: string, input: SeriesInput) {
  const data = seriesInput.parse(input);
  const current = await getSeries(ctx, id);
  const penNameId = data.penNameId ?? current.penName.id;
  if (penNameId !== current.penName.id) await requireAssignablePenName(ctx, penNameId);

  await db.$transaction([
    db.series.update({
      where: { id },
      data: { title: data.title, description: data.description ?? null, penNameId },
    }),
    db.book.updateMany({
      where: { seriesId: id, workspaceId: ctx.workspaceId },
      data: { penNameId },
    }),
  ]);
}

/** Moves a series (and with it, its books) to the Trash. */
export async function trashSeries(ctx: AuthorContext, id: string) {
  await getSeries(ctx, id);
  await db.series.update({ where: { id }, data: { deletedAt: new Date() } });
}

// ─── Books ──────────────────────────────────────────────────────────────────

export async function getBook(ctx: AuthorContext, id: string) {
  const book = await db.book.findFirst({
    where: { id, workspaceId: ctx.workspaceId, ...visibleBookWhere },
    select: {
      ...bookCardSelect,
      description: true,
      series: { select: { id: true, title: true } },
    },
  });
  if (!book) throw new NotFoundError("Book");
  return book;
}

async function requireVisibleSeries(ctx: AuthorContext, seriesId: string) {
  const series = await db.series.findFirst({
    where: { id: seriesId, workspaceId: ctx.workspaceId, deletedAt: null },
    select: { id: true, penNameId: true },
  });
  if (!series) throw new NotFoundError("Series");
  return series;
}

async function seriesSiblings(seriesId: string, excludeBookId?: string) {
  const books = await db.book.findMany({
    where: { seriesId, deletedAt: null, ...(excludeBookId ? { id: { not: excludeBookId } } : {}) },
    select: { id: true, seriesPosition: true },
  });
  return books.map((b) => ({ id: b.id, position: b.seriesPosition ?? "" }));
}

export async function createBook(ctx: AuthorContext, input: NewBookInput) {
  const data = newBookInput.parse(input);

  let penNameId: string;
  let seriesPosition: string | null = null;
  if (data.seriesId) {
    const series = await requireVisibleSeries(ctx, data.seriesId);
    if (data.penNameId && data.penNameId !== series.penNameId) {
      throw new RuleError("Books in a series use the series’ pen name.");
    }
    penNameId = series.penNameId;
    seriesPosition = positionAtEnd(await seriesSiblings(series.id));
  } else {
    penNameId = data.penNameId
      ? (await requireAssignablePenName(ctx, data.penNameId)).id
      : (await getPenNameForNewWork(ctx)).id;
  }

  return db.$transaction(async (tx) => {
    const id = await createStoryNode(tx, ctx.workspaceId, "BOOK");
    return tx.book.create({
      data: {
        id,
        workspaceId: ctx.workspaceId,
        penNameId,
        seriesId: data.seriesId ?? null,
        seriesPosition,
        title: data.title,
        subtitle: data.subtitle ?? null,
        description: data.description ?? null,
        status: data.status,
        targetWordCount: data.targetWordCount ?? null,
      },
      select: { id: true },
    });
  });
}

export async function updateBook(ctx: AuthorContext, id: string, input: BookInput) {
  const data = bookInput.parse(input);
  const book = await getBook(ctx, id);

  let penNameId = book.penName.id;
  if (data.penNameId && data.penNameId !== book.penName.id) {
    if (book.seriesId)
      throw new RuleError("Books in a series use the series’ pen name. Change it on the series.");
    penNameId = (await requireAssignablePenName(ctx, data.penNameId)).id;
  }

  await db.book.update({
    where: { id },
    data: {
      title: data.title,
      subtitle: data.subtitle ?? null,
      description: data.description ?? null,
      status: data.status,
      targetWordCount: data.targetWordCount,
      penNameId,
    },
  });
}

/**
 * Puts a book into a series (at the end; it takes the series' pen name), or
 * makes it standalone (`seriesId: null`; it keeps its pen name).
 */
export async function setBookSeries(ctx: AuthorContext, id: string, seriesId: string | null) {
  const book = await getBook(ctx, id);
  if (book.seriesId === seriesId) return;

  if (seriesId === null) {
    await db.book.update({ where: { id }, data: { seriesId: null, seriesPosition: null } });
    return;
  }
  const series = await requireVisibleSeries(ctx, seriesId);
  await db.book.update({
    where: { id },
    data: {
      seriesId,
      seriesPosition: positionAtEnd(await seriesSiblings(seriesId)),
      penNameId: series.penNameId,
    },
  });
}

/** Reorders a book within its series: place it after `afterBookId` (null = first). */
export async function moveBookInSeries(ctx: AuthorContext, id: string, afterBookId: string | null) {
  const book = await getBook(ctx, id);
  if (!book.seriesId) throw new RuleError("Only books in a series have an order.");
  const plan = planInsertAfter(await seriesSiblings(book.seriesId, id), afterBookId);

  await db.$transaction([
    ...plan.rebalanced.map((r) =>
      db.book.update({ where: { id: r.id }, data: { seriesPosition: r.position } }),
    ),
    db.book.update({ where: { id }, data: { seriesPosition: plan.position } }),
  ]);
}

export async function trashBook(ctx: AuthorContext, id: string) {
  await getBook(ctx, id);
  await db.book.update({ where: { id }, data: { deletedAt: new Date() } });
}
