import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { addDays, localDate } from "@/lib/dates";
import { db } from "@/lib/db";
import { RuleError } from "@/lib/errors";
import {
  calendarMonth,
  calendarRange,
  createEvent,
  deadlinesFor,
  getEvent,
  setDeadline,
  trashEvent,
} from "@/modules/calendar";
import { listConnections } from "@/modules/connections";
import { createBook, updateBook } from "@/modules/library";
import { createChapter, createScene, saveSceneContent } from "@/modules/manuscript";
import { createPenName } from "@/modules/pen-names";
import {
  bookPace,
  deleteWritingLog,
  listWritingLog,
  logWriting,
  setDailyGoal,
  setTimeZone,
  streakFrom,
  today,
  writingStats,
} from "@/modules/progress";
import { restoreRevision, listRevisions } from "@/modules/history";
import {
  createTask,
  getTask,
  listTasks,
  setTaskStatus,
  trashTask,
  updateTask,
} from "@/modules/tasks";
import { listTrash, restoreFromTrash } from "@/modules/trash";
import type { AuthorContext } from "@/server/context";

import { createAuthor, resetDatabase } from "../support/db";

let ctx: AuthorContext;

beforeEach(async () => {
  await resetDatabase();
  ctx = await createAuthor();
});

afterEach(() => {
  vi.useRealTimers();
});

const doc = (text: string) => ({
  type: "doc",
  content: text ? [{ type: "paragraph", content: [{ type: "text", text }] }] : [],
});

async function sceneIn(bookId: string) {
  return (await createScene(ctx, (await createChapter(ctx, bookId)).id)).id;
}

describe("tasks", () => {
  it("are story nodes that concern any story object, sorted by due date and priority", async () => {
    const book = await createBook(ctx, { title: "Harbour Lights" });
    const later = await createTask(ctx, { title: "Send to beta readers", dueOn: "2026-11-20" });
    const soon = await createTask(ctx, {
      title: "Fix chapter 3",
      dueOn: "2026-10-10",
      concernsId: book.id,
    });
    const urgent = await createTask(ctx, { title: "Pick a title", priority: "HIGH" });
    const calm = await createTask(ctx, { title: "Tidy notes", priority: "LOW" });

    expect((await listTasks(ctx)).map((t) => t.id)).toEqual([
      soon.id,
      later.id,
      urgent.id,
      calm.id,
    ]);
    const task = await getTask(ctx, soon.id);
    expect(task.dueOn).toBe("2026-10-10");
    expect(task.concerns.map((c) => c.title)).toEqual(["Harbour Lights"]);
    // The book shows its tasks, read from its side.
    const fromBook = await listConnections(ctx, book.id);
    expect(fromBook.map((c) => [c.heading, c.other.title])).toEqual([
      ["Tasks & dates", "Fix chapter 3"],
    ]);
    expect((await listTasks(ctx, { concernsId: book.id })).map((t) => t.id)).toEqual([soon.id]);
  });

  it("are completed, reopened, edited, trashed and restored", async () => {
    const t = await createTask(ctx, { title: "Draft blurb" });
    await setTaskStatus(ctx, t.id, "DONE");
    let task = await getTask(ctx, t.id);
    expect(task.status).toBe("DONE");
    expect(task.completedAt).not.toBeNull();
    expect(await listTasks(ctx)).toEqual([]);
    expect((await listTasks(ctx, { status: "done" })).map((x) => x.id)).toEqual([t.id]);
    await setTaskStatus(ctx, t.id, "TODO");
    task = await getTask(ctx, t.id);
    expect(task.completedAt).toBeNull();

    await updateTask(ctx, t.id, { title: "Draft the blurb", dueOn: "2026-12-01", notes: "Short" });
    expect((await getTask(ctx, t.id)).dueOn).toBe("2026-12-01");
    await expect(updateTask(ctx, t.id, { title: "x", dueOn: "2026-02-30" })).rejects.toThrow();

    await trashTask(ctx, t.id);
    expect((await listTrash(ctx)).map((i) => [i.kind, i.title])).toEqual([
      ["TASK", "Draft the blurb"],
    ]);
    await restoreFromTrash(ctx, "TASK", t.id);
    expect((await listTasks(ctx)).map((x) => x.id)).toEqual([t.id]);
  });
});

describe("calendar", () => {
  it("merges events, task due dates, book deadlines and words written per day", async () => {
    const book = await createBook(ctx, { title: "Harbour Lights" });
    await updateBook(ctx, book.id, { title: "Harbour Lights", targetWordCount: null });
    await setDeadline(ctx, book.id, "2026-10-15");
    const rose = await createPenName(ctx, { name: "Rose" });
    const roseBook = await createBook(ctx, { title: "Rose book", penNameId: rose.id });
    await updateBook(ctx, roseBook.id, { title: "Rose book", targetWordCount: null });
    await setDeadline(ctx, roseBook.id, "2026-10-15");
    const conf = await createEvent(ctx, {
      title: "Writers' conference",
      startsOn: "2026-10-14",
      endsOn: "2026-10-16",
      startTime: "09:30",
      concernsId: book.id,
    });
    await createTask(ctx, { title: "Book the train", dueOn: "2026-10-13" });
    await logWriting(ctx, { date: "2026-10-01", words: 1200 });

    const days = await calendarRange(ctx, {
      from: "2026-10-13",
      to: "2026-10-16",
      penNameId: null,
    });
    expect(days.map((d) => [d.date, d.entries.map((e) => `${e.type}:${e.title}`)])).toEqual([
      ["2026-10-13", ["task:Book the train"]],
      ["2026-10-14", ["event:Writers' conference"]],
      [
        "2026-10-15",
        ["event:Writers' conference", "deadline:Harbour Lights due", "deadline:Rose book due"],
      ],
      ["2026-10-16", ["event:Writers' conference"]],
    ]);
    expect(days[1].entries[0]).toMatchObject({ type: "event", time: "09:30" });
    expect(days[2].entries[0]).toMatchObject({ type: "event", time: null });

    // Deadlines follow "Writing as"; events and tasks are author-level.
    const writingAsRose = await calendarRange(ctx, {
      from: "2026-10-15",
      to: "2026-10-15",
      penNameId: rose.id,
    });
    expect(writingAsRose[0].entries.map((e) => e.title)).toEqual([
      "Writers' conference",
      "Rose book due",
    ]);

    const month = await calendarMonth(ctx, { month: "2026-10", penNameId: null });
    expect(month.days[0].date).toBe("2026-09-28"); // Monday-first grid
    expect(month.days.at(-1)?.date).toBe("2026-11-01");
    expect(month.days.length % 7).toBe(0);
    expect(month.days.find((d) => d.date === "2026-10-01")?.words).toBe(1200);

    expect((await getEvent(ctx, conf.id)).endsOn).toBe("2026-10-16");
    await trashEvent(ctx, conf.id);
    const after = await calendarRange(ctx, {
      from: "2026-10-14",
      to: "2026-10-14",
      penNameId: null,
    });
    expect(after[0].entries).toEqual([]);
  });

  it("validates events", async () => {
    await expect(
      createEvent(ctx, { title: "Backwards", startsOn: "2026-10-10", endsOn: "2026-10-09" }),
    ).rejects.toThrow(/end before/);
    await expect(
      createEvent(ctx, { title: "Late", startsOn: "2026-10-10", startTime: "25:00" }),
    ).rejects.toThrow();
  });
});

describe("writing progress", () => {
  it("records words written per book and day from scene saves (not restores)", async () => {
    const book = await createBook(ctx, { title: "Harbour Lights" });
    const scene = await sceneIn(book.id);
    let v = (
      await saveSceneContent(ctx, {
        sceneId: scene,
        content: doc("one two three four"),
        baseVersion: 0,
      })
    ).version;
    v = (await saveSceneContent(ctx, { sceneId: scene, content: doc("one two"), baseVersion: v }))
      .version;
    await saveSceneContent(ctx, {
      sceneId: scene,
      content: doc("one two five six seven"),
      baseVersion: v,
    });

    const rows = await db.writingSession.findMany({ where: { bookId: book.id } });
    expect(rows).toHaveLength(1); // one automatic row per book and day
    expect([rows[0].wordsAdded, rows[0].wordsRemoved]).toEqual([7, 2]);
    expect((await writingStats(ctx)).todayWords).toBe(5);

    // Restoring an earlier version isn't writing.
    const [revision] = await listRevisions(ctx, scene);
    if (revision) await restoreRevision(ctx, revision.id);
    expect((await writingStats(ctx)).todayWords).toBe(5);
  });

  it("keeps one row per day under concurrent saves", async () => {
    const book = await createBook(ctx, { title: "Two Tabs" });
    const a = await sceneIn(book.id);
    const b = await sceneIn(book.id);
    await Promise.all([
      saveSceneContent(ctx, { sceneId: a, content: doc("a b c"), baseVersion: 0 }),
      saveSceneContent(ctx, { sceneId: b, content: doc("d e f g"), baseVersion: 0 }),
    ]);
    const rows = await db.writingSession.findMany({ where: { bookId: book.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].wordsAdded).toBe(7);
  });

  it("uses the author's own day, logs words, and counts streaks and goals", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-03T23:30:00Z"));
    await setTimeZone(ctx, "Pacific/Auckland");
    expect(await today(ctx)).toBe("2026-10-04");
    await expect(setTimeZone(ctx, "Mars/Olympus")).rejects.toThrow();

    await setDailyGoal(ctx, 500);
    await logWriting(ctx, { date: "2026-10-02", words: 300 });
    await logWriting(ctx, { date: "2026-10-03", words: 800, minutes: "45", note: "On the train" });
    await expect(logWriting(ctx, { date: "2026-10-05", words: 10 })).rejects.toBeInstanceOf(
      RuleError,
    );
    await expect(logWriting(ctx, { date: "2026-10-03", words: 0 })).rejects.toThrow();

    let stats = await writingStats(ctx, { days: 7 });
    expect(stats.today).toBe("2026-10-04");
    expect(stats.todayWords).toBe(0);
    expect(stats.streak).toBe(2); // today not written yet: the streak holds
    expect(stats.goal).toBe(500);
    expect(stats.days.at(-2)).toEqual({ date: "2026-10-03", words: 800, metGoal: true });
    expect(stats.days.at(-3)).toEqual({ date: "2026-10-02", words: 300, metGoal: false });
    expect(stats.weekWords).toBe(1100);

    const log = await listWritingLog(ctx);
    expect(log.map((l) => [l.date, l.words, l.minutes])).toEqual([
      ["2026-10-03", 800, 45],
      ["2026-10-02", 300, null],
    ]);
    await deleteWritingLog(ctx, log[1].id);
    stats = await writingStats(ctx, { days: 7 });
    expect(stats.streak).toBe(1);
    await setDailyGoal(ctx, null);
    expect((await writingStats(ctx)).goal).toBeNull();
  });

  it("computes streaks", () => {
    const days = new Map([
      ["2026-10-01", 100],
      ["2026-10-02", 0],
      ["2026-10-03", 50],
      ["2026-10-04", 20],
    ]);
    expect(streakFrom(days, "2026-10-04")).toBe(2);
    expect(streakFrom(days, "2026-10-05")).toBe(2);
    expect(streakFrom(days, "2026-10-06")).toBe(0);
  });

  it("paces books against their deadlines", async () => {
    const todayDate = localDate("UTC");
    const book = await createBook(ctx, { title: "On deadline" });
    await updateBook(ctx, book.id, { title: "On deadline", targetWordCount: "1000" });
    await setDeadline(ctx, book.id, addDays(todayDate, 10));
    const scene = await sceneIn(book.id);
    await saveSceneContent(ctx, {
      sceneId: scene,
      content: doc("word ".repeat(200).trim()),
      baseVersion: 0,
    });
    const late = await createBook(ctx, { title: "Overdue" });
    await updateBook(ctx, late.id, { title: "Overdue", targetWordCount: "500" });
    await setDeadline(ctx, late.id, addDays(todayDate, -1));
    await createBook(ctx, { title: "No target" });

    const pace = await bookPace(ctx, { penNameId: null, deadlines: await deadlinesFor(ctx) });
    expect(pace.map((p) => [p.title, p.status])).toEqual([
      ["Overdue", "overdue"],
      ["On deadline", "behind"],
    ]);
    expect(pace[1]).toMatchObject({ words: 200, target: 1000, daysLeft: 10, neededPerDay: 80 });
    // 200 words this week is about 29 a day, short of the 80 a day needed.
    expect(pace[1].recentPerDay).toBe(29);
  });
});
