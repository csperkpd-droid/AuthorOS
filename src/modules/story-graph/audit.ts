import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import type { AuthorContext } from "@/server/context";
import { assertCanView } from "@/server/policy";

import { STORY_KINDS, STORY_OBJECT_TYPES } from "./kinds";

/**
 * Story Graph integrity audit: checks a workspace for orphaned references
 * and broken rules that the database's foreign keys can't express on their
 * own. Read-only. Each check names what it guards; an empty result means
 * the four layers are consistent:
 *
 * - story objects: every node has its typed row (and vice versa, by FK);
 * - structural hierarchy: books and characters stay in their series' pen
 *   name, scenes and chapters in their book;
 * - structure: beats stay inside their structure's book or series and
 *   identity; a placement outside them is never shown as current (validity);
 * - connections: never across pen names; a series' characters appear only
 *   in that series' books.
 *
 * Used by the tests after every kind of operation; cheap enough to run in
 * support tooling.
 */
export type AuditIssue = { check: string; count: number; sample: string[] };

type Row = { id: string };

export async function auditGraph(ctx: AuthorContext): Promise<AuditIssue[]> {
  assertCanView(ctx, "any");
  const ws = ctx.workspaceId;
  const checks: [string, Prisma.Sql][] = [];

  // Every node has its typed row (the reverse is enforced by foreign keys).
  for (const kind of STORY_KINDS) {
    const table = Prisma.raw(`"${STORY_OBJECT_TYPES[kind].table}"`);
    checks.push([
      `${kind} node without its row`,
      Prisma.sql`SELECT n."id" FROM "story_nodes" n
        WHERE n."workspace_id" = ${ws}::uuid AND n."kind" = ${kind}::"story_node_kind"
          AND NOT EXISTS (SELECT 1 FROM ${table} t WHERE t."id" = n."id")`,
    ]);
  }

  // A node's pen name (null = shared), for identity checks.
  const pen = (id: Prisma.Sql) => Prisma.sql`(
    SELECT coalesce(
      (SELECT p."id" FROM "pen_names" p WHERE p."id" = ${id}),
      (SELECT s."pen_name_id" FROM "series" s WHERE s."id" = ${id}),
      (SELECT b."pen_name_id" FROM "books" b WHERE b."id" = ${id}),
      (SELECT b."pen_name_id" FROM "parts" x JOIN "books" b ON b."id" = x."book_id" WHERE x."id" = ${id}),
      (SELECT b."pen_name_id" FROM "chapters" x JOIN "books" b ON b."id" = x."book_id" WHERE x."id" = ${id}),
      (SELECT b."pen_name_id" FROM "scenes" x JOIN "books" b ON b."id" = x."book_id" WHERE x."id" = ${id}),
      (SELECT c."pen_name_id" FROM "characters" c WHERE c."id" = ${id}),
      (SELECT c."pen_name_id" FROM "relationship_members" m JOIN "characters" c ON c."id" = m."character_id"
         WHERE m."relationship_id" = ${id} LIMIT 1),
      (SELECT coalesce(b."pen_name_id", s."pen_name_id") FROM "outlines" o
         LEFT JOIN "books" b ON b."id" = o."book_id" LEFT JOIN "series" s ON s."id" = o."series_id"
         WHERE o."id" = ${id}),
      (SELECT coalesce(b."pen_name_id", s."pen_name_id") FROM "beats" bt
         JOIN "outlines" o ON o."id" = bt."outline_id"
         LEFT JOIN "books" b ON b."id" = o."book_id" LEFT JOIN "series" s ON s."id" = o."series_id"
         WHERE bt."id" = ${id})
    ))`;

  checks.push(
    [
      "connection across pen names",
      Prisma.sql`SELECT link."id" FROM "connections" link
        WHERE link."workspace_id" = ${ws}::uuid
          AND ${pen(Prisma.sql`link."source_id"`)} IS NOT NULL
          AND ${pen(Prisma.sql`link."target_id"`)} IS NOT NULL
          AND ${pen(Prisma.sql`link."source_id"`)} <> ${pen(Prisma.sql`link."target_id"`)}`,
    ],
    [
      "character in a scene of another pen name",
      Prisma.sql`SELECT p."character_id" AS id FROM "scene_participations" p
        JOIN "characters" ch ON ch."id" = p."character_id"
        JOIN "scenes" sc ON sc."id" = p."scene_id"
        JOIN "books" b ON b."id" = sc."book_id"
        WHERE p."workspace_id" = ${ws}::uuid AND ch."pen_name_id" <> b."pen_name_id"`,
    ],
    [
      "scene with more than one point of view",
      Prisma.sql`SELECT p."scene_id" AS id FROM "scene_participations" p
        WHERE p."workspace_id" = ${ws}::uuid AND p."is_pov"
        GROUP BY p."scene_id" HAVING count(*) > 1`,
    ],
    [
      "series character appearing outside the series",
      Prisma.sql`SELECT p."character_id" AS id FROM "scene_participations" p
        JOIN "characters" ch ON ch."id" = p."character_id"
        JOIN "scenes" sc ON sc."id" = p."scene_id"
        JOIN "books" b ON b."id" = sc."book_id"
        WHERE p."workspace_id" = ${ws}::uuid
          AND ch."series_id" IS NOT NULL AND b."series_id" IS DISTINCT FROM ch."series_id"`,
    ],
    [
      "book in a series of another pen name",
      Prisma.sql`SELECT b."id" FROM "books" b JOIN "series" s ON s."id" = b."series_id"
        WHERE b."workspace_id" = ${ws}::uuid AND s."pen_name_id" <> b."pen_name_id"`,
    ],
    [
      "character in a series of another pen name",
      Prisma.sql`SELECT c."id" FROM "characters" c JOIN "series" s ON s."id" = c."series_id"
        WHERE c."workspace_id" = ${ws}::uuid AND s."pen_name_id" <> c."pen_name_id"`,
    ],
    [
      "relationship joining pen names",
      Prisma.sql`SELECT m."relationship_id" AS id FROM "relationship_members" m
        JOIN "characters" c ON c."id" = m."character_id"
        WHERE m."workspace_id" = ${ws}::uuid
        GROUP BY m."relationship_id" HAVING count(DISTINCT c."pen_name_id") > 1`,
    ],
    [
      "structure owner of another pen name",
      Prisma.sql`SELECT arc."id" FROM "outlines" arc
        WHERE arc."workspace_id" = ${ws}::uuid
          AND (arc."relationship_id" IS NOT NULL OR arc."character_id" IS NOT NULL)
          AND ${pen(Prisma.sql`coalesce(arc."relationship_id", arc."character_id")`)}
              <> ${pen(Prisma.sql`arc."id"`)}`,
    ],
    [
      "series beat planned for a book outside the series",
      Prisma.sql`SELECT ob."id" FROM "beats" ob
        JOIN "outlines" o ON o."id" = ob."outline_id"
        JOIN "books" b ON b."id" = ob."book_id"
        WHERE ob."workspace_id" = ${ws}::uuid
          AND ((o."series_id" IS NOT NULL AND b."series_id" IS DISTINCT FROM o."series_id")
            OR (o."book_id" IS NOT NULL AND ob."book_id" <> o."book_id"))`,
    ],
    [
      // Validity (M14): a placement outside its structure is kept, but never
      // as if it were current.
      "scene outside its structure placed as current",
      Prisma.sql`SELECT bs."scene_id" AS id FROM "beat_assignments" bs
        JOIN "beats" ob ON ob."id" = bs."beat_id"
        JOIN "outlines" o ON o."id" = ob."outline_id"
        JOIN "scenes" sc ON sc."id" = bs."scene_id"
        JOIN "books" b ON b."id" = sc."book_id"
        WHERE bs."workspace_id" = ${ws}::uuid AND bs."validity" = 'CURRENT'
          AND ((o."series_id" IS NOT NULL AND b."series_id" IS DISTINCT FROM o."series_id")
            OR (o."book_id" IS NOT NULL AND sc."book_id" <> o."book_id"))`,
    ],
    [
      "placement in the Trash shown as current",
      Prisma.sql`SELECT bs."scene_id" AS id FROM "beat_assignments" bs
        JOIN "scenes" sc ON sc."id" = bs."scene_id"
        WHERE bs."workspace_id" = ${ws}::uuid AND bs."validity" <> 'POTENTIALLY_STALE'
          AND sc."deleted_at" IS NOT NULL`,
    ],
    [
      "field value on the wrong kind of object",
      Prisma.sql`SELECT v."node_id" AS id FROM "node_field_values" v
        JOIN "field_definitions" f ON f."id" = v."field_id"
        JOIN "story_nodes" n ON n."id" = v."node_id"
        WHERE v."workspace_id" = ${ws}::uuid AND n."kind" <> f."node_kind"`,
    ],
    [
      "deadline about something that can't have dates",
      Prisma.sql`SELECT e."id" FROM "calendar_events" e
        JOIN "story_nodes" n ON n."id" = e."subject_id"
        WHERE e."workspace_id" = ${ws}::uuid AND e."purpose" = 'DEADLINE'
          AND n."kind"::text <> ALL(${STORY_KINDS.filter((k) => STORY_OBJECT_TYPES[k].dated)}::text[])`,
    ],
    [
      "relationship with fewer than two members",
      Prisma.sql`SELECT r."id" FROM "relationships" r
        WHERE r."workspace_id" = ${ws}::uuid
          AND (SELECT count(*) FROM "relationship_members" m WHERE m."relationship_id" = r."id") < 2`,
    ],
  );

  const results = await Promise.all(
    checks.map(async ([check, sql]) => {
      const rows = await db.$queryRaw<Row[]>(sql);
      return { check, count: rows.length, sample: rows.slice(0, 5).map((r) => r.id) };
    }),
  );
  return results.filter((r) => r.count > 0);
}
