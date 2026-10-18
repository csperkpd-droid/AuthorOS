import { PrismaPg } from "@prisma/adapter-pg";
import { beforeAll, describe, expect, it } from "vitest";

import { PrismaClient } from "@/generated/prisma/client";
import type { AuthorContext } from "@/server/context";

/**
 * M18 Task views at scale (decision 116): 2,000 tasks in the author's
 * workspace (a quarter done, half concerning a scene) and 2,000 in another
 * one. Proves each view takes a fixed number of statements (no N+1) and
 * measures Board, Week and Today. The target: each ≤ 100 ms p95 on a local
 * database. Timings are asserted only when TASK_BENCH=1 (`pnpm
 * bench:tasks`), so a slow CI machine never fails the suite; the statement
 * counts are always asserted.
 */

// A Prisma client that counts its statements, installed before the
// services load (lib/db reuses globalThis.prisma outside production).
const statements: { query: string; params: string }[] = [];
const client = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
  log: [{ emit: "event", level: "query" }],
});
client.$on("query", (e) => statements.push({ query: e.query, params: e.params }));
(globalThis as unknown as { prisma: PrismaClient }).prisma = client;

const TASKS = 2_000;
const SCENES = 100;
const RUNS = 30;
const bench = process.env.TASK_BENCH === "1";

let ctx: AuthorContext;
let today: string;
let tasks: typeof import("@/modules/tasks");
let calendar: typeof import("@/modules/calendar");

async function seed(author: AuthorContext, day: string) {
  const { createBook } = await import("@/modules/library");
  const { createChapter, createScene } = await import("@/modules/manuscript");
  const { addDays } = await import("@/lib/dates");
  const book = await createBook(author, { title: "Harbour Lights" });
  const chapter = await createChapter(author, book.id, { title: "One" });
  const scenes: string[] = [];
  for (let s = 0; s < SCENES; s++)
    scenes.push((await createScene(author, chapter.id, `Scene ${s}`)).id);

  const ids = Array.from({ length: TASKS }, () => crypto.randomUUID());
  const ws = author.workspaceId;
  await client.storyNode.createMany({
    data: ids.map((id) => ({ id, workspaceId: ws, kind: "TASK" })),
  });
  const statuses = ["TODO", "IN_PROGRESS", "TODO", "DONE"] as const;
  const priorities = ["LOW", "NORMAL", "HIGH"] as const;
  await client.task.createMany({
    data: ids.map((id, i) => {
      const status = statuses[i % 4];
      return {
        id,
        workspaceId: ws,
        title: `Task ${i}`,
        status,
        priority: priorities[i % 3],
        // Spread over ±60 days; every fifth has no date.
        dueOn: i % 5 === 0 ? null : new Date(`${addDays(day, (i % 121) - 60)}T00:00:00Z`),
        completedAt: status === "DONE" ? new Date(Date.now() - (i % 30) * 86_400_000) : null,
      };
    }),
  });
  await client.connection.createMany({
    data: ids
      .filter((_, i) => i % 2 === 0)
      .map((id, i) => ({
        workspaceId: ws,
        sourceId: id,
        targetId: scenes[i % SCENES],
        kind: "concerns",
      })),
  });
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
  tasks = await import("@/modules/tasks");
  calendar = await import("@/modules/calendar");
  const progress = await import("@/modules/progress");
  await resetDatabase();
  ctx = await createAuthor("Jane");
  today = await progress.today(ctx);
  await seed(ctx, today);
  await seed(await createAuthor("Other"), today);
  // Statistics as autovacuum keeps them in a running database (decision 115).
  await client.$executeRawUnsafe("ANALYZE");
}, 300_000);

describe("Task views with 2,000 tasks", () => {
  it("shows every live task in the right place, in a fixed number of statements", async () => {
    const board = await tasks.listTaskBoard(ctx);
    const open = TASKS - TASKS / 4;
    expect(board.TODO.length + board.IN_PROGRESS.length).toBe(open);
    expect(board.DONE.length).toBeGreaterThan(0);
    expect(board.DONE.length).toBeLessThan(TASKS / 4);
    expect(board.TODO.some((t) => t.concerns.length === 1)).toBe(true);

    // Statements don't grow with the number of tasks shown.
    const views = [
      () => tasks.listTaskBoard(ctx),
      () => calendar.taskWeek(ctx, { weekOf: today, today, penNameId: null }),
      () => tasks.listTasksForToday(ctx, today),
    ];
    // Statements per view (a few dozen at most), against 2,000 tasks shown:
    // nothing runs once per task.
    const counts = [];
    for (const view of views) counts.push(await count(view));
    if (bench)
      console.info(`statements: Board ${counts[0]}, Week ${counts[1]}, Today ${counts[2]}`);
    for (const n of counts) expect(n).toBeLessThanOrEqual(40);
  }, 120_000);

  it("meets the response-time target", async () => {
    const results = [
      await measure("Board", () => tasks.listTaskBoard(ctx)),
      await measure("Week", () =>
        calendar.taskWeek(ctx, { weekOf: today, today, penNameId: null }),
      ),
      await measure("Today", () => tasks.listTasksForToday(ctx, today)),
      await measure("List (open)", () => tasks.listTasks(ctx)),
    ];
    if (bench) {
      // The plan of the Board query, for the record.
      statements.length = 0;
      await tasks.listTaskBoard(ctx);
      const query = statements.find((s) => /FROM "public"."tasks"/.test(s.query))!;
      const plan = await client.$queryRawUnsafe<{ "QUERY PLAN": string }[]>(
        `EXPLAIN (ANALYZE, BUFFERS) ${query.query}`,
        ...(JSON.parse(query.params) as unknown[]),
      );
      console.info(plan.map((r) => r["QUERY PLAN"]).join("\n"));
      for (const r of results) expect(r.p95, r.label).toBeLessThanOrEqual(100);
    }
  }, 120_000);
});
