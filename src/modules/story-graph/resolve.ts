import "server-only";

import type { StoryNodeKind } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import type { AuthorContext } from "@/server/context";

import {
  liveBook,
  liveChapter,
  liveCharacter,
  liveIdea,
  liveNote,
  livePart,
  liveRelationship,
  liveScene,
  liveSeries,
} from "./visibility";

/** Enough about any story object to show and link to it. */
export type NodeSummary = {
  id: string;
  kind: StoryNodeKind;
  title: string;
  /** Where it lives or what it is, e.g. "The Long Night › Chapter 3". */
  context: string | null;
  href: string;
};

type Lookup = { ids?: string[]; query?: string; take?: number };

const contains = (query?: string) =>
  query ? { contains: query, mode: "insensitive" as const } : undefined;
const trail = (...parts: (string | null | undefined)[]) =>
  parts.filter(Boolean).join(" › ") || null;

/**
 * Per-kind loaders. Each returns only visible objects in the workspace. Adding
 * a node kind means adding a case here (the switch is exhaustive).
 */
async function load(
  ctx: AuthorContext,
  kind: StoryNodeKind,
  { ids, query, take }: Lookup,
): Promise<NodeSummary[]> {
  const ws = { workspaceId: ctx.workspaceId, ...(ids ? { id: { in: ids } } : {}) };
  const page = { take, orderBy: { updatedAt: "desc" as const } };

  switch (kind) {
    case "SERIES": {
      const rows = await db.series.findMany({
        where: { ...ws, ...liveSeries, title: contains(query) },
        select: { id: true, title: true, penName: { select: { name: true } } },
        ...page,
      });
      return rows.map((r) => ({
        id: r.id,
        kind,
        title: r.title,
        context: r.penName.name,
        href: `/library/series/${r.id}`,
      }));
    }
    case "BOOK": {
      const rows = await db.book.findMany({
        where: { ...ws, ...liveBook, title: contains(query) },
        select: {
          id: true,
          title: true,
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
      }));
    }
    case "PART": {
      const rows = await db.part.findMany({
        where: { ...ws, ...livePart, title: contains(query) },
        select: { id: true, title: true, bookId: true, book: { select: { title: true } } },
        ...page,
      });
      return rows.map((r) => ({
        id: r.id,
        kind,
        title: r.title,
        context: r.book.title,
        href: `/books/${r.bookId}`,
      }));
    }
    case "CHAPTER": {
      const rows = await db.chapter.findMany({
        where: { ...ws, ...liveChapter, title: contains(query) },
        select: {
          id: true,
          title: true,
          bookId: true,
          book: { select: { title: true } },
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
      }));
    }
    case "SCENE": {
      const rows = await db.scene.findMany({
        where: { ...ws, ...liveScene, title: contains(query) },
        select: {
          id: true,
          title: true,
          bookId: true,
          book: { select: { title: true } },
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
      }));
    }
    case "CHARACTER": {
      const rows = await db.character.findMany({
        where: {
          ...ws,
          ...liveCharacter,
          ...(query ? { OR: [{ name: contains(query) }, { aliases: { has: query } }] } : {}),
        },
        select: { id: true, name: true, series: { select: { title: true } } },
        ...page,
      });
      return rows.map((r) => ({
        id: r.id,
        kind,
        title: r.name,
        context: r.series?.title ?? null,
        href: `/characters/${r.id}`,
      }));
    }
    case "RELATIONSHIP": {
      const rows = await db.relationship.findMany({
        where: {
          ...ws,
          ...liveRelationship,
          ...(query
            ? {
                OR: [
                  { type: contains(query) },
                  { characterA: { name: contains(query) } },
                  { characterB: { name: contains(query) } },
                ],
              }
            : {}),
        },
        select: {
          id: true,
          type: true,
          characterA: { select: { name: true } },
          characterB: { select: { name: true } },
        },
        ...page,
      });
      return rows.map((r) => ({
        id: r.id,
        kind,
        title: `${r.characterA.name} & ${r.characterB.name}`,
        context: r.type,
        href: `/relationships/${r.id}`,
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

/** Finds visible story objects of the given kinds by title (for pickers). */
export async function searchNodes(
  ctx: AuthorContext,
  { query, kinds, limit = 20 }: { query: string; kinds: StoryNodeKind[]; limit?: number },
): Promise<NodeSummary[]> {
  const q = query.trim();
  const perKind = await Promise.all(
    kinds.map((kind) => load(ctx, kind, { query: q || undefined, take: limit })),
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
