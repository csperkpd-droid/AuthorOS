import "server-only";

import type { StoryNodeKind } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import type { AuthorContext } from "@/server/context";
import { assertCanView, canView } from "@/server/policy";

import { adapterFor, type NodeSummary } from "./adapters";
import { storyObjectType } from "./kinds";

export type { NodeSummary } from "./adapters";

/**
 * The read funnel (M9): of these kinds, the ones the context may view. Every
 * path from an id or a query to story objects (resolver, pickers, search,
 * connections, backlinks) goes through it, so a future per-object grant is
 * added here once.
 */
export function viewableKinds(ctx: Pick<AuthorContext, "role">, kinds: StoryNodeKind[]) {
  return kinds.filter((kind) => canView(ctx, storyObjectType(kind).area));
}

/**
 * Summaries of the given nodes that exist in this workspace, are visible and
 * that the context may view. Missing, foreign, trashed or unviewable ids are
 * simply absent from the result (never distinguished).
 */
export async function resolveNodes(
  ctx: AuthorContext,
  ids: string[],
): Promise<Map<string, NodeSummary>> {
  assertCanView(ctx, "any");
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const nodes = await db.storyNode.findMany({
    where: { workspaceId: ctx.workspaceId, id: { in: unique } },
    select: { id: true, kind: true },
  });
  const byKind = new Map<StoryNodeKind, string[]>();
  for (const n of nodes) {
    if (viewableKinds(ctx, [n.kind]).length === 0) continue;
    byKind.set(n.kind, [...(byKind.get(n.kind) ?? []), n.id]);
  }

  const results = await Promise.all(
    [...byKind].map(([kind, kindIds]) => adapterFor(kind).load(ctx, { ids: kindIds })),
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
  assertCanView(ctx, "any");
  const q = query.trim();
  const perKind = await Promise.all(
    viewableKinds(ctx, kinds).map((kind) =>
      adapterFor(kind).load(ctx, {
        query: q || undefined,
        take: limit,
        penNameId: penNameId ?? undefined,
      }),
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

/** The kind of a node in this workspace that the context may view, or null. */
export async function nodeKind(ctx: AuthorContext, id: string): Promise<StoryNodeKind | null> {
  assertCanView(ctx, "any", { kind: "NODE", id });
  const node = await db.storyNode.findFirst({
    where: { id, workspaceId: ctx.workspaceId },
    select: { kind: true },
  });
  return node && viewableKinds(ctx, [node.kind]).length ? node.kind : null;
}

/**
 * Whether two objects may be linked without crossing author identities:
 * same identity, or at least one of them shared.
 */
export function sameIdentity(a: Pick<NodeSummary, "penNameId">, b: Pick<NodeSummary, "penNameId">) {
  return a.penNameId === null || b.penNameId === null || a.penNameId === b.penNameId;
}
