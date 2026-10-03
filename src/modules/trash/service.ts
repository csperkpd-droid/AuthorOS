import "server-only";

import type { Prisma, StoryNodeKind } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { NotFoundError } from "@/lib/errors";
import {
  liveBook,
  liveCharacter,
  liveRelationship,
  liveSeries,
  purgeStoryNodes,
} from "@/modules/story-graph";
import type { AuthorContext } from "@/server/context";

/**
 * The Trash works across every story-node type. An item is listed when it is
 * deleted but everything that contains it is not: deleting a chapter lists
 * the chapter, and its scenes return with it when restored.
 *
 * The Trash is separate from archiving (pen names, ideas) and from version
 * history (scene revisions): nothing here is removed until the author deletes
 * it forever or empties the Trash.
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
const livePartOf = {
  OR: [{ partId: null }, { part: { deletedAt: null } }],
} satisfies Prisma.ChapterWhereInput;

function whereFor(ctx: AuthorContext) {
  const ws = { workspaceId: ctx.workspaceId, ...deleted };
  return {
    series: ws satisfies Prisma.SeriesWhereInput,
    book: {
      ...ws,
      OR: [{ seriesId: null }, { series: { deletedAt: null } }],
    } satisfies Prisma.BookWhereInput,
    part: { ...ws, book: liveBook } satisfies Prisma.PartWhereInput,
    chapter: { ...ws, book: liveBook, ...livePartOf } satisfies Prisma.ChapterWhereInput,
    scene: {
      ...ws,
      book: liveBook,
      chapter: { deletedAt: null, ...livePartOf },
    } satisfies Prisma.SceneWhereInput,
    character: ws satisfies Prisma.CharacterWhereInput,
    // A relationship is listed on its own only while both characters are live;
    // otherwise it returns with the trashed character.
    relationship: {
      ...ws,
      characterA: liveCharacter,
      characterB: liveCharacter,
    } satisfies Prisma.RelationshipWhereInput,
    note: ws satisfies Prisma.NoteWhereInput,
    idea: ws satisfies Prisma.IdeaWhereInput,
    // A structure is listed on its own only while its book (or series) and
    // owner are live.
    outline: {
      ...ws,
      AND: [
        { OR: [{ book: liveBook }, { series: liveSeries }] },
        { OR: [{ relationshipId: null }, { relationship: liveRelationship }] },
        { OR: [{ characterId: null }, { character: liveCharacter }] },
      ],
    } satisfies Prisma.OutlineWhereInput,
    task: ws satisfies Prisma.TaskWhereInput,
    event: ws satisfies Prisma.CalendarEventWhereInput,
  };
}

export async function listTrash(ctx: AuthorContext): Promise<TrashItem[]> {
  const where = whereFor(ctx);
  const base = { id: true, deletedAt: true } as const;
  const [
    series,
    books,
    parts,
    chapters,
    scenes,
    characters,
    relationships,
    notes,
    ideas,
    outlines,
    tasks,
    events,
  ] = await Promise.all([
    db.series.findMany({
      where: where.series,
      select: { ...base, title: true, penName: { select: { name: true } } },
    }),
    db.book.findMany({
      where: where.book,
      select: {
        ...base,
        title: true,
        series: { select: { title: true } },
        penName: { select: { name: true } },
      },
    }),
    db.part.findMany({
      where: where.part,
      select: { ...base, title: true, book: { select: { title: true } } },
    }),
    db.chapter.findMany({
      where: where.chapter,
      select: {
        ...base,
        title: true,
        book: { select: { title: true } },
        part: { select: { title: true } },
      },
    }),
    db.scene.findMany({
      where: where.scene,
      select: {
        ...base,
        title: true,
        book: { select: { title: true } },
        chapter: { select: { title: true } },
      },
    }),
    db.character.findMany({ where: where.character, select: { ...base, name: true } }),
    db.relationship.findMany({
      where: where.relationship,
      select: {
        ...base,
        type: true,
        characterA: { select: { name: true } },
        characterB: { select: { name: true } },
      },
    }),
    db.note.findMany({ where: where.note, select: { ...base, title: true } }),
    db.idea.findMany({ where: where.idea, select: { ...base, title: true } }),
    db.outline.findMany({
      where: where.outline,
      select: {
        ...base,
        title: true,
        book: { select: { title: true } },
        series: { select: { title: true } },
      },
    }),
    db.task.findMany({ where: where.task, select: { ...base, title: true } }),
    db.calendarEvent.findMany({ where: where.event, select: { ...base, title: true } }),
  ]);

  const items: TrashItem[] = [
    ...series.map((s) => item(s, "SERIES", s.title, s.penName.name)),
    ...books.map((b) => item(b, "BOOK", b.title, b.series?.title ?? b.penName.name)),
    ...parts.map((p) => item(p, "PART", p.title, p.book.title)),
    ...chapters.map((c) => item(c, "CHAPTER", c.title, trail(c.book.title, c.part?.title))),
    ...scenes.map((s) => item(s, "SCENE", s.title, trail(s.book.title, s.chapter.title))),
    ...characters.map((c) => item(c, "CHARACTER", c.name, null)),
    ...relationships.map((r) =>
      item(r, "RELATIONSHIP", `${r.characterA.name} & ${r.characterB.name}`, r.type),
    ),
    ...notes.map((n) => item(n, "NOTE", n.title, null)),
    ...ideas.map((i) => item(i, "IDEA", i.title, null)),
    ...outlines.map((o) => item(o, "OUTLINE", o.title, o.book?.title ?? o.series?.title ?? null)),
    ...tasks.map((t) => item(t, "TASK", t.title, null)),
    ...events.map((e) => item(e, "EVENT", e.title, null)),
  ];
  return items.sort((a, b) => b.deletedAt.getTime() - a.deletedAt.getTime());
}

function item(
  row: { id: string; deletedAt: Date | null },
  kind: StoryNodeKind,
  title: string,
  context: string | null,
): TrashItem {
  return { id: row.id, kind, title, context, deletedAt: row.deletedAt! };
}

function trail(...parts: (string | null | undefined)[]) {
  return parts.filter(Boolean).join(" › ");
}

function unreachable(kind: never): never {
  throw new Error(`Unhandled story node kind: ${String(kind)}`);
}

/** Confirms the item is currently listed in this workspace's Trash. */
async function requireTrashed(ctx: AuthorContext, kind: StoryNodeKind, id: string) {
  const where = whereFor(ctx);
  const select = { id: true } as const;
  const found = await (() => {
    switch (kind) {
      case "SERIES":
        return db.series.findFirst({ where: { ...where.series, id }, select });
      case "BOOK":
        return db.book.findFirst({ where: { ...where.book, id }, select });
      case "PART":
        return db.part.findFirst({ where: { ...where.part, id }, select });
      case "CHAPTER":
        return db.chapter.findFirst({ where: { ...where.chapter, id }, select });
      case "SCENE":
        return db.scene.findFirst({ where: { ...where.scene, id }, select });
      case "CHARACTER":
        return db.character.findFirst({ where: { ...where.character, id }, select });
      case "RELATIONSHIP":
        return db.relationship.findFirst({ where: { ...where.relationship, id }, select });
      case "NOTE":
        return db.note.findFirst({ where: { ...where.note, id }, select });
      case "IDEA":
        return db.idea.findFirst({ where: { ...where.idea, id }, select });
      case "OUTLINE":
        return db.outline.findFirst({ where: { ...where.outline, id }, select });
      case "TASK":
        return db.task.findFirst({ where: { ...where.task, id }, select });
      case "EVENT":
        return db.calendarEvent.findFirst({ where: { ...where.event, id }, select });
      default:
        return unreachable(kind);
    }
  })();
  if (!found) throw new NotFoundError("Item in the Trash");
}

export async function restoreFromTrash(ctx: AuthorContext, kind: StoryNodeKind, id: string) {
  await requireTrashed(ctx, kind, id);
  const args = { where: { id }, data: { deletedAt: null } };
  switch (kind) {
    case "SERIES":
      return void (await db.series.update(args));
    case "BOOK":
      return void (await db.book.update(args));
    case "PART":
      return void (await db.part.update(args));
    case "CHAPTER":
      return void (await db.chapter.update(args));
    case "SCENE":
      return void (await db.scene.update(args));
    case "CHARACTER":
      return void (await db.character.update(args));
    case "RELATIONSHIP":
      return void (await db.relationship.update(args));
    case "NOTE":
      return void (await db.note.update(args));
    case "IDEA":
      return void (await db.idea.update(args));
    case "OUTLINE":
      return void (await db.outline.update(args));
    case "TASK":
      return void (await db.task.update(args));
    case "EVENT":
      return void (await db.calendarEvent.update(args));
    default:
      return unreachable(kind);
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
