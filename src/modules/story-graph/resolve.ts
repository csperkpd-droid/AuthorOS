import "server-only";

import type { StoryNodeKind } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import type { AuthorContext } from "@/server/context";

import {
  liveBook,
  liveChapter,
  liveCharacter,
  liveEvent,
  liveIdea,
  liveNote,
  liveOutline,
  livePart,
  liveRelationship,
  liveScene,
  liveSeries,
  liveTask,
} from "./visibility";

/** Enough about any story object to show and link to it, and to check scope. */
export type NodeSummary = {
  id: string;
  kind: StoryNodeKind;
  title: string;
  /** Where it lives or what it is, e.g. "The Long Night › Chapter 3". */
  context: string | null;
  href: string;
  /**
   * The author identity this object belongs to. Null = shared across the
   * workspace's identities (notes, ideas).
   */
  penNameId: string | null;
  /** The series it belongs to, if any. */
  seriesId: string | null;
};

type Lookup = { ids?: string[]; query?: string; take?: number; penNameId?: string };

const contains = (query?: string) =>
  query ? { contains: query, mode: "insensitive" as const } : undefined;
const trail = (...parts: (string | null | undefined)[]) =>
  parts.filter(Boolean).join(" › ") || null;
const bookScope = { select: { title: true, penNameId: true, seriesId: true } } as const;

/**
 * Per-kind loaders. Each returns only visible objects in the workspace, and,
 * when `penNameId` is given, only objects of that identity (shared objects
 * always match). Adding a node kind means adding a case here (exhaustive).
 */
async function load(
  ctx: AuthorContext,
  kind: StoryNodeKind,
  { ids, query, take, penNameId }: Lookup,
): Promise<NodeSummary[]> {
  const ws = { workspaceId: ctx.workspaceId, ...(ids ? { id: { in: ids } } : {}) };
  const page = { take, orderBy: { updatedAt: "desc" as const } };
  const pen = penNameId ? { penNameId } : {};

  switch (kind) {
    case "SERIES": {
      const rows = await db.series.findMany({
        where: { ...ws, ...liveSeries, ...pen, title: contains(query) },
        select: { id: true, title: true, penNameId: true, penName: { select: { name: true } } },
        ...page,
      });
      return rows.map((r) => ({
        id: r.id,
        kind,
        title: r.title,
        context: r.penName.name,
        href: `/library/series/${r.id}`,
        penNameId: r.penNameId,
        seriesId: r.id,
      }));
    }
    case "BOOK": {
      const rows = await db.book.findMany({
        where: { ...ws, ...liveBook, ...pen, title: contains(query) },
        select: {
          id: true,
          title: true,
          penNameId: true,
          seriesId: true,
          series: { select: { title: true } },
          penName: { select: { name: true } },
        },
        ...page,
      });
      return rows.map((r) => ({
        id: r.id,
        kind,
        title: r.title,
        context: r.series?.title ?? r.penName.name,
        href: `/books/${r.id}`,
        penNameId: r.penNameId,
        seriesId: r.seriesId,
      }));
    }
    case "PART": {
      const rows = await db.part.findMany({
        where: { ...ws, ...livePart, ...(penNameId ? { book: pen } : {}), title: contains(query) },
        select: { id: true, title: true, bookId: true, book: bookScope },
        ...page,
      });
      return rows.map((r) => ({
        id: r.id,
        kind,
        title: r.title,
        context: r.book.title,
        href: `/books/${r.bookId}`,
        penNameId: r.book.penNameId,
        seriesId: r.book.seriesId,
      }));
    }
    case "CHAPTER": {
      const rows = await db.chapter.findMany({
        where: {
          ...ws,
          ...liveChapter,
          ...(penNameId ? { book: pen } : {}),
          title: contains(query),
        },
        select: {
          id: true,
          title: true,
          bookId: true,
          book: bookScope,
          part: { select: { title: true } },
        },
        ...page,
      });
      return rows.map((r) => ({
        id: r.id,
        kind,
        title: r.title,
        context: trail(r.book.title, r.part?.title),
        href: `/books/${r.bookId}`,
        penNameId: r.book.penNameId,
        seriesId: r.book.seriesId,
      }));
    }
    case "SCENE": {
      const rows = await db.scene.findMany({
        where: { ...ws, ...liveScene, ...(penNameId ? { book: pen } : {}), title: contains(query) },
        select: {
          id: true,
          title: true,
          bookId: true,
          book: bookScope,
          chapter: { select: { title: true } },
        },
        ...page,
      });
      return rows.map((r) => ({
        id: r.id,
        kind,
        title: r.title,
        context: trail(r.book.title, r.chapter.title),
        href: `/books/${r.bookId}/scenes/${r.id}`,
        penNameId: r.book.penNameId,
        seriesId: r.book.seriesId,
      }));
    }
    case "CHARACTER": {
      const rows = await db.character.findMany({
        where: {
          ...ws,
          ...liveCharacter,
          ...pen,
          ...(query ? { OR: [{ name: contains(query) }, { aliases: { has: query } }] } : {}),
        },
        select: {
          id: true,
          name: true,
          penNameId: true,
          seriesId: true,
          series: { select: { title: true } },
        },
        ...page,
      });
      return rows.map((r) => ({
        id: r.id,
        kind,
        title: r.name,
        context: r.series?.title ?? null,
        href: `/characters/${r.id}`,
        penNameId: r.penNameId,
        seriesId: r.seriesId,
      }));
    }
    case "RELATIONSHIP": {
      const rows = await db.relationship.findMany({
        where: {
          ...ws,
          ...liveRelationship,
          AND: [
            ...(penNameId ? [{ members: { some: { character: pen } } }] : []),
            ...(query
              ? [
                  {
                    OR: [
                      { type: contains(query) },
                      { members: { some: { character: { name: contains(query) } } } },
                    ],
                  },
                ]
              : []),
          ],
        },
        select: {
          id: true,
          type: true,
          members: {
            orderBy: { position: "asc" },
            select: { character: { select: { name: true, penNameId: true, seriesId: true } } },
          },
        },
        ...page,
      });
      return rows.map((r) => {
        const members = r.members.map((m) => m.character);
        const names = members.map((m) => m.name);
        const series = new Set(members.map((m) => m.seriesId));
        return {
          id: r.id,
          kind,
          title:
            names.length <= 2
              ? names.join(" & ")
              : `${names.slice(0, -1).join(", ")} & ${names.at(-1)}`,
          context: r.type,
          href: `/relationships/${r.id}`,
          // Members share one pen name; a series only if they all share it.
          penNameId: members[0]?.penNameId ?? null,
          seriesId: series.size === 1 ? [...series][0] : null,
        };
      });
    }
    case "OUTLINE": {
      const rows = await db.outline.findMany({
        where: {
          ...ws,
          ...liveOutline,
          ...(penNameId ? { AND: [{ OR: [{ book: pen }, { series: pen }] }] } : {}),
          title: contains(query),
        },
        select: {
          id: true,
          title: true,
          seriesId: true,
          book: bookScope,
          series: { select: { title: true, penNameId: true } },
        },
        ...page,
      });
      // A structure belongs to a book or to a whole series.
      return rows.map((r) => ({
        id: r.id,
        kind,
        title: r.title,
        context: r.book?.title ?? r.series?.title ?? null,
        href: `/structure/${r.id}`,
        penNameId: r.book?.penNameId ?? r.series!.penNameId,
        seriesId: r.book ? r.book.seriesId : r.seriesId,
      }));
    }
    case "NOTE": {
      const rows = await db.note.findMany({
        where: { ...ws, ...liveNote, title: contains(query) },
        select: { id: true, title: true },
        ...page,
      });
      return rows.map((r) => ({
        id: r.id,
        kind,
        title: r.title,
        context: null,
        href: `/notes/${r.id}`,
        penNameId: null,
        seriesId: null,
      }));
    }
    case "IDEA": {
      const rows = await db.idea.findMany({
        where: { ...ws, ...liveIdea, title: contains(query) },
        select: { id: true, title: true },
        ...page,
      });
      return rows.map((r) => ({
        id: r.id,
        kind,
        title: r.title,
        context: null,
        href: `/ideas/${r.id}`,
        penNameId: null,
        seriesId: null,
      }));
    }
    case "TASK": {
      const rows = await db.task.findMany({
        where: { ...ws, ...liveTask, title: contains(query) },
        select: { id: true, title: true, status: true },
        ...page,
      });
      return rows.map((r) => ({
        id: r.id,
        kind,
        title: r.title,
        context: r.status === "DONE" ? "Done" : null,
        href: `/tasks/${r.id}`,
        penNameId: null,
        seriesId: null,
      }));
    }
    case "EVENT": {
      const rows = await db.calendarEvent.findMany({
        where: { ...ws, ...liveEvent, title: contains(query) },
        select: { id: true, title: true, startsOn: true },
        ...page,
      });
      return rows.map((r) => ({
        id: r.id,
        kind,
        title: r.title,
        context: r.startsOn.toISOString().slice(0, 10),
        href: `/calendar/events/${r.id}`,
        penNameId: null,
        seriesId: null,
      }));
    }
  }
}

/**
 * Summaries of the given nodes that exist in this workspace and are visible.
 * Missing, foreign or trashed ids are simply absent from the result.
 */
export async function resolveNodes(
  ctx: AuthorContext,
  ids: string[],
): Promise<Map<string, NodeSummary>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const nodes = await db.storyNode.findMany({
    where: { workspaceId: ctx.workspaceId, id: { in: unique } },
    select: { id: true, kind: true },
  });
  const byKind = new Map<StoryNodeKind, string[]>();
  for (const n of nodes) byKind.set(n.kind, [...(byKind.get(n.kind) ?? []), n.id]);

  const results = await Promise.all(
    [...byKind].map(([kind, kindIds]) => load(ctx, kind, { ids: kindIds })),
  );
  return new Map(results.flat().map((s) => [s.id, s]));
}

export async function resolveNode(ctx: AuthorContext, id: string): Promise<NodeSummary | null> {
  return (await resolveNodes(ctx, [id])).get(id) ?? null;
}

/**
 * Finds visible story objects of the given kinds by title (for pickers).
 * With `penNameId`, objects of other identities are excluded.
 */
export async function searchNodes(
  ctx: AuthorContext,
  {
    query,
    kinds,
    limit = 20,
    penNameId,
  }: { query: string; kinds: StoryNodeKind[]; limit?: number; penNameId?: string | null },
): Promise<NodeSummary[]> {
  const q = query.trim();
  const perKind = await Promise.all(
    kinds.map((kind) =>
      load(ctx, kind, { query: q || undefined, take: limit, penNameId: penNameId ?? undefined }),
    ),
  );
  const all = perKind.flat();
  if (!q) return all.slice(0, limit);
  // Prefix matches first, then alphabetical.
  const lower = q.toLowerCase();
  return all
    .sort((a, b) => {
      const ap = a.title.toLowerCase().startsWith(lower) ? 0 : 1;
      const bp = b.title.toLowerCase().startsWith(lower) ? 0 : 1;
      return ap - bp || a.title.localeCompare(b.title);
    })
    .slice(0, limit);
}

/** The kind of a node in this workspace, or null. */
export async function nodeKind(ctx: AuthorContext, id: string): Promise<StoryNodeKind | null> {
  const node = await db.storyNode.findFirst({
    where: { id, workspaceId: ctx.workspaceId },
    select: { kind: true },
  });
  return node?.kind ?? null;
}

/**
 * Whether two objects may be linked without crossing author identities:
 * same identity, or at least one of them shared.
 */
export function sameIdentity(a: Pick<NodeSummary, "penNameId">, b: Pick<NodeSummary, "penNameId">) {
  return a.penNameId === null || b.penNameId === null || a.penNameId === b.penNameId;
}
