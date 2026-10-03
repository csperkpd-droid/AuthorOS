import "server-only";

import type { Prisma, StoryNodeKind } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { buildReport } from "@/modules/impact";
import {
  liveBook,
  liveCharacter,
  liveRelationship,
  liveSeries,
  NODE_KIND_LABELS,
  purgeStoryNodes,
  resolveNodes,
} from "@/modules/story-graph";
import { relationshipTitle } from "@/modules/relationships";
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
    // A relationship is listed on its own only while all its members are live;
    // otherwise it returns with the trashed character.
    relationship: {
      ...ws,
      members: { every: { character: liveCharacter } },
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
        members: {
          orderBy: { position: "asc" },
          select: { character: { select: { name: true } } },
        },
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
      item(r, "RELATIONSHIP", relationshipTitle(r.members.map((m) => m.character.name)), r.type),
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

// ─── Deleting forever (with Change Impact) ──────────────────────────────────

type Doomed = Map<StoryNodeKind, { id: string; title: string }[]>;

/**
 * Every story object that deleting these trashed items forever removes:
 * the items, everything inside them, and what can't exist without them
 * (a deleted character ends their relationships, and arcs go with their
 * owner). Mirrors the database cascades.
 */
async function deletionSet(ctx: AuthorContext, roots: { kind: StoryNodeKind; id: string }[]) {
  const ws = ctx.workspaceId;
  const doomed: Doomed = new Map();
  const add = (kind: StoryNodeKind, rows: { id: string; title: string }[]) => {
    const list = doomed.get(kind) ?? [];
    for (const r of rows) if (!list.some((x) => x.id === r.id)) list.push(r);
    doomed.set(kind, list);
  };
  const ids = (kind: StoryNodeKind) => (doomed.get(kind) ?? []).map((r) => r.id);
  const byKind = (kind: StoryNodeKind) => roots.filter((r) => r.kind === kind).map((r) => r.id);

  const series = await db.series.findMany({
    where: { workspaceId: ws, id: { in: byKind("SERIES") } },
    select: { id: true, title: true },
  });
  add("SERIES", series);
  add(
    "BOOK",
    await db.book.findMany({
      where: {
        workspaceId: ws,
        OR: [{ id: { in: byKind("BOOK") } }, { seriesId: { in: ids("SERIES") } }],
      },
      select: { id: true, title: true },
    }),
  );
  add(
    "PART",
    await db.part.findMany({
      where: {
        workspaceId: ws,
        OR: [{ id: { in: byKind("PART") } }, { bookId: { in: ids("BOOK") } }],
      },
      select: { id: true, title: true },
    }),
  );
  add(
    "CHAPTER",
    await db.chapter.findMany({
      where: {
        workspaceId: ws,
        OR: [
          { id: { in: byKind("CHAPTER") } },
          { bookId: { in: ids("BOOK") } },
          { partId: { in: ids("PART") } },
        ],
      },
      select: { id: true, title: true },
    }),
  );
  add(
    "SCENE",
    await db.scene.findMany({
      where: {
        workspaceId: ws,
        OR: [
          { id: { in: byKind("SCENE") } },
          { bookId: { in: ids("BOOK") } },
          { chapterId: { in: ids("CHAPTER") } },
        ],
      },
      select: { id: true, title: true },
    }),
  );
  add(
    "CHARACTER",
    (
      await db.character.findMany({
        where: { workspaceId: ws, id: { in: byKind("CHARACTER") } },
        select: { id: true, name: true },
      })
    ).map((c) => ({ id: c.id, title: c.name })),
  );
  const rels = await db.relationship.findMany({
    where: {
      workspaceId: ws,
      OR: [
        { id: { in: byKind("RELATIONSHIP") } },
        { members: { some: { characterId: { in: ids("CHARACTER") } } } },
      ],
    },
    select: {
      id: true,
      members: { orderBy: { position: "asc" }, select: { character: { select: { name: true } } } },
    },
  });
  add(
    "RELATIONSHIP",
    rels.map((r) => ({
      id: r.id,
      title: relationshipTitle(r.members.map((m) => m.character.name)),
    })),
  );
  add(
    "OUTLINE",
    await db.outline.findMany({
      where: {
        workspaceId: ws,
        OR: [
          { id: { in: byKind("OUTLINE") } },
          { bookId: { in: ids("BOOK") } },
          { seriesId: { in: ids("SERIES") } },
          { characterId: { in: ids("CHARACTER") } },
          { relationshipId: { in: ids("RELATIONSHIP") } },
        ],
      },
      select: { id: true, title: true },
    }),
  );
  for (const [kind, find] of [
    [
      "NOTE",
      () =>
        db.note.findMany({
          where: { workspaceId: ws, id: { in: byKind("NOTE") } },
          select: { id: true, title: true },
        }),
    ],
    [
      "IDEA",
      () =>
        db.idea.findMany({
          where: { workspaceId: ws, id: { in: byKind("IDEA") } },
          select: { id: true, title: true },
        }),
    ],
    [
      "TASK",
      () =>
        db.task.findMany({
          where: { workspaceId: ws, id: { in: byKind("TASK") } },
          select: { id: true, title: true },
        }),
    ],
    [
      "EVENT",
      () =>
        db.calendarEvent.findMany({
          where: { workspaceId: ws, id: { in: byKind("EVENT") } },
          select: { id: true, title: true },
        }),
    ],
  ] as const) {
    add(kind, await find());
  }
  return doomed;
}

const NOUNS: Record<StoryNodeKind, [string, string]> = {
  SERIES: ["series", "series"],
  BOOK: ["book", "books"],
  PART: ["part", "parts"],
  CHAPTER: ["chapter", "chapters"],
  SCENE: ["scene", "scenes"],
  CHARACTER: ["character", "characters"],
  RELATIONSHIP: ["relationship", "relationships"],
  OUTLINE: ["structure", "structures"],
  NOTE: ["note", "notes"],
  IDEA: ["idea", "ideas"],
  TASK: ["task", "tasks"],
  EVENT: ["event", "events"],
};

/** The impact report for deleting these trashed items forever. */
async function deletionReport(
  ctx: AuthorContext,
  roots: { kind: StoryNodeKind; id: string; title: string }[],
  title: string,
) {
  const doomed = await deletionSet(ctx, roots);
  const all = [...doomed.values()].flat().map((r) => r.id);
  const ws = ctx.workspaceId;
  const [revisions, links, placements, fieldValues, keptCharacters, scopedFields] =
    await Promise.all([
      db.contentRevision.count({ where: { workspaceId: ws, nodeId: { in: all } } }),
      db.connection.findMany({
        where: { workspaceId: ws, OR: [{ sourceId: { in: all } }, { targetId: { in: all } }] },
        select: { id: true, sourceId: true, targetId: true },
      }),
      db.beatScene.count({
        where: {
          workspaceId: ws,
          OR: [{ sceneId: { in: all } }, { beat: { outlineId: { in: all } } }],
        },
      }),
      db.nodeFieldValue.count({ where: { workspaceId: ws, nodeId: { in: all } } }),
      db.character.findMany({
        where: {
          workspaceId: ws,
          seriesId: { in: (doomed.get("SERIES") ?? []).map((s) => s.id) },
          id: { notIn: all },
        },
        select: { id: true, name: true },
      }),
      db.fieldDefinition.findMany({
        where: {
          workspaceId: ws,
          OR: [
            { seriesId: { in: (doomed.get("SERIES") ?? []).map((s) => s.id) } },
            { bookId: { in: (doomed.get("BOOK") ?? []).map((b) => b.id) } },
          ],
        },
        select: { id: true, label: true, _count: { select: { values: true } } },
      }),
    ]);
  // Links to things that stay: the link goes, the other item stays.
  const doomedSet = new Set(all);
  const others = await resolveNodes(
    ctx,
    links.flatMap((l) => [l.sourceId, l.targetId]).filter((id) => !doomedSet.has(id)),
  );
  const rootIds = new Set(roots.map((r) => r.id));

  return buildReport({
    title,
    description:
      "Deleting forever removes these from your workspace, with everything inside them. It can’t be undone.",
    groups: [
      ...[...doomed].map(([kind, rows]) => ({
        key: kind,
        label: NODE_KIND_LABELS[kind].many,
        noun: { one: NOUNS[kind][0], many: NOUNS[kind][1] },
        effect: "Deleted",
        items: rows.map((r) => ({
          id: r.id,
          title: r.title,
          href: null,
          ...(rootIds.has(r.id) ? {} : { note: "inside or dependent" }),
        })),
      })),
      {
        key: "REVISIONS",
        label: "Version history",
        noun: { one: "saved version", many: "saved versions" },
        effect: "Deleted",
        count: revisions,
        items: [],
      },
      {
        key: "PLACEMENTS",
        label: "Beat placements",
        noun: { one: "beat placement", many: "beat placements" },
        effect: "Removed; other structures keep their beats",
        count: placements,
        items: [],
      },
      {
        key: "FIELD_VALUES",
        label: "Custom field values",
        noun: { one: "field value", many: "field values" },
        effect: "Deleted",
        count: fieldValues + scopedFields.reduce((n, f) => n + f._count.values, 0),
        items: [],
      },
      {
        key: "FIELDS",
        label: "Custom fields limited to this work",
        noun: { one: "custom field", many: "custom fields" },
        effect: "Deleted",
        items: scopedFields.map((f) => ({ id: f.id, title: f.label, href: null })),
      },
      {
        key: "LINKS",
        label: "Links to items that stay",
        noun: { one: "link", many: "links" },
        effect: "Link removed; the other items stay",
        count: links.filter((l) => !doomedSet.has(l.sourceId) || !doomedSet.has(l.targetId)).length,
        items: [...others.values()].map((n) => ({ id: n.id, title: n.title, href: n.href })),
      },
      {
        key: "KEPT_CHARACTERS",
        label: "Characters of the series",
        noun: { one: "character", many: "characters" },
        effect: "Stay, no longer tied to a series",
        affected: false,
        items: keptCharacters.map((c) => ({
          id: c.id,
          title: c.name,
          href: `/characters/${c.id}`,
        })),
      },
    ],
  });
}

async function trashedTitle(ctx: AuthorContext, kind: StoryNodeKind, id: string) {
  const item = (await listTrash(ctx)).find((i) => i.id === id && i.kind === kind);
  if (!item) throw new NotFoundError("Item in the Trash");
  return item;
}

/** "What will this affect?" for deleting one trashed item forever. */
export async function previewDeleteForever(ctx: AuthorContext, kind: StoryNodeKind, id: string) {
  const item = await trashedTitle(ctx, kind, id);
  return deletionReport(ctx, [item], `Delete “${item.title}” forever?`);
}

/** "What will this affect?" for emptying the Trash. */
export async function previewEmptyTrash(ctx: AuthorContext) {
  const items = await listTrash(ctx);
  return deletionReport(ctx, items, "Empty the Trash?");
}

function assertToken(report: { token: string }, token: string | undefined) {
  if (token !== undefined && report.token !== token) {
    throw new ConflictError("The Trash changed since you reviewed this. Review it again.");
  }
}

/** Permanently deletes an item and everything inside it. Cannot be undone. */
export async function deleteForever(
  ctx: AuthorContext,
  kind: StoryNodeKind,
  id: string,
  /** The reviewed report's token: refused if what would be deleted changed. */
  token?: string,
) {
  await requireTrashed(ctx, kind, id);
  if (token !== undefined) assertToken(await previewDeleteForever(ctx, kind, id), token);
  await db.$transaction((tx) => purgeStoryNodes(tx, ctx.workspaceId, [id]));
}

export async function emptyTrash(ctx: AuthorContext, token?: string): Promise<number> {
  if (token !== undefined) assertToken(await previewEmptyTrash(ctx), token);
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
