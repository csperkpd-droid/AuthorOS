import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { TEST_DATABASE_URL } from "../support/test-database-url";

/**
 * M13: the `tropes` migration turns `books.tropes` text into Trope objects
 * and `uses_trope` connections, then drops the column. Run against a
 * throwaway database brought to the schema just before M13, seeded the way
 * real data looked, then migrated.
 */

const FIRST_M13 = "20261014090000";
const DB = "authoros_m13_migration_test";
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
  await apply((await migrations()).filter((n) => n < FIRST_M13));
}, 120_000);

afterAll(async () => {
  await client?.end();
  const admin = new Client({ connectionString: TEST_DATABASE_URL });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS "${DB}"`);
  await admin.end();
});

const id = () => crypto.randomUUID();

/** A workspace with one pen name per name given; returns their ids. */
async function workspace(name: string, pens: string[]) {
  const ws = id();
  await client.query(
    `INSERT INTO "workspaces" ("id", "name", "updated_at") VALUES ($1, $2, now())`,
    [ws, name],
  );
  const penIds: string[] = [];
  for (const pen of pens) {
    const p = id();
    await client.query(
      `INSERT INTO "story_nodes" ("id", "workspace_id", "kind") VALUES ($1, $2, 'PEN_NAME')`,
      [p, ws],
    );
    await client.query(
      `INSERT INTO "pen_names" ("id", "workspace_id", "name", "updated_at") VALUES ($1, $2, $3, now())`,
      [p, ws, pen],
    );
    penIds.push(p);
  }
  return { ws, penIds };
}

async function book(ws: string, penId: string, title: string, tropes: string[]) {
  const b = id();
  await client.query(
    `INSERT INTO "story_nodes" ("id", "workspace_id", "kind") VALUES ($1, $2, 'BOOK')`,
    [b, ws],
  );
  await client.query(
    `INSERT INTO "books" ("id", "workspace_id", "pen_name_id", "title", "tropes", "updated_at")
     VALUES ($1, $2, $3, $4, $5, now())`,
    [b, ws, penId, title, tropes],
  );
  return b;
}

describe("M13 migration: books.tropes → Trope objects", () => {
  it("keeps every meaningful assignment, merges names, drops blanks and the column", async () => {
    const one = await workspace("One", ["Jane", "Rose Hart"]);
    const two = await workspace("Two", ["Sam"]);
    const a = await book(one.ws, one.penIds[0], "Ember", [
      "Enemies to lovers",
      "  Slow burn ",
      "",
      "   ",
      "enemies TO lovers",
    ]);
    const b = await book(one.ws, one.penIds[1], "Rose book", ["Enemies to lovers", "Small town"]);
    const c = await book(one.ws, one.penIds[0], "No tropes", []);
    const d = await book(two.ws, two.penIds[0], "Theirs", ["Enemies to lovers"]);
    const before = await client.query(
      `SELECT "id", "title", "pen_name_id", "workspace_id", "updated_at" FROM "books" ORDER BY "id"`,
    );

    await apply((await migrations()).filter((n) => n >= FIRST_M13));

    // One live trope per workspace and normalized name; no blank ones.
    const tropes = await client.query(
      `SELECT t."id", t."workspace_id", t."name", n."kind"
         FROM "tropes" t JOIN "story_nodes" n ON n."id" = t."id"
        ORDER BY t."workspace_id", t."name"`,
    );
    const byWs = (ws: string) =>
      tropes.rows
        .filter((r) => r.workspace_id === ws)
        .map((r) => r.name as string)
        .sort();
    expect(byWs(one.ws)).toEqual(["Enemies to lovers", "Slow burn", "Small town"]);
    expect(byWs(two.ws)).toEqual(["Enemies to lovers"]);
    expect(tropes.rows.every((r) => r.kind === "TROPE" && r.name.trim() === r.name)).toBe(true);

    // Every old assignment is a `uses_trope` connection, once.
    const links = await client.query(
      `SELECT c."source_id", t."name", c."workspace_id" FROM "connections" c
         JOIN "tropes" t ON t."id" = c."target_id"
        WHERE c."kind" = 'uses_trope'`,
    );
    const of = (bookId: string) =>
      links.rows
        .filter((l) => l.source_id === bookId)
        .map((l) => l.name as string)
        .sort();
    expect(of(a)).toEqual(["Enemies to lovers", "Slow burn"]);
    expect(of(b)).toEqual(["Enemies to lovers", "Small town"]);
    expect(of(c)).toEqual([]);
    expect(of(d)).toEqual(["Enemies to lovers"]);
    // Links never cross workspaces; both pen names' books share the trope.
    const wsOfTrope = new Map(tropes.rows.map((r) => [r.id, r.workspace_id]));
    const all = await client.query(
      `SELECT "workspace_id", "target_id" FROM "connections" WHERE "kind" = 'uses_trope'`,
    );
    expect(all.rows.every((l) => wsOfTrope.get(l.target_id) === l.workspace_id)).toBe(true);
    expect(all.rows).toHaveLength(5);

    // The column is gone; books are otherwise untouched.
    const column = await client.query(
      `SELECT 1 FROM information_schema.columns WHERE table_name = 'books' AND column_name = 'tropes'`,
    );
    expect(column.rowCount).toBe(0);
    const after = await client.query(
      `SELECT "id", "title", "pen_name_id", "workspace_id", "updated_at" FROM "books" ORDER BY "id"`,
    );
    expect(after.rows).toEqual(before.rows);

    // The database itself refuses a second live trope of the same name.
    await expect(
      client.query(
        `WITH n AS (INSERT INTO "story_nodes" ("id", "workspace_id", "kind")
                    VALUES ($1, $2, 'TROPE') RETURNING "id")
         INSERT INTO "tropes" ("id", "workspace_id", "name", "updated_at")
         SELECT "id", $2, ' SLOW BURN', now() FROM n`,
        [id(), one.ws],
      ),
    ).rejects.toThrow(/unique/);
  });
});
