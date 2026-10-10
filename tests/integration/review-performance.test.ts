import { PrismaPg } from "@prisma/adapter-pg";
import { beforeAll, describe, expect, it } from "vitest";

import { PrismaClient } from "@/generated/prisma/client";
import type { AuthorContext } from "@/server/context";

/**
 * M17 Review at scale (decision 115): 5,000 comments in the author's
 * workspace and 5,000 in another one. Proves a fixed number of queries per
 * page (no N+1), stable paging over the whole set, and measures the first
 * page and the counts. The target (decision 115): each ≤ 100 ms p95 on a
 * local database. Timings are asserted only when REVIEW_BENCH=1
 * (`pnpm bench:review`), so a slow CI machine never fails the suite;
 * the query counts and paging are always asserted.
 */

// A Prisma client that counts its statements, installed before the
// services load (lib/db reuses globalThis.prisma outside production).
const statements: { query: string; params: string; duration: number }[] = [];
const client = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
  log: [{ emit: "event", level: "query" }],
});
client.$on("query", (e) =>
  statements.push({ query: e.query, params: e.params, duration: e.duration }),
);
(globalThis as unknown as { prisma: PrismaClient }).prisma = client;

const COMMENTS = 5_000;
const BOOKS = 10;
const SCENES_PER_BOOK = 20;
const NOTES = 50;
const RUNS = 30;
const bench = process.env.REVIEW_BENCH === "1";

let ctx: AuthorContext;
let services: typeof import("@/modules/comments");

async function seed(author: AuthorContext, tag: string) {
  const { createBook } = await import("@/modules/library");
  const { createChapter, createScene } = await import("@/modules/manuscript");
  const { createNote } = await import("@/modules/notes");
  const documents: string[] = [];
  for (let b = 0; b < BOOKS; b++) {
    const book = await createBook(author, { title: `${tag} Book ${b}` });
    const chapter = await createChapter(author, book.id, { title: "One" });
    for (let s = 0; s < SCENES_PER_BOOK; s++)
      documents.push((await createScene(author, chapter.id, `Scene ${s}`)).id);
  }
  for (let n = 0; n < NOTES; n++)
    documents.push((await createNote(author, { title: `${tag} Note ${n}` })).id);
  const states = ["NEEDS_REVIEW", "OPEN", "RESOLVED"] as const;
  const start = Date.UTC(2026, 0, 1);
  const rows = Array.from({ length: COMMENTS }, (_, i) => ({
    workspaceId: author.workspaceId,
    nodeId: documents[i % documents.length],
    body: `Comment ${i}`,
    state: states[i % 3],
    anchorLost: states[i % 3] === "NEEDS_REVIEW",
    anchorStart: 0,
    anchorEnd: 5,
    quote: "Hello",
    docVersion: 1,
    // Every fifth pair shares a timestamp, so paging must break ties by id.
    createdAt: new Date(start + Math.floor(i / 2) * 60_000),
    deletedAt: i % 50 === 0 ? new Date() : null,
  }));
  await client.comment.createMany({ data: rows });
}

function percentile(samples: number[], p: number) {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

async function measure(label: string, run: () => Promise<unknown>) {
  await run(); // warm-up
  const samples: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const t = performance.now();
    await run();
    samples.push(performance.now() - t);
  }
  const result = { label, p50: percentile(samples, 50), p95: percentile(samples, 95) };
  if (bench)
    console.info(`${label}: p50 ${result.p50.toFixed(1)} ms, p95 ${result.p95.toFixed(1)} ms`);
  return result;
}

/** Statements one call runs. */
async function count(run: () => Promise<unknown>) {
  statements.length = 0;
  await run();
  return statements.filter((s) => !/^(BEGIN|COMMIT|ROLLBACK)/.test(s.query)).length;
}

beforeAll(async () => {
  const { createAuthor, resetDatabase } = await import("../support/db");
  services = await import("@/modules/comments");
  await resetDatabase();
  ctx = await createAuthor("Jane");
  await seed(ctx, "Jane");
  await seed(await createAuthor("Other"), "Other");
  // Statistics as autovacuum keeps them in a running database: right after a
  // bulk load the planner thinks the table is empty (see decision 115).
  await client.$executeRawUnsafe("ANALYZE");
}, 300_000);

describe("Review with 5,000 comments", () => {
  it("pages every comment of a view exactly once, in a fixed number of queries", async () => {
    const counts = await services.countCommentsForReview(ctx);
    const live = COMMENTS - COMMENTS / 50;
    expect(counts.NEEDS_REVIEW + counts.OPEN + counts.RESOLVED).toBe(live);

    const seen = new Set<string>();
    let cursor: string | null = null;
    let pages = 0;
    const perPage = new Set<number>();
    do {
      const next = cursor;
      let page!: Awaited<ReturnType<typeof services.listCommentsForReview>>;
      perPage.add(
        await count(async () => {
          page = await services.listCommentsForReview(ctx, { state: "OPEN", cursor: next });
        }),
      );
      for (const item of page.items) {
        expect(seen.has(item.id), "no comment twice").toBe(false);
        seen.add(item.id);
        expect(item.body).toMatch(/^Comment /);
      }
      cursor = page.nextCursor;
      pages++;
    } while (cursor);
    expect(seen.size).toBe(counts.OPEN);
    expect(pages).toBe(Math.ceil(counts.OPEN / services.REVIEW_PAGE_SIZE));
    // A small number of statements per page (one batch per kind the read
    // funnel resolves, so it varies with the kinds a page holds), never one
    // per comment: 50 or 200 comments, the same ceiling.
    expect(Math.max(...perPage), `statements per page: ${[...perPage]}`).toBeLessThanOrEqual(12);
    const large = await count(() =>
      services.listCommentsForReview(ctx, { state: "OPEN", limit: 200 }),
    );
    expect(large).toBeLessThanOrEqual(12);
  }, 120_000);

  it("meets the response-time target", async () => {
    const results = [
      await measure("first page, Needs review", () =>
        services.listCommentsForReview(ctx, { state: "NEEDS_REVIEW" }),
      ),
      await measure("first page, Resolved", () =>
        services.listCommentsForReview(ctx, { state: "RESOLVED" }),
      ),
      await measure("counts", () => services.countCommentsForReview(ctx)),
    ];
    const { items, nextCursor } = await services.listCommentsForReview(ctx, { state: "OPEN" });
    expect(items).toHaveLength(services.REVIEW_PAGE_SIZE);
    results.push(
      await measure("second page, Open", () =>
        services.listCommentsForReview(ctx, { state: "OPEN", cursor: nextCursor }),
      ),
    );
    if (bench) {
      // The plan of the list query, for the record.
      statements.length = 0;
      await services.listCommentsForReview(ctx, { state: "NEEDS_REVIEW" });
      const list = statements.find((s) => /FROM "public"."comments"/.test(s.query))!;
      const plan = await client.$queryRawUnsafe<{ "QUERY PLAN": string }[]>(
        `EXPLAIN (ANALYZE, BUFFERS) ${list.query}`,
        ...(JSON.parse(list.params) as unknown[]),
      );
      console.info(plan.map((r) => r["QUERY PLAN"]).join("\n"));
      for (const r of results) expect(r.p95, r.label).toBeLessThanOrEqual(100);
    }
  }, 120_000);
});
