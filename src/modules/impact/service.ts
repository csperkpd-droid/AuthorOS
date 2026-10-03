import "server-only";

import type { Prisma, StoryNodeKind } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { ConflictError, NotFoundError, RuleError } from "@/lib/errors";
import { formatCount } from "@/lib/format";
import { positionAtEnd } from "@/lib/ordering";
import { requireAssignablePenName } from "@/modules/pen-names";
import { relationshipTitle } from "@/modules/relationships";
import type { AuthorContext } from "@/server/context";

import { buildReport } from "./report";
import type { ImpactBlocker, ImpactItem, ImpactReport } from "./types";

/**
 * Change Impact for identity moves: giving a standalone book, or a series,
 * another pen name. Identities are private from each other (characters,
 * relationships and structures never link across pen names), so the move
 * carries the book's associated story data with it:
 *
 * - the book (or the series and all its books) with its manuscript and
 *   structures;
 * - every character of the old pen name connected to that work: appearing in
 *   its scenes, owning its arcs, in a relationship with such a character, or
 *   linked to it, transitively (a series' own characters always move);
 * - their relationships;
 * - values of custom fields limited to the old pen name (the field is copied
 *   to the new pen name, or its same-named field reused).
 *
 * Shared objects (notes, ideas, tasks, events) keep their links. Anything of
 * the old pen name that is linked to the moving data but belongs to other
 * work (another book, a character of another series) blocks the move: it is
 * listed so the author can resolve it, and nothing is moved or orphaned.
 *
 * The author reviews the report, then applies it with its token; the plan is
 * recomputed under a lock and must still match.
 */

export type IdentityMove = { kind: "BOOK" | "SERIES"; id: string; toPenNameId: string };

type Client = Prisma.TransactionClient | typeof db;

const SHARED_KINDS: StoryNodeKind[] = ["NOTE", "IDEA", "TASK", "EVENT"];

type Plan = {
  report: ImpactReport;
  fromPenNameId: string;
  toPenNameId: string;
  bookIds: string[];
  seriesId: string | null;
  characterIds: string[];
  /** Pen-limited field definitions whose values move, by definition id. */
  fields: {
    id: string;
    nodeKind: StoryNodeKind;
    label: string;
    type: "TEXT" | "LONG_TEXT";
    nodeIds: string[];
  }[];
};

const inTrash = (deletedAt: Date | null) => (deletedAt ? { note: "in the Trash" } : {});

async function planIdentityMove(
  client: Client,
  ctx: AuthorContext,
  move: IdentityMove,
): Promise<Plan> {
  const ws = ctx.workspaceId;
  const toPen = await requireAssignablePenName(ctx, move.toPenNameId);

  // 1. The root: one standalone book, or a series with all of its books.
  let fromPenNameId: string;
  let fromPenName: string;
  let rootTitle: string;
  let seriesId: string | null = null;
  let books: { id: string; title: string; deletedAt: Date | null }[];
  if (move.kind === "BOOK") {
    const book = await client.book.findFirst({
      where: { id: move.id, workspaceId: ws, deletedAt: null },
      select: {
        id: true,
        title: true,
        seriesId: true,
        deletedAt: true,
        penName: { select: { id: true, name: true } },
      },
    });
    if (!book) throw new NotFoundError("Book");
    if (book.seriesId) {
      throw new RuleError("Books in a series use the series’ pen name. Change it on the series.");
    }
    fromPenNameId = book.penName.id;
    fromPenName = book.penName.name;
    rootTitle = book.title;
    books = [book];
  } else {
    const series = await client.series.findFirst({
      where: { id: move.id, workspaceId: ws, deletedAt: null },
      select: {
        id: true,
        title: true,
        penName: { select: { id: true, name: true } },
        books: { select: { id: true, title: true, deletedAt: true } },
      },
    });
    if (!series) throw new NotFoundError("Series");
    fromPenNameId = series.penName.id;
    fromPenName = series.penName.name;
    rootTitle = series.title;
    seriesId = series.id;
    books = series.books;
  }
  if (fromPenNameId === toPen.id) throw new RuleError(`It already belongs to ${toPen.name}.`);
  const bookIds = books.map((b) => b.id);

  // 2. Everything structurally inside the work moves with it (Trash included).
  const [parts, chapters, scenes, outlines] = await Promise.all([
    client.part.findMany({ where: { bookId: { in: bookIds } }, select: { id: true } }),
    client.chapter.findMany({ where: { bookId: { in: bookIds } }, select: { id: true } }),
    client.scene.findMany({ where: { bookId: { in: bookIds } }, select: { id: true } }),
    client.outline.findMany({
      where: {
        workspaceId: ws,
        OR: [{ bookId: { in: bookIds } }, ...(seriesId ? [{ seriesId }] : [])],
      },
      select: { id: true, title: true, deletedAt: true, characterId: true, relationshipId: true },
    }),
  ]);
  const structural = new Set<string>([
    ...bookIds,
    ...(seriesId ? [seriesId] : []),
    ...parts.map((p) => p.id),
    ...chapters.map((c) => c.id),
    ...scenes.map((s) => s.id),
    ...outlines.map((o) => o.id),
  ]);

  // 3. Associated characters and relationships, by closure.
  const characters = new Map<string, { id: string; name: string; deletedAt: Date | null }>();
  const relationships = new Map<string, { id: string; title: string; deletedAt: Date | null }>();
  const blockers: ImpactBlocker[] = [];
  const sharedLinked = new Set<string>();
  const pendingCharacters = new Set<string>();
  const pendingRelationships = new Set<string>();

  if (seriesId) {
    const own = await client.character.findMany({ where: { seriesId }, select: { id: true } });
    own.forEach((c) => pendingCharacters.add(c.id));
  }
  for (const o of outlines) {
    if (o.characterId) pendingCharacters.add(o.characterId);
    if (o.relationshipId) pendingRelationships.add(o.relationshipId);
  }

  const inside = (id: string) => structural.has(id) || characters.has(id) || relationships.has(id);
  let frontier = [...structural];
  const titleOf = new Map<string, string>([...books.map((b) => [b.id, b.title] as const)]);

  while (frontier.length || pendingCharacters.size || pendingRelationships.size) {
    // Admit pending characters (checking they aren't bound to another series).
    if (pendingCharacters.size) {
      const rows = await client.character.findMany({
        where: { id: { in: [...pendingCharacters] }, workspaceId: ws },
        select: {
          id: true,
          name: true,
          penNameId: true,
          seriesId: true,
          deletedAt: true,
          series: { select: { title: true } },
        },
      });
      pendingCharacters.clear();
      for (const c of rows) {
        if (characters.has(c.id) || c.penNameId !== fromPenNameId) continue;
        if (c.seriesId && c.seriesId !== seriesId) {
          blockers.push({
            title: c.name,
            href: `/characters/${c.id}`,
            reason: `Belongs to the series “${c.series!.title}”, which stays with ${fromPenName}.`,
          });
          continue;
        }
        characters.set(c.id, { id: c.id, name: c.name, deletedAt: c.deletedAt });
        titleOf.set(c.id, c.name);
        frontier.push(c.id);
      }
      // Their relationships come along (and so do the other characters in them).
      const rels = await client.relationship.findMany({
        where: {
          workspaceId: ws,
          members: { some: { characterId: { in: rows.map((r) => r.id) } } },
        },
        select: { id: true },
      });
      rels.forEach((r) => pendingRelationships.add(r.id));
    }
    if (pendingRelationships.size) {
      const rows = await client.relationship.findMany({
        where: { id: { in: [...pendingRelationships] }, workspaceId: ws },
        select: {
          id: true,
          deletedAt: true,
          members: {
            orderBy: { position: "asc" },
            select: { character: { select: { id: true, name: true, penNameId: true } } },
          },
        },
      });
      pendingRelationships.clear();
      for (const r of rows) {
        const members = r.members.map((m) => m.character);
        if (relationships.has(r.id) || members[0]?.penNameId !== fromPenNameId) continue;
        const title = relationshipTitle(members.map((m) => m.name));
        relationships.set(r.id, { id: r.id, title, deletedAt: r.deletedAt });
        titleOf.set(r.id, title);
        frontier.push(r.id);
        for (const m of members) if (!characters.has(m.id)) pendingCharacters.add(m.id);
      }
    }
    if (pendingCharacters.size) continue;
    if (!frontier.length) break;

    // Follow links out of everything admitted so far.
    const batch = frontier;
    frontier = [];
    const links = await client.connection.findMany({
      where: { workspaceId: ws, OR: [{ sourceId: { in: batch } }, { targetId: { in: batch } }] },
      select: { sourceId: true, targetId: true },
    });
    const outside = new Map<string, string>(); // other end → the inside end it links to
    for (const l of links) {
      if (!inside(l.sourceId)) outside.set(l.sourceId, l.targetId);
      if (!inside(l.targetId)) outside.set(l.targetId, l.sourceId);
    }
    if (!outside.size) continue;
    const nodes = await client.storyNode.findMany({
      where: { workspaceId: ws, id: { in: [...outside.keys()] } },
      select: { id: true, kind: true },
    });
    for (const n of nodes) {
      if (SHARED_KINDS.includes(n.kind)) sharedLinked.add(n.id);
      else if (n.kind === "CHARACTER") pendingCharacters.add(n.id);
      else if (n.kind === "RELATIONSHIP") pendingRelationships.add(n.id);
    }
    // Other work of the old pen name that is linked in: blockers.
    const elsewhere = nodes.filter(
      (n) => !SHARED_KINDS.includes(n.kind) && n.kind !== "CHARACTER" && n.kind !== "RELATIONSHIP",
    );
    for (const other of await describeWork(client, elsewhere)) {
      if (other.penNameId !== fromPenNameId) continue;
      const via = outside.get(other.id)!;
      blockers.push({
        title: other.title,
        href: other.href,
        reason: `Linked to “${titleOf.get(via) ?? "this work"}”, but it is other work of ${fromPenName}.`,
      });
    }
  }

  // Arcs owned by moving characters or relationships on other work block too.
  const ownerIds = { characters: [...characters.keys()], relationships: [...relationships.keys()] };
  const foreignArcs = await client.outline.findMany({
    where: {
      workspaceId: ws,
      id: { notIn: outlines.map((o) => o.id) },
      OR: [
        { characterId: { in: ownerIds.characters } },
        { relationshipId: { in: ownerIds.relationships } },
      ],
    },
    select: { id: true, title: true },
  });
  for (const arc of foreignArcs) {
    blockers.push({
      title: arc.title,
      href: `/structure/${arc.id}`,
      reason: `An arc of a moving character or relationship, on other work of ${fromPenName}.`,
    });
  }

  // 4. Custom fields limited to the old pen name, with values on moving objects.
  const movingNodeIds = [...structural, ...characters.keys(), ...relationships.keys()];
  const values = await client.nodeFieldValue.findMany({
    where: { workspaceId: ws, nodeId: { in: movingNodeIds }, field: { penNameId: fromPenNameId } },
    select: {
      nodeId: true,
      field: { select: { id: true, nodeKind: true, label: true, type: true } },
    },
  });
  const fieldMap = new Map<string, Plan["fields"][number]>();
  for (const v of values) {
    const f = fieldMap.get(v.field.id) ?? { ...v.field, nodeIds: [] };
    f.nodeIds.push(v.nodeId);
    fieldMap.set(v.field.id, f);
  }
  const fields = [...fieldMap.values()];

  // 5. The report.
  const sortItems = (items: ImpactItem[]) => items.sort((a, b) => a.title.localeCompare(b.title));
  const effect = `Moves to ${toPen.name}`;
  const bookItems = books.map((b) => ({
    id: b.id,
    title: b.title,
    href: `/books/${b.id}`,
    ...inTrash(b.deletedAt),
  }));
  const report = buildReport({
    title: `Move “${rootTitle}” to ${toPen.name}?`,
    description: `${rootTitle} moves from ${fromPenName} to ${toPen.name}, with the story data connected to it. Identities stay separate, so nothing stays linked across pen names.`,
    groups: [
      ...(seriesId
        ? [
            {
              key: "SERIES",
              label: "Series",
              noun: { one: "series", many: "series" },
              effect,
              items: [{ id: seriesId, title: rootTitle, href: `/library/series/${seriesId}` }],
            },
          ]
        : []),
      {
        key: "BOOK",
        label: "Books",
        noun: { one: "book", many: "books" },
        effect,
        items: bookItems,
        detail: [
          formatCount(chapters.length, "chapter"),
          formatCount(scenes.length, "scene"),
          ...(parts.length ? [formatCount(parts.length, "part")] : []),
        ].join(" · "),
      },
      {
        key: "CHARACTER",
        label: "Characters",
        noun: { one: "character", many: "characters" },
        effect,
        items: sortItems(
          [...characters.values()].map((c) => ({
            id: c.id,
            title: c.name,
            href: `/characters/${c.id}`,
            ...inTrash(c.deletedAt),
          })),
        ),
      },
      {
        key: "RELATIONSHIP",
        label: "Relationships",
        noun: { one: "relationship", many: "relationships" },
        effect,
        items: sortItems(
          [...relationships.values()].map((r) => ({
            id: r.id,
            title: r.title,
            href: `/relationships/${r.id}`,
            ...inTrash(r.deletedAt),
          })),
        ),
      },
      {
        key: "OUTLINE",
        label: "Story structures and romance arcs",
        noun: { one: "structure", many: "structures" },
        effect,
        items: sortItems(
          outlines.map((o) => ({
            id: o.id,
            title: o.title,
            href: `/structure/${o.id}`,
            ...inTrash(o.deletedAt),
          })),
        ),
      },
      {
        key: "FIELD",
        label: `Custom fields limited to ${fromPenName}`,
        noun: { one: "custom field", many: "custom fields" },
        effect: `Values kept; the field is copied to ${toPen.name}`,
        items: fields.map((f) => ({
          id: f.id,
          title: f.label,
          href: null,
          note: formatCount(f.nodeIds.length, "value"),
        })),
      },
      {
        key: "SHARED",
        label: "Shared notes, ideas, tasks and events",
        noun: { one: "linked item", many: "linked items" },
        effect: "Stay shared and keep their links",
        affected: false,
        count: sharedLinked.size,
        items: [],
      },
    ],
    blockers,
    extra: [toPen.id, fromPenNameId, [...structural].sort()],
  });

  return {
    report,
    fromPenNameId,
    toPenNameId: toPen.id,
    bookIds,
    seriesId,
    characterIds: [...characters.keys()],
    fields,
  };
}

/** Title, link and pen name of non-character work items (for blockers). */
async function describeWork(client: Client, nodes: { id: string; kind: StoryNodeKind }[]) {
  const ids = (kind: StoryNodeKind) => nodes.filter((n) => n.kind === kind).map((n) => n.id);
  const [series, books, parts, chapters, scenes, outlines] = await Promise.all([
    client.series.findMany({
      where: { id: { in: ids("SERIES") } },
      select: { id: true, title: true, penNameId: true },
    }),
    client.book.findMany({
      where: { id: { in: ids("BOOK") } },
      select: { id: true, title: true, penNameId: true },
    }),
    client.part.findMany({
      where: { id: { in: ids("PART") } },
      select: {
        id: true,
        title: true,
        bookId: true,
        book: { select: { penNameId: true, title: true } },
      },
    }),
    client.chapter.findMany({
      where: { id: { in: ids("CHAPTER") } },
      select: {
        id: true,
        title: true,
        bookId: true,
        book: { select: { penNameId: true, title: true } },
      },
    }),
    client.scene.findMany({
      where: { id: { in: ids("SCENE") } },
      select: {
        id: true,
        title: true,
        bookId: true,
        book: { select: { penNameId: true, title: true } },
      },
    }),
    client.outline.findMany({
      where: { id: { in: ids("OUTLINE") } },
      select: {
        id: true,
        title: true,
        book: { select: { penNameId: true } },
        series: { select: { penNameId: true } },
      },
    }),
  ]);
  return [
    ...series.map((s) => ({
      id: s.id,
      title: s.title,
      href: `/library/series/${s.id}`,
      penNameId: s.penNameId,
    })),
    ...books.map((b) => ({
      id: b.id,
      title: b.title,
      href: `/books/${b.id}`,
      penNameId: b.penNameId,
    })),
    ...[...parts, ...chapters].map((c) => ({
      id: c.id,
      title: `${c.book.title} › ${c.title}`,
      href: `/books/${c.bookId}`,
      penNameId: c.book.penNameId,
    })),
    ...scenes.map((s) => ({
      id: s.id,
      title: `${s.book.title} › ${s.title}`,
      href: `/books/${s.bookId}/scenes/${s.id}`,
      penNameId: s.book.penNameId,
    })),
    ...outlines.map((o) => ({
      id: o.id,
      title: o.title,
      href: `/structure/${o.id}`,
      penNameId: (o.book ?? o.series)!.penNameId,
    })),
  ];
}

/** "What will this affect?": the report for moving a book or series to another pen name. */
export async function previewIdentityMove(
  ctx: AuthorContext,
  move: IdentityMove,
): Promise<ImpactReport> {
  return (await planIdentityMove(db, ctx, move)).report;
}

/**
 * Moves the work and everything associated with it, as reviewed. Refused if
 * anything blocks the move or if the plan changed since the author reviewed
 * it (`token`).
 */
export async function applyIdentityMove(ctx: AuthorContext, move: IdentityMove, token: string) {
  await db.$transaction(async (tx) => {
    // Lock the root so concurrent moves of the same work serialize.
    if (move.kind === "BOOK") {
      await tx.$queryRaw`SELECT 1 FROM "books" WHERE "id" = ${move.id}::uuid FOR UPDATE`;
    } else {
      await tx.$queryRaw`SELECT 1 FROM "series" WHERE "id" = ${move.id}::uuid FOR UPDATE`;
    }
    const plan = await planIdentityMove(tx, ctx, move);
    if (plan.report.token !== token) {
      throw new ConflictError(
        "Something changed since you reviewed this. Review the changes again.",
      );
    }
    if (plan.report.blockers.length) {
      throw new RuleError("Some linked story data belongs to other work. Resolve it first.");
    }
    const to = plan.toPenNameId;
    if (plan.seriesId)
      await tx.series.update({ where: { id: plan.seriesId }, data: { penNameId: to } });
    await tx.book.updateMany({ where: { id: { in: plan.bookIds } }, data: { penNameId: to } });
    await tx.character.updateMany({
      where: { id: { in: plan.characterIds } },
      data: { penNameId: to },
    });

    // Pen-limited fields: copy (or reuse the same-named field) and move values.
    for (const f of plan.fields) {
      const existing = await tx.fieldDefinition.findFirst({
        where: {
          workspaceId: ctx.workspaceId,
          nodeKind: f.nodeKind,
          penNameId: to,
          label: { equals: f.label, mode: "insensitive" },
        },
        select: { id: true },
      });
      const target =
        existing ??
        (await tx.fieldDefinition.create({
          data: {
            workspaceId: ctx.workspaceId,
            nodeKind: f.nodeKind,
            penNameId: to,
            label: f.label,
            type: f.type,
            position: await nextFieldPosition(tx, ctx.workspaceId, f.nodeKind),
          },
          select: { id: true },
        }));
      await tx.nodeFieldValue.updateMany({
        where: { fieldId: f.id, nodeId: { in: f.nodeIds } },
        data: { fieldId: target.id },
      });
    }
  });
}

async function nextFieldPosition(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  nodeKind: StoryNodeKind,
) {
  const siblings = await tx.fieldDefinition.findMany({
    where: { workspaceId, nodeKind },
    select: { id: true, position: true },
  });
  return positionAtEnd(siblings);
}
