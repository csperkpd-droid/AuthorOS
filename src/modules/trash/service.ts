import type { Prisma, StoryNodeKind } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { NotFoundError } from "@/lib/errors";
import { visibleBookWhere } from "@/modules/library";
import { purgeStoryNodes } from "@/modules/story-graph";
import type { AuthorContext } from "@/server/context";

/**
 * The Trash works across every story-node type. An item is listed when it is
 * deleted but everything that contains it is not: deleting a chapter lists
 * the chapter, and its scenes return with it when restored.
 */
export type TrashItem = {
  id: string;
  kind: StoryNodeKind;
  title: string;
  /** Where the item lived, e.g. "The Long Night › Chapter 3". */
  context: string | null;
  deletedAt: Date;
};

const deleted = { deletedAt: { not: null } } as const;
const livePart = {
  OR: [{ partId: null }, { part: { deletedAt: null } }],
} satisfies Prisma.ChapterWhereInput;

function whereFor(ctx: AuthorContext) {
  const ws = { workspaceId: ctx.workspaceId };
  return {
    series: { ...ws, ...deleted } satisfies Prisma.SeriesWhereInput,
    book: {
      ...ws,
      ...deleted,
      OR: [{ seriesId: null }, { series: { deletedAt: null } }],
    } satisfies Prisma.BookWhereInput,
    part: { ...ws, ...deleted, book: visibleBookWhere } satisfies Prisma.PartWhereInput,
    chapter: {
      ...ws,
      ...deleted,
      book: visibleBookWhere,
      ...livePart,
    } satisfies Prisma.ChapterWhereInput,
    scene: {
      ...ws,
      ...deleted,
      book: visibleBookWhere,
      chapter: { deletedAt: null, ...livePart },
    } satisfies Prisma.SceneWhereInput,
  };
}

export async function listTrash(ctx: AuthorContext): Promise<TrashItem[]> {
  const where = whereFor(ctx);
  const [series, books, parts, chapters, scenes] = await Promise.all([
    db.series.findMany({
      where: where.series,
      select: { id: true, title: true, deletedAt: true, penName: { select: { name: true } } },
    }),
    db.book.findMany({
      where: where.book,
      select: {
        id: true,
        title: true,
        deletedAt: true,
        series: { select: { title: true } },
        penName: { select: { name: true } },
      },
    }),
    db.part.findMany({
      where: where.part,
      select: { id: true, title: true, deletedAt: true, book: { select: { title: true } } },
    }),
    db.chapter.findMany({
      where: where.chapter,
      select: {
        id: true,
        title: true,
        deletedAt: true,
        book: { select: { title: true } },
        part: { select: { title: true } },
      },
    }),
    db.scene.findMany({
      where: where.scene,
      select: {
        id: true,
        title: true,
        deletedAt: true,
        book: { select: { title: true } },
        chapter: { select: { title: true } },
      },
    }),
  ]);

  const items: TrashItem[] = [
    ...series.map((s) => item(s, "SERIES", s.penName.name)),
    ...books.map((b) => item(b, "BOOK", b.series?.title ?? b.penName.name)),
    ...parts.map((p) => item(p, "PART", p.book.title)),
    ...chapters.map((c) => item(c, "CHAPTER", trail(c.book.title, c.part?.title))),
    ...scenes.map((s) => item(s, "SCENE", trail(s.book.title, s.chapter.title))),
  ];
  return items.sort((a, b) => b.deletedAt.getTime() - a.deletedAt.getTime());
}

function item(
  row: { id: string; title: string; deletedAt: Date | null },
  kind: StoryNodeKind,
  context: string | null,
): TrashItem {
  return { id: row.id, kind, title: row.title, context, deletedAt: row.deletedAt! };
}

function trail(...parts: (string | null | undefined)[]) {
  return parts.filter(Boolean).join(" › ");
}

/** Confirms the item is currently listed in this workspace's Trash. */
async function requireTrashed(ctx: AuthorContext, kind: StoryNodeKind, id: string) {
  const where = whereFor(ctx);
  const found = await (() => {
    switch (kind) {
      case "SERIES":
        return db.series.findFirst({ where: { ...where.series, id }, select: { id: true } });
      case "BOOK":
        return db.book.findFirst({ where: { ...where.book, id }, select: { id: true } });
      case "PART":
        return db.part.findFirst({ where: { ...where.part, id }, select: { id: true } });
      case "CHAPTER":
        return db.chapter.findFirst({ where: { ...where.chapter, id }, select: { id: true } });
      case "SCENE":
        return db.scene.findFirst({ where: { ...where.scene, id }, select: { id: true } });
    }
  })();
  if (!found) throw new NotFoundError("Item in the Trash");
}

export async function restoreFromTrash(ctx: AuthorContext, kind: StoryNodeKind, id: string) {
  await requireTrashed(ctx, kind, id);
  const data = { deletedAt: null };
  switch (kind) {
    case "SERIES":
      return void (await db.series.update({ where: { id }, data }));
    case "BOOK":
      return void (await db.book.update({ where: { id }, data }));
    case "PART":
      return void (await db.part.update({ where: { id }, data }));
    case "CHAPTER":
      return void (await db.chapter.update({ where: { id }, data }));
    case "SCENE":
      return void (await db.scene.update({ where: { id }, data }));
  }
}

/** Permanently deletes an item and everything inside it. Cannot be undone. */
export async function deleteForever(ctx: AuthorContext, kind: StoryNodeKind, id: string) {
  await requireTrashed(ctx, kind, id);
  await db.$transaction((tx) => purgeStoryNodes(tx, ctx.workspaceId, [id]));
}

export async function emptyTrash(ctx: AuthorContext): Promise<number> {
  const items = await listTrash(ctx);
  if (items.length === 0) return 0;
  await db.$transaction((tx) =>
    purgeStoryNodes(
      tx,
      ctx.workspaceId,
      items.map((i) => i.id),
    ),
  );
  return items.length;
}
