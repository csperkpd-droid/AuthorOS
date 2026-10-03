import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import {
  addDays,
  daysBetween,
  fromDbDate,
  localDate,
  toDbDate,
  type DateString,
} from "@/lib/dates";
import { db } from "@/lib/db";
import { NotFoundError, RuleError } from "@/lib/errors";
import { uuidv7 } from "@/lib/ids";
import { getBook, listLibrary, wordCountsByBook } from "@/modules/library";
import type { AuthorContext } from "@/server/context";
import { assertCan } from "@/server/policy";

import { dailyGoalInput, timeZoneInput, writingLogInput, type WritingLogInput } from "./schemas";

/**
 * Writing progress: words written per day (recorded automatically from scene
 * saves, plus words the author logs), daily goals, streaks and book deadline
 * pace. "Today" is the author's own calendar day, in their time zone.
 */

// ─── Time zone and "today" ──────────────────────────────────────────────────

export async function getTimeZone(ctx: AuthorContext): Promise<string> {
  const user = await db.user.findUnique({ where: { id: ctx.userId }, select: { timeZone: true } });
  return user?.timeZone ?? "UTC";
}

/** Whether the author has chosen (or the browser has reported) a time zone. */
export async function hasTimeZone(ctx: AuthorContext): Promise<boolean> {
  const user = await db.user.findUnique({ where: { id: ctx.userId }, select: { timeZone: true } });
  return Boolean(user?.timeZone);
}

export async function setTimeZone(ctx: AuthorContext, timeZone: string) {
  const tz = timeZoneInput.parse(timeZone);
  await db.user.update({ where: { id: ctx.userId }, data: { timeZone: tz } });
}

export async function today(ctx: AuthorContext): Promise<DateString> {
  return localDate(await getTimeZone(ctx));
}

// ─── Recording ──────────────────────────────────────────────────────────────

/**
 * Adds a scene save's change in words to today's automatic row for the book.
 * Called inside the save's transaction; one row per user, book and day
 * (database-enforced), updated atomically under concurrent saves.
 */
export async function recordEditorWords(
  tx: Prisma.TransactionClient,
  ctx: AuthorContext,
  {
    bookId,
    date,
    before,
    after,
  }: { bookId: string; date: DateString; before: number; after: number },
) {
  const delta = after - before;
  if (delta === 0) return;
  const added = Math.max(delta, 0);
  const removed = Math.max(-delta, 0);
  await tx.$executeRaw`
    INSERT INTO "writing_sessions"
      ("id", "workspace_id", "user_id", "book_id", "date", "source", "words_added", "words_removed", "updated_at")
    VALUES
      (${uuidv7()}::uuid, ${ctx.workspaceId}::uuid, ${ctx.userId}::uuid, ${bookId}::uuid,
       ${toDbDate(date)}::date, 'EDITOR', ${added}, ${removed}, now())
    ON CONFLICT ("user_id", "book_id", "date") WHERE "source" = 'EDITOR' AND "book_id" IS NOT NULL
    DO UPDATE SET
      "words_added" = "writing_sessions"."words_added" + EXCLUDED."words_added",
      "words_removed" = "writing_sessions"."words_removed" + EXCLUDED."words_removed",
      "updated_at" = now()`;
}

/** Logs words written elsewhere (on paper, in another app). */
export async function logWriting(ctx: AuthorContext, input: WritingLogInput) {
  assertCan(ctx, "edit", "planning");
  const data = writingLogInput.parse(input);
  if (data.bookId) await getBook(ctx, data.bookId);
  if (data.date > (await today(ctx))) throw new RuleError("You can’t log words for a future day.");
  return db.writingSession.create({
    data: {
      workspaceId: ctx.workspaceId,
      userId: ctx.userId,
      bookId: data.bookId,
      date: toDbDate(data.date),
      source: "MANUAL",
      wordsAdded: data.words,
      minutes: data.minutes ?? null,
      note: data.note ?? null,
    },
    select: { id: true },
  });
}

/** Removes a logged entry. Automatic rows can't be removed (they mirror real edits). */
export async function deleteWritingLog(ctx: AuthorContext, id: string) {
  assertCan(ctx, "edit", "planning");
  const row = await db.writingSession.findFirst({
    where: { id, workspaceId: ctx.workspaceId, userId: ctx.userId, source: "MANUAL" },
    select: { id: true },
  });
  if (!row) throw new NotFoundError("Logged session");
  await db.writingSession.delete({ where: { id } });
}

// ─── Goals ──────────────────────────────────────────────────────────────────

export async function getDailyGoal(ctx: AuthorContext): Promise<number | null> {
  const member = await db.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId: ctx.workspaceId, userId: ctx.userId } },
    select: { dailyWordGoal: true },
  });
  return member?.dailyWordGoal ?? null;
}

/** Sets (or, with null, clears) the author's words-per-day goal. */
export async function setDailyGoal(ctx: AuthorContext, words: number | string | null) {
  const goal = dailyGoalInput.parse(words);
  await db.workspaceMember.update({
    where: { workspaceId_userId: { workspaceId: ctx.workspaceId, userId: ctx.userId } },
    data: { dailyWordGoal: goal },
  });
}

// ─── Stats ──────────────────────────────────────────────────────────────────

/** Net words per day (written minus deleted, plus logged) for this author. */
async function wordsByDay(ctx: AuthorContext, from: DateString, to: DateString) {
  const rows = await db.writingSession.groupBy({
    by: ["date"],
    where: {
      workspaceId: ctx.workspaceId,
      userId: ctx.userId,
      date: { gte: toDbDate(from), lte: toDbDate(to) },
    },
    _sum: { wordsAdded: true, wordsRemoved: true },
  });
  return new Map(
    rows.map((r) => [fromDbDate(r.date), (r._sum.wordsAdded ?? 0) - (r._sum.wordsRemoved ?? 0)]),
  );
}

/**
 * Consecutive days with words written, ending today (or yesterday, so a
 * streak isn't broken before today's writing).
 */
export function streakFrom(byDay: Map<string, number>, todayDate: DateString): number {
  let day = (byDay.get(todayDate) ?? 0) > 0 ? todayDate : addDays(todayDate, -1);
  let streak = 0;
  while ((byDay.get(day) ?? 0) > 0) {
    streak++;
    day = addDays(day, -1);
  }
  return streak;
}

export type WritingStats = {
  today: DateString;
  timeZone: string;
  goal: number | null;
  todayWords: number;
  weekWords: number;
  streak: number;
  /** The last `days` days, oldest first. */
  days: { date: DateString; words: number; metGoal: boolean }[];
};

export async function writingStats(
  ctx: AuthorContext,
  { days = 30 }: { days?: number } = {},
): Promise<WritingStats> {
  const [timeZone, goal] = await Promise.all([getTimeZone(ctx), getDailyGoal(ctx)]);
  const todayDate = localDate(timeZone);
  // A year back, so long streaks count.
  const byDay = await wordsByDay(ctx, addDays(todayDate, -366), todayDate);
  const series = Array.from({ length: days }, (_, i) => {
    const date = addDays(todayDate, i - days + 1);
    const words = byDay.get(date) ?? 0;
    return { date, words, metGoal: goal !== null && words >= goal };
  });
  return {
    today: todayDate,
    timeZone,
    goal,
    todayWords: byDay.get(todayDate) ?? 0,
    weekWords: series.slice(-7).reduce((sum, d) => sum + d.words, 0),
    streak: streakFrom(byDay, todayDate),
    days: series,
  };
}

/** Words per day in a date range (for the calendar). */
export async function writingDays(ctx: AuthorContext, from: DateString, to: DateString) {
  return wordsByDay(ctx, from, to);
}

/** The author's logged (manual) entries, newest first. */
export async function listWritingLog(ctx: AuthorContext, { limit = 20 } = {}) {
  const rows = await db.writingSession.findMany({
    where: { workspaceId: ctx.workspaceId, userId: ctx.userId, source: "MANUAL" },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    take: limit,
    select: {
      id: true,
      date: true,
      wordsAdded: true,
      minutes: true,
      note: true,
      book: { select: { id: true, title: true } },
    },
  });
  return rows.map((r) => ({ ...r, date: fromDbDate(r.date), words: r.wordsAdded }));
}

export type BookPace = {
  id: string;
  title: string;
  words: number;
  target: number | null;
  dueOn: DateString | null;
  daysLeft: number | null;
  /** Words per day needed to reach the target by the deadline. */
  neededPerDay: number | null;
  /** Average net words per day over the last 7 days. */
  recentPerDay: number;
  status: "done" | "on-track" | "behind" | "overdue" | "no-deadline";
};

/**
 * Deadline pace for books being written (planning, drafting or revising),
 * optionally of one identity. `deadlines` are the books' deadlines from the
 * calendar (the one source of truth for dates): book id → date.
 */
export async function bookPace(
  ctx: AuthorContext,
  { penNameId, deadlines }: { penNameId: string | null; deadlines: Map<string, DateString> },
): Promise<BookPace[]> {
  const library = await listLibrary(ctx, { penNameId });
  const books = [...library.series.flatMap((s) => s.books), ...library.standalone].filter(
    (b) => b.writingStatus !== "COMPLETE" && (b.targetWordCount || deadlines.has(b.id)),
  );
  if (books.length === 0) return [];
  const todayDate = await today(ctx);
  const [counts, recent] = await Promise.all([
    wordCountsByBook(
      ctx,
      books.map((b) => b.id),
    ),
    db.writingSession.groupBy({
      by: ["bookId"],
      where: {
        workspaceId: ctx.workspaceId,
        bookId: { in: books.map((b) => b.id) },
        date: { gt: toDbDate(addDays(todayDate, -7)), lte: toDbDate(todayDate) },
      },
      _sum: { wordsAdded: true, wordsRemoved: true },
    }),
  ]);
  const recentByBook = new Map(
    recent.map((r) => [r.bookId, (r._sum.wordsAdded ?? 0) - (r._sum.wordsRemoved ?? 0)]),
  );

  return books
    .map((b): BookPace => {
      const words = counts.get(b.id) ?? 0;
      const dueOn = deadlines.get(b.id) ?? null;
      const daysLeft = dueOn ? daysBetween(todayDate, dueOn) : null;
      const remaining = b.targetWordCount ? Math.max(b.targetWordCount - words, 0) : null;
      const neededPerDay =
        remaining !== null && daysLeft !== null && daysLeft >= 0
          ? Math.ceil(remaining / Math.max(daysLeft, 1))
          : null;
      const recentPerDay = Math.round((recentByBook.get(b.id) ?? 0) / 7);
      const status: BookPace["status"] =
        remaining === 0
          ? "done"
          : daysLeft === null
            ? "no-deadline"
            : daysLeft < 0
              ? "overdue"
              : neededPerDay !== null && recentPerDay < neededPerDay
                ? "behind"
                : "on-track";
      return {
        id: b.id,
        title: b.title,
        words,
        target: b.targetWordCount,
        dueOn,
        daysLeft,
        neededPerDay,
        recentPerDay,
        status,
      };
    })
    .sort((a, b) => (a.dueOn ?? "9999").localeCompare(b.dueOn ?? "9999"));
}
