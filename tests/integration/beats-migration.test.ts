import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { TEST_DATABASE_URL } from "../support/test-database-url";

/**
 * M14: the beats migration turns every beat into a Story Graph object and
 * every placement into a Beat Assignment, in place: same ids, same counts,
 * descriptions and history kept (history moved onto each beat), and each
 * placement's validity derived from the data as it was: Current, Potentially
 * Stale (scene in the Trash) or Conflicted (scene's book outside the
 * structure's series). Run against a throwaway database brought to the
 * schema just before M14, seeded the way real data looked, then migrated.
 */

const FIRST_M14 = "20261015090000";
const DB = "authoros_m14_migration_test";
const dir = path.join(process.cwd(), "prisma", "migrations");

const url = (database: string) => {
  const u = new URL(TEST_DATABASE_URL);
  u.pathname = `/${database}`;
  return u.toString();
};

let client: Client;

async function apply(names: string[]) {
  for (const name of names) {
    const sql = await readFile(path.join(dir, name, "migration.sql"), "utf8").catch(() => "");
    if (sql.trim()) await client.query(sql);
  }
}

async function migrations() {
  return (await readdir(dir)).filter((n) => /^\d{14}_/.test(n)).sort();
}

beforeAll(async () => {
  const admin = new Client({ connectionString: TEST_DATABASE_URL });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS "${DB}"`);
  await admin.query(`CREATE DATABASE "${DB}"`);
  await admin.end();
  client = new Client({ connectionString: url(DB) });
  await client.connect();
  await apply((await migrations()).filter((n) => n < FIRST_M14));
}, 120_000);

afterAll(async () => {
  await client?.end();
  const admin = new Client({ connectionString: TEST_DATABASE_URL });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS "${DB}"`);
  await admin.end();
});

const id = () => crypto.randomUUID();

/** Inserts a story node and its typed row. */
async function node(ws: string, kind: string, table: string, row: Record<string, unknown>) {
  const nodeId = id();
  await client.query(
    `INSERT INTO "story_nodes" ("id", "workspace_id", "kind") VALUES ($1, $2, $3)`,
    [nodeId, ws, kind],
  );
  const cols = ["id", "workspace_id", "updated_at", ...Object.keys(row)];
  const values = [nodeId, ws, new Date(), ...Object.values(row)];
  await client.query(
    `INSERT INTO "${table}" (${cols.map((c) => `"${c}"`).join(", ")})
     VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")})`,
    values,
  );
  return nodeId;
}

/**
 * A workspace with a series of two books, a series structure and a book
 * structure; `migrated` seeds the M14 tables instead of the old ones.
 */
async function world(name: string, migrated = false) {
  const ws = id();
  await client.query(
    `INSERT INTO "workspaces" ("id", "name", "updated_at") VALUES ($1, $2, now())`,
    [ws, name],
  );
  const pen = await node(ws, "PEN_NAME", "pen_names", { name: `${name} pen` });
  const series = await node(ws, "SERIES", "series", { pen_name_id: pen, title: "Crown" });
  const books = [];
  const scenes: string[] = [];
  for (const [i, title] of ["Ember", "Ash"].entries()) {
    const book = await node(ws, "BOOK", "books", {
      pen_name_id: pen,
      series_id: series,
      series_position: `a${i}`,
      title,
    });
    const chapter = await node(ws, "CHAPTER", "chapters", {
      book_id: book,
      title: "One",
      position: "a0",
    });
    for (const [j, sceneTitle] of [`${title} opening`, `${title} turn`].entries())
      scenes.push(
        await node(ws, "SCENE", "scenes", {
          book_id: book,
          chapter_id: chapter,
          title: sceneTitle,
          position: `a${j}`,
        }),
      );
    books.push(book);
  }
  // A book outside the series (it left it, or never joined).
  const driftwood = await node(ws, "BOOK", "books", { pen_name_id: pen, title: "Driftwood" });
  const driftChapter = await node(ws, "CHAPTER", "chapters", {
    book_id: driftwood,
    title: "One",
    position: "a0",
  });
  scenes.push(
    await node(ws, "SCENE", "scenes", {
      book_id: driftwood,
      chapter_id: driftChapter,
      title: "Driftwood opening",
      position: "a0",
    }),
  );
  books.push(driftwood);
  const seriesPlot = await node(ws, "OUTLINE", "outlines", {
    series_id: series,
    kind: "PLOT",
    title: "Series plot",
  });
  const bookPlot = await node(ws, "OUTLINE", "outlines", {
    book_id: books[0],
    kind: "PLOT",
    title: "Ember plot",
  });
  const beat = async (outline: string, title: string, description: string | null, pos: string) => {
    const beatId = id();
    if (migrated)
      await client.query(
        `INSERT INTO "story_nodes" ("id", "workspace_id", "kind") VALUES ($1, $2, 'BEAT')`,
        [beatId, ws],
      );
    await client.query(
      `INSERT INTO "${migrated ? "beats" : "outline_beats"}" ("id", "workspace_id", "outline_id", "title", "description", "position", "updated_at")
       VALUES ($1, $2, $3, $4, $5, $6, now())`,
      [beatId, ws, outline, title, description, pos],
    );
    return beatId;
  };
  const beats = [
    await beat(seriesPlot, "Inciting incident", "It starts.", "a0"),
    await beat(seriesPlot, "Midpoint", null, "a1"),
    await beat(bookPlot, "Climax", "Everything burns.", "a0"),
    await beat(bookPlot, "Unplaced", null, "a1"),
  ];
  const place = (beatId: string, sceneId: string) =>
    client.query(
      `INSERT INTO "${migrated ? "beat_assignments" : "beat_scenes"}" ("workspace_id", "beat_id", "scene_id") VALUES ($1, $2, $3)`,
      [ws, beatId, sceneId],
    );
  await place(beats[0], scenes[0]);
  await place(beats[0], scenes[2]); // one beat, two books of the series
  await place(beats[1], scenes[3]);
  await place(beats[2], scenes[1]);
  await place(beats[2], scenes[0]); // one scene, beats of two structures
  // A placement whose scene is already in the Trash.
  await client.query(`UPDATE "scenes" SET "deleted_at" = now() WHERE "id" = $1`, [scenes[1]]);
  if (!migrated) {
    // A series beat placed in a scene of a book outside the series.
    await place(beats[1], scenes[4]);
    // A scene trashed and restored again before the update.
    await client.query(`UPDATE "scenes" SET "deleted_at" = now() WHERE "id" = $1`, [scenes[3]]);
    await client.query(`UPDATE "scenes" SET "deleted_at" = NULL WHERE "id" = $1`, [scenes[3]]);
  }
  // Earlier descriptions, kept on the structure as "beat:<id>.description".
  for (const [outline, beatId, value] of [
    [seriesPlot, beats[0], "It begins."],
    [bookPlot, beats[2], "Smoke."],
    [bookPlot, beats[2], "Fire."],
  ])
    await client.query(
      `INSERT INTO "field_revisions" ("id", "workspace_id", "node_id", "field", "value", "source")
       VALUES ($1, $2, $3, $4, $5, 'BEFORE_EDIT')`,
      [id(), ws, outline, `beat:${beatId}.description`, value],
    );
  // Unrelated history stays exactly where it is.
  await client.query(
    `INSERT INTO "field_revisions" ("id", "workspace_id", "node_id", "field", "value", "source")
     VALUES ($1, $2, $3, 'description', 'Old book blurb', 'BEFORE_EDIT')`,
    [id(), ws, books[0]],
  );
  return { ws, series, books, scenes, seriesPlot, bookPlot, beats };
}

/** Placed beats per structure, the way progress was counted (live scenes only). */
const PROGRESS = `
  SELECT o."id", count(DISTINCT b."id") FILTER (WHERE s."id" IS NOT NULL) AS placed
    FROM "outlines" o JOIN BEATS b ON b."outline_id" = o."id"
    LEFT JOIN ASSIGNMENTS a ON a."beat_id" = b."id"
    LEFT JOIN "scenes" s ON s."id" = a."scene_id" AND s."deleted_at" IS NULL
   GROUP BY o."id" ORDER BY o."id"`;

describe("M14 migration: beats become objects, placements become assignments", () => {
  it("keeps every beat, placement, description and history entry, with their ids", async () => {
    const one = await world("One");
    const two = await world("Two");
    const beatsBefore = await client.query(
      `SELECT "id", "workspace_id", "outline_id", "title", "description", "position", "book_id"
         FROM "outline_beats" ORDER BY "id"`,
    );
    const placementsBefore = await client.query(
      `SELECT "beat_id", "scene_id", "workspace_id", "created_at" FROM "beat_scenes"
        ORDER BY "beat_id", "scene_id"`,
    );
    const progressBefore = await client.query(
      PROGRESS.replace("BEATS", `"outline_beats"`).replace("ASSIGNMENTS", `"beat_scenes"`),
    );
    const historyBefore = await client.query(
      `SELECT "id", "value", "created_at" FROM "field_revisions" ORDER BY "id"`,
    );
    const scenesBefore = await client.query(
      `SELECT "id", "book_id", "deleted_at" FROM "scenes" ORDER BY "id"`,
    );

    await apply((await migrations()).filter((n) => n >= FIRST_M14));

    // Same beats, same ids and content; each now a BEAT story node.
    const beatsAfter = await client.query(
      `SELECT "id", "workspace_id", "outline_id", "title", "description", "position", "book_id"
         FROM "beats" ORDER BY "id"`,
    );
    expect(beatsAfter.rows).toEqual(beatsBefore.rows);
    expect(beatsAfter.rows).toHaveLength(8);
    const nodes = await client.query(
      `SELECT n."id", n."kind", n."workspace_id" FROM "story_nodes" n
         JOIN "beats" b ON b."id" = n."id" ORDER BY n."id"`,
    );
    expect(nodes.rows).toEqual(
      beatsBefore.rows.map((b) => ({ id: b.id, kind: "BEAT", workspace_id: b.workspace_id })),
    );

    // Same placements, same identity (beat, scene); validity from the
    // actual state; no exception or note invented.
    const placementsSql = `SELECT "beat_id", "scene_id", "workspace_id", "created_at", "validity", "excepted_at", "note"
      FROM "beat_assignments" ORDER BY "beat_id", "scene_id"`;
    const placementsAfter = await client.query(placementsSql);
    const expected = new Map<string, string>();
    for (const w of [one, two]) {
      const set = (beat: string, scene: string, validity: string) =>
        expected.set(`${beat}|${scene}`, validity);
      set(w.beats[0], w.scenes[0], "CURRENT"); // active, valid
      set(w.beats[0], w.scenes[2], "CURRENT"); // same beat, another book of the series
      set(w.beats[2], w.scenes[0], "CURRENT"); // same scene, another structure
      set(w.beats[2], w.scenes[1], "POTENTIALLY_STALE"); // scene in the Trash
      set(w.beats[1], w.scenes[3], "CURRENT"); // scene trashed, then restored
      set(w.beats[1], w.scenes[4], "CONFLICTED"); // book outside the series
    }
    expect(placementsAfter.rows).toEqual(
      placementsBefore.rows.map((p) => ({
        ...p,
        validity: expected.get(`${p.beat_id}|${p.scene_id}`),
        excepted_at: null,
        note: null,
      })),
    );
    expect(placementsAfter.rows).toHaveLength(12);
    expect(placementsAfter.rows.some((p) => p.validity === "UNKNOWN")).toBe(false);

    // No scene restored, moved or removed.
    expect(
      (await client.query(`SELECT "id", "book_id", "deleted_at" FROM "scenes" ORDER BY "id"`)).rows,
    ).toEqual(scenesBefore.rows);

    // Deterministic: running the backfill again changes nothing.
    await client.query(
      `SELECT "evaluate_beat_assignments"(ARRAY(SELECT DISTINCT "scene_id" FROM "beat_assignments"))`,
    );
    expect((await client.query(placementsSql)).rows).toEqual(placementsAfter.rows);

    // A placement migrated as Potentially Stale: restoring its scene makes it Current.
    await client.query(`UPDATE "scenes" SET "deleted_at" = NULL WHERE "id" = $1`, [one.scenes[1]]);
    const restored = await client.query(
      `SELECT "validity" FROM "beat_assignments" WHERE "beat_id" = $1 AND "scene_id" = $2`,
      [one.beats[2], one.scenes[1]],
    );
    expect(restored.rows[0].validity).toBe("CURRENT");

    // Progress (placed beats per structure) is unchanged.
    const progressAfter = await client.query(
      PROGRESS.replace("BEATS", `"beats"`).replace("ASSIGNMENTS", `"beat_assignments"`),
    );
    expect(progressAfter.rows).toEqual(progressBefore.rows);

    // History: nothing lost; beat descriptions now on their beat.
    const historyAfter = await client.query(
      `SELECT "id", "value", "created_at", "node_id", "field" FROM "field_revisions" ORDER BY "id"`,
    );
    expect(
      historyAfter.rows.map(({ id, value, created_at }) => ({ id, value, created_at })),
    ).toEqual(historyBefore.rows);
    for (const w of [one, two]) {
      const of = (nodeId: string) =>
        historyAfter.rows
          .filter((r) => r.node_id === nodeId)
          .map((r) => [r.field, r.value])
          .sort();
      expect(of(w.beats[0])).toEqual([["description", "It begins."]]);
      expect(of(w.beats[2])).toEqual([
        ["description", "Fire."],
        ["description", "Smoke."],
      ]);
      expect(of(w.seriesPlot)).toEqual([]);
      expect(of(w.bookPlot)).toEqual([]);
      expect(of(w.books[0])).toEqual([["description", "Old book blurb"]]);
    }
  });

  it("from then on, validity follows the scene", async () => {
    // Migrated by the test above: the triggers are live.
    const w = await world("Three", true);
    const state = async (beatId: string, sceneId: string) =>
      (
        await client.query(
          `SELECT "validity" FROM "beat_assignments" WHERE "beat_id" = $1 AND "scene_id" = $2`,
          [beatId, sceneId],
        )
      ).rows[0]?.validity;
    await client.query(`UPDATE "scenes" SET "deleted_at" = now() WHERE "id" = $1`, [w.scenes[2]]);
    expect(await state(w.beats[0], w.scenes[2])).toBe("POTENTIALLY_STALE");
    await client.query(`UPDATE "scenes" SET "deleted_at" = NULL WHERE "id" = $1`, [w.scenes[2]]);
    expect(await state(w.beats[0], w.scenes[2])).toBe("CURRENT");
    await client.query(
      `UPDATE "books" SET "series_id" = NULL, "series_position" = NULL WHERE "id" = $1`,
      [w.books[1]],
    );
    expect(await state(w.beats[0], w.scenes[2])).toBe("CONFLICTED");
    await client.query(
      `UPDATE "books" SET "series_id" = $1, "series_position" = 'a1' WHERE "id" = $2`,
      [w.series, w.books[1]],
    );
    expect(await state(w.beats[0], w.scenes[2])).toBe("CURRENT");
  });
});
