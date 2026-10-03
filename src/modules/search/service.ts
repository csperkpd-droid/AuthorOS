import "server-only";

import { Prisma } from "@/generated/prisma/client";
import type { StoryNodeKind } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { resolveNodes, searchNodes, type NodeSummary } from "@/modules/story-graph";
import type { AuthorContext } from "@/server/context";

/**
 * Global search across the Story Graph. Text-heavy objects (scenes, notes,
 * ideas, characters) use Postgres full-text search on expression indexes
 * (see the migration; 'simple' configuration: any language, no stemming,
 * prefix matching); every other kind is matched by title. Results are
 * resolved through the Story Graph, so visibility (Trash) and "Writing as"
 * apply exactly as everywhere else. Read-only.
 */

export type SearchResult = {
  node: NodeSummary;
  /** A passage around the match, with matches wrapped in « ». */
  snippet: string | null;
};

const TITLE_KINDS: StoryNodeKind[] = [
  "SERIES",
  "BOOK",
  "PART",
  "CHAPTER",
  "RELATIONSHIP",
  "OUTLINE",
  "TASK",
  "EVENT",
];

/** "lighthouse kee" → "lighthouse:* & kee:*" (letters and digits only: safe). */
export function toPrefixQuery(query: string): string | null {
  const words = query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  return words.length
    ? words
        .slice(0, 8)
        .map((w) => `${w}:*`)
        .join(" & ")
    : null;
}

const HEADLINE =
  "StartSel=«,StopSel=»,MaxFragments=1,MaxWords=24,MinWords=10,ShortWord=2,FragmentDelimiter= … ";

type Hit = { id: string; rank: number; snippet: string | null };

async function fullText(ctx: AuthorContext, tsquery: string, limit: number): Promise<Hit[]> {
  const ws = ctx.workspaceId;
  const q = Prisma.sql`to_tsquery('simple', ${tsquery})`;
  // Each expression matches its index exactly.
  return db.$queryRaw<Hit[]>`
    SELECT id, rank, snippet FROM (
      SELECT "id", ts_rank(v, ${q}) AS rank,
             ts_headline('simple', "content_text", ${q}, ${HEADLINE}) AS snippet
        FROM "scenes",
             LATERAL (SELECT to_tsvector('simple', "title" || ' ' || coalesce("synopsis", '') || ' ' || "content_text") AS v) t
       WHERE "workspace_id" = ${ws}::uuid AND "deleted_at" IS NULL AND to_tsvector('simple', "title" || ' ' || coalesce("synopsis", '') || ' ' || "content_text") @@ ${q}
      UNION ALL
      SELECT "id", ts_rank(v, ${q}), ts_headline('simple', "body_text", ${q}, ${HEADLINE})
        FROM "notes", LATERAL (SELECT to_tsvector('simple', "title" || ' ' || "body_text") AS v) t
       WHERE "workspace_id" = ${ws}::uuid AND "deleted_at" IS NULL AND to_tsvector('simple', "title" || ' ' || "body_text") @@ ${q}
      UNION ALL
      SELECT "id", ts_rank(v, ${q}), ts_headline('simple', coalesce("body", ''), ${q}, ${HEADLINE})
        FROM "ideas", LATERAL (SELECT to_tsvector('simple', "title" || ' ' || coalesce("body", '')) AS v) t
       WHERE "workspace_id" = ${ws}::uuid AND "deleted_at" IS NULL AND to_tsvector('simple', "title" || ' ' || coalesce("body", '')) @@ ${q}
      UNION ALL
      SELECT "id", ts_rank(v, ${q}), ts_headline('simple', coalesce("summary", ''), ${q}, ${HEADLINE})
        FROM "characters",
             LATERAL (SELECT to_tsvector('simple', "name" || ' ' || "search_join"("aliases") || ' ' || coalesce("summary", '')) AS v) t
       WHERE "workspace_id" = ${ws}::uuid AND "deleted_at" IS NULL AND to_tsvector('simple', "name" || ' ' || "search_join"("aliases") || ' ' || coalesce("summary", '')) @@ ${q}
    ) hits
    ORDER BY rank DESC
    LIMIT ${limit}`;
}

/**
 * Searches everything visible. With `penNameId`, objects of other identities
 * are left out (shared notes, ideas, tasks and events always match).
 */
export async function search(
  ctx: AuthorContext,
  {
    query,
    penNameId = null,
    limit = 50,
  }: { query: string; penNameId?: string | null; limit?: number },
): Promise<SearchResult[]> {
  const tsquery = toPrefixQuery(query);
  if (!tsquery) return [];
  const [hits, titled] = await Promise.all([
    fullText(ctx, tsquery, limit),
    searchNodes(ctx, { query: query.trim(), kinds: TITLE_KINDS, limit, penNameId }),
  ]);
  const nodes = await resolveNodes(
    ctx,
    hits.map((h) => h.id),
  );
  const inIdentity = (n: NodeSummary) =>
    !penNameId || n.penNameId === null || n.penNameId === penNameId;

  const results: SearchResult[] = [];
  const seen = new Set<string>();
  // Title matches of structural kinds first (they're usually what you meant),
  // then text matches by relevance.
  for (const node of titled) {
    if (seen.has(node.id)) continue;
    seen.add(node.id);
    results.push({ node, snippet: null });
  }
  for (const hit of hits) {
    const node = nodes.get(hit.id);
    if (!node || seen.has(node.id) || !inIdentity(node)) continue;
    seen.add(node.id);
    results.push({ node, snippet: hit.snippet && hit.snippet.includes("«") ? hit.snippet : null });
  }
  return results.slice(0, limit);
}
