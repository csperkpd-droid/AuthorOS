import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { searchConfigFor } from "@/lib/languages";
import { kindsWhere, resolveNodes, searchNodes, type NodeSummary } from "@/modules/story-graph";
import type { AuthorContext } from "@/server/context";
import { assertCanView } from "@/server/policy";

/**
 * Global search across the Story Graph. Two kinds of matching, combined:
 *
 * - **Exact words** ('simple' configuration, any language): every word as a
 *   prefix ("lighth" finds "lighthouse"), and "quoted phrases" exactly.
 *   Uses the expression GIN indexes. Always on, so exact title and phrase
 *   searches work regardless of language.
 * - **Word forms in the pen name's language:** for identities with a
 *   writing language, the same words are also stemmed in that language
 *   ("running" finds "run"), over that identity's scenes and characters;
 *   shared notes and ideas use the languages of the identities in scope.
 *   Languages belong to pen names, never to the whole workspace.
 *
 * Other kinds are matched by title. Results are resolved through the Story
 * Graph, so visibility (Trash) and "Writing as" apply as everywhere else.
 * Read-only.
 */

export type SearchResult = {
  node: NodeSummary;
  /** A passage around the match, with matches wrapped in « ». */
  snippet: string | null;
};

/** Kinds matched by title (the others by full text), from the Story Object Registry. */
const TITLE_KINDS = kindsWhere((t) => t.search === "title");

const WORD = /[\p{L}\p{N}]+/gu;

/** Splits a query into loose words and "quoted phrases". */
export function parseQuery(query: string): { words: string[]; phrases: string[] } {
  const phrases: string[] = [];
  const rest = query.replace(/"([^"]+)"/g, (_, phrase: string) => {
    if ((phrase.match(WORD) ?? []).length) phrases.push(phrase.trim());
    return " ";
  });
  return {
    words: (rest.toLowerCase().match(WORD) ?? []).slice(0, 8),
    phrases: phrases.slice(0, 3),
  };
}

/** "lighthouse kee" → "lighthouse:* & kee:*" (letters and digits only: safe). */
export function toPrefixQuery(query: string): string | null {
  const { words } = parseQuery(query);
  return words.length ? words.map((w) => `${w}:*`).join(" & ") : null;
}

const HEADLINE =
  "StartSel=«,StopSel=»,MaxFragments=1,MaxWords=24,MinWords=10,ShortWord=2,FragmentDelimiter= … ";

type Hit = { id: string; rank: number; snippet: string | null };

/** The tsquery for exact matching: prefixes of loose words AND each phrase. */
function exactQuery(words: string[], phrases: string[]): Prisma.Sql | null {
  const parts: Prisma.Sql[] = [];
  if (words.length)
    parts.push(Prisma.sql`to_tsquery('simple', ${words.map((w) => `${w}:*`).join(" & ")})`);
  for (const p of phrases) parts.push(Prisma.sql`phraseto_tsquery('simple', ${p})`);
  return parts.length ? Prisma.join(parts, " && ") : null;
}

/** Exact matching over every text-bearing kind (uses the 'simple' indexes). */
async function exactHits(ctx: AuthorContext, q: Prisma.Sql, limit: number): Promise<Hit[]> {
  const ws = ctx.workspaceId;
  // Each WHERE expression matches its index exactly.
  return db.$queryRaw<Hit[]>`
    SELECT id, rank, snippet FROM (
      SELECT "id", ts_rank(to_tsvector('simple', "title" || ' ' || coalesce("synopsis", '') || ' ' || "content_text"), (${q})) AS rank,
             ts_headline('simple', "content_text", (${q}), ${HEADLINE}) AS snippet
        FROM "scenes"
       WHERE "workspace_id" = ${ws}::uuid AND "deleted_at" IS NULL
         AND to_tsvector('simple', "title" || ' ' || coalesce("synopsis", '') || ' ' || "content_text") @@ (${q})
      UNION ALL
      SELECT "id", ts_rank(to_tsvector('simple', "title" || ' ' || "body_text"), (${q})),
             ts_headline('simple', "body_text", (${q}), ${HEADLINE})
        FROM "notes"
       WHERE "workspace_id" = ${ws}::uuid AND "deleted_at" IS NULL
         AND to_tsvector('simple', "title" || ' ' || "body_text") @@ (${q})
      UNION ALL
      SELECT "id", ts_rank(to_tsvector('simple', "title" || ' ' || coalesce("body", '')), (${q})),
             ts_headline('simple', coalesce("body", ''), (${q}), ${HEADLINE})
        FROM "ideas"
       WHERE "workspace_id" = ${ws}::uuid AND "deleted_at" IS NULL
         AND to_tsvector('simple', "title" || ' ' || coalesce("body", '')) @@ (${q})
      UNION ALL
      SELECT "id", ts_rank(to_tsvector('simple', "name" || ' ' || "search_join"("aliases") || ' ' || coalesce("summary", '')), (${q})),
             ts_headline('simple', coalesce("summary", ''), (${q}), ${HEADLINE})
        FROM "characters"
       WHERE "workspace_id" = ${ws}::uuid AND "deleted_at" IS NULL
         AND to_tsvector('simple', "name" || ' ' || "search_join"("aliases") || ' ' || coalesce("summary", '')) @@ (${q})
    ) hits
    ORDER BY rank DESC
    LIMIT ${limit}`;
}

/**
 * Stemmed matching in one language, over the scenes and characters of the
 * pen names that write in it, and over shared notes and ideas. Filtered to
 * the workspace's rows first; per-language indexes can be added if needed.
 */
async function stemmedHits(
  ctx: AuthorContext,
  {
    config,
    penNameIds,
    words,
    phrases,
    limit,
  }: {
    config: string;
    penNameIds: string[];
    words: string[];
    phrases: string[];
    limit: number;
  },
): Promise<Hit[]> {
  const ws = ctx.workspaceId;
  const cfg = Prisma.sql`${config}::regconfig`;
  const stem = Prisma.sql`plainto_tsquery(${cfg}, ${words.join(" ")})`;
  // Phrases stay exact: checked against the 'simple' vector.
  const phraseCheck = (simpleVector: Prisma.Sql) =>
    phrases.length
      ? Prisma.sql`AND ${simpleVector} @@ (${Prisma.join(
          phrases.map((p) => Prisma.sql`phraseto_tsquery('simple', ${p})`),
          " && ",
        )})`
      : Prisma.empty;
  const sceneText = Prisma.sql`s."title" || ' ' || coalesce(s."synopsis", '') || ' ' || s."content_text"`;
  const characterText = Prisma.sql`c."name" || ' ' || "search_join"(c."aliases") || ' ' || coalesce(c."summary", '')`;
  return db.$queryRaw<Hit[]>`
    SELECT id, rank, snippet FROM (
      SELECT s."id", ts_rank(to_tsvector(${cfg}, ${sceneText}), ${stem}) AS rank,
             ts_headline(${cfg}, s."content_text", ${stem}, ${HEADLINE}) AS snippet
        FROM "scenes" s JOIN "books" b ON b."id" = s."book_id"
       WHERE s."workspace_id" = ${ws}::uuid AND s."deleted_at" IS NULL
         AND b."pen_name_id" = ANY(${penNameIds}::uuid[])
         AND to_tsvector(${cfg}, ${sceneText}) @@ ${stem}
         ${phraseCheck(Prisma.sql`to_tsvector('simple', ${sceneText})`)}
      UNION ALL
      SELECT c."id", ts_rank(to_tsvector(${cfg}, ${characterText}), ${stem}),
             ts_headline(${cfg}, coalesce(c."summary", ''), ${stem}, ${HEADLINE})
        FROM "characters" c
       WHERE c."workspace_id" = ${ws}::uuid AND c."deleted_at" IS NULL
         AND c."pen_name_id" = ANY(${penNameIds}::uuid[])
         AND to_tsvector(${cfg}, ${characterText}) @@ ${stem}
         ${phraseCheck(Prisma.sql`to_tsvector('simple', ${characterText})`)}
      UNION ALL
      SELECT n."id", ts_rank(to_tsvector(${cfg}, n."title" || ' ' || n."body_text"), ${stem}),
             ts_headline(${cfg}, n."body_text", ${stem}, ${HEADLINE})
        FROM "notes" n
       WHERE n."workspace_id" = ${ws}::uuid AND n."deleted_at" IS NULL
         AND to_tsvector(${cfg}, n."title" || ' ' || n."body_text") @@ ${stem}
         ${phraseCheck(Prisma.sql`to_tsvector('simple', n."title" || ' ' || n."body_text")`)}
      UNION ALL
      SELECT i."id", ts_rank(to_tsvector(${cfg}, i."title" || ' ' || coalesce(i."body", '')), ${stem}),
             ts_headline(${cfg}, coalesce(i."body", ''), ${stem}, ${HEADLINE})
        FROM "ideas" i
       WHERE i."workspace_id" = ${ws}::uuid AND i."deleted_at" IS NULL
         AND to_tsvector(${cfg}, i."title" || ' ' || coalesce(i."body", '')) @@ ${stem}
         ${phraseCheck(Prisma.sql`to_tsvector('simple', i."title" || ' ' || coalesce(i."body", ''))`)}
    ) hits
    ORDER BY rank DESC
    LIMIT ${limit}`;
}

/** Pen names in scope with a writing language, grouped by search configuration. */
async function languagesInScope(ctx: AuthorContext, penNameId: string | null) {
  const pens = await db.penName.findMany({
    where: {
      workspaceId: ctx.workspaceId,
      language: { not: null },
      ...(penNameId ? { id: penNameId } : {}),
    },
    select: { id: true, language: true },
  });
  const byConfig = new Map<string, string[]>();
  for (const p of pens) {
    const config = searchConfigFor(p.language);
    if (config === "simple") continue;
    byConfig.set(config, [...(byConfig.get(config) ?? []), p.id]);
  }
  return byConfig;
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
  assertCanView(ctx, "any");
  const { words, phrases } = parseQuery(query);
  const exact = exactQuery(words, phrases);
  if (!exact) return [];
  const languages = words.length
    ? await languagesInScope(ctx, penNameId)
    : new Map<string, string[]>();
  const [exactResults, titled, ...stemmed] = await Promise.all([
    exactHits(ctx, exact, limit),
    searchNodes(ctx, {
      query: query.replaceAll('"', "").trim(),
      kinds: TITLE_KINDS,
      limit,
      penNameId,
    }),
    ...[...languages].map(([config, penNameIds]) =>
      stemmedHits(ctx, { config, penNameIds, words, phrases, limit }),
    ),
  ]);
  // Best rank per object; exact matches first when ranks tie.
  const best = new Map<string, Hit>();
  for (const hit of [...exactResults, ...stemmed.flat()]) {
    const seen = best.get(hit.id);
    if (!seen || hit.rank > seen.rank) best.set(hit.id, hit);
  }
  const hits = [...best.values()].sort((a, b) => b.rank - a.rank);
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
    results.push({
      node,
      snippet: hit.snippet && hit.snippet.includes("«") ? hit.snippet : null,
    });
  }
  return results.slice(0, limit);
}
