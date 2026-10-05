import "server-only";

import { addDays, fromDbDate, startOfMonthGrid, toDbDate, type DateString } from "@/lib/dates";
import { db } from "@/lib/db";
import { assertNotStale, staleError, type EditGuard } from "@/lib/concurrency";
import { NotFoundError, RuleError } from "@/lib/errors";
import { createPlannedConnection, planConnection } from "@/modules/connections";
import { writingDays } from "@/modules/progress";
import {
  createStoryNode,
  liveEvent,
  purgeStoryNodes,
  resolveNode,
  resolveNodes,
  storyObjectType,
} from "@/modules/story-graph";
import { listTasks } from "@/modules/tasks";
import type { AuthorContext } from "@/server/context";
import { recordFieldHistory } from "@/modules/history";
import { assertCan, assertCanView } from "@/server/policy";

import { deadlineDate, eventInput, monthInput, type EventInput } from "./schemas";

/**
 * The author's calendar, and the one place dates live.
 *
 * Every dated entry is a calendar event (a story node). An entry is either
 * an event of its own (`purpose: EVENT`) or a date that belongs to another
 * story object (`DEADLINE`, with `subjectId`): a book's deadline is the
 * book's DEADLINE entry, never a column on the book, so the book page, the
 * calendar, the dashboard pace and exports all read the same row. Tasks are
 * planner items whose due date is their own. The calendar is a view over
 * entries, tasks and words written per day.
 */

const eventSelect = {
  id: true,
  title: true,
  description: true,
  startsOn: true,
  endsOn: true,
  startTime: true,
  purpose: true,
  subjectId: true,
  updatedAt: true,
} as const;

function toView(e: {
  id: string;
  title: string;
  description: string | null;
  startsOn: Date;
  endsOn: Date | null;
  startTime: string | null;
  purpose: "EVENT" | "DEADLINE";
  subjectId: string | null;
  updatedAt: Date;
}) {
  return {
    ...e,
    startsOn: fromDbDate(e.startsOn),
    endsOn: e.endsOn ? fromDbDate(e.endsOn) : null,
  };
}
export type EventView = ReturnType<typeof toView>;

export async function getEvent(ctx: AuthorContext, id: string): Promise<EventView> {
  assertCanView(ctx, "planning", { kind: "EVENT", id: id });
  const row = await db.calendarEvent.findFirst({
    where: { id, workspaceId: ctx.workspaceId, ...liveEvent },
    select: eventSelect,
  });
  if (!row) throw new NotFoundError("Event");
  return toView(row);
}

export async function createEvent(
  ctx: AuthorContext,
  input: EventInput & { concernsId?: string | null },
) {
  assertCan(ctx, "edit", "planning");
  const data = eventInput.parse(input);
  return db.$transaction(async (tx) => {
    const id = await createStoryNode(tx, ctx.workspaceId, "EVENT");
    const plan = input.concernsId
      ? await planConnection(
          ctx,
          { sourceId: id, targetId: input.concernsId, kind: "concerns" },
          { id, kind: "EVENT" },
        )
      : null;
    await tx.calendarEvent.create({
      data: {
        id,
        workspaceId: ctx.workspaceId,
        title: data.title,
        description: data.description ?? null,
        startsOn: toDbDate(data.startsOn),
        endsOn: data.endsOn ? toDbDate(data.endsOn) : null,
        startTime: data.startTime,
      },
    });
    if (plan) await createPlannedConnection(tx, ctx, plan);
    return { id };
  });
}

/** Dates that belong to another object are changed there (e.g. the book's deadline). */
function assertOwnEvent(event: EventView) {
  if (event.purpose !== "EVENT")
    throw new RuleError("This date belongs to another item. Change it from there.");
}

export async function updateEvent(
  ctx: AuthorContext,
  id: string,
  input: EventInput,
  guard: EditGuard = {},
) {
  assertCan(ctx, "edit", "planning");
  const data = eventInput.parse(input);
  assertOwnEvent(await getEvent(ctx, id));
  await db.$transaction(async (tx) => {
    const row = await tx.calendarEvent.findUniqueOrThrow({
      where: { id },
      select: { description: true, updatedAt: true },
    });
    assertNotStale(row.updatedAt, guard.expectedUpdatedAt, "event");
    await recordFieldHistory(tx, ctx, id, row, { description: data.description ?? null });
    const { count } = await tx.calendarEvent.updateMany({
      where: { id, updatedAt: row.updatedAt },
      data: {
        title: data.title,
        description: data.description ?? null,
        startsOn: toDbDate(data.startsOn),
        endsOn: data.endsOn ? toDbDate(data.endsOn) : null,
        startTime: data.startTime,
      },
    });
    if (count === 0) throw staleError("event");
  });
}

export async function trashEvent(ctx: AuthorContext, id: string) {
  assertCan(ctx, "edit", "planning");
  assertOwnEvent(await getEvent(ctx, id));
  await db.calendarEvent.update({ where: { id }, data: { deletedAt: new Date() } });
}

export type CalendarEntry =
  | { type: "event"; id: string; title: string; time: string | null; href: string }
  | { type: "task"; id: string; title: string; done: boolean; href: string }
  | { type: "deadline"; id: string; title: string; href: string };

export type CalendarDay = { date: DateString; entries: CalendarEntry[]; words: number };

/**
 * Everything on the calendar between two dates (inclusive), per day. Book
 * deadlines follow the "Writing as" identity (null = all); events and tasks
 * are author-level.
 */
export async function calendarRange(
  ctx: AuthorContext,
  { from, to, penNameId }: { from: DateString; to: DateString; penNameId: string | null },
): Promise<CalendarDay[]> {
  assertCanView(ctx, "planning");
  const [events, tasks, words] = await Promise.all([
    db.calendarEvent.findMany({
      where: {
        workspaceId: ctx.workspaceId,
        ...liveEvent,
        startsOn: { lte: toDbDate(to) },
        OR: [
          { endsOn: { gte: toDbDate(from) } },
          { endsOn: null, startsOn: { gte: toDbDate(from) } },
        ],
      },
      orderBy: [{ startsOn: "asc" }, { startTime: { sort: "asc", nulls: "first" } }],
      select: eventSelect,
    }),
    listTasks(ctx, { status: "all", dueFrom: from, dueTo: to }),
    writingDays(ctx, from, to),
  ]);
  // Deadlines show as their object ("Ember due") and follow "Writing as".
  const subjects = await resolveNodes(
    ctx,
    events.flatMap((e) => (e.subjectId ? [e.subjectId] : [])),
  );

  const days = new Map<DateString, CalendarDay>();
  for (let d = from; d <= to; d = addDays(d, 1)) {
    days.set(d, { date: d, entries: [], words: words.get(d) ?? 0 });
  }
  for (const e of events.map(toView)) {
    if (e.purpose === "DEADLINE") {
      const subject = subjects.get(e.subjectId!);
      if (!subject || (penNameId && subject.penNameId && subject.penNameId !== penNameId)) continue;
      days.get(e.startsOn)?.entries.push({
        type: "deadline",
        id: e.id,
        title: e.title === DEADLINE_TITLE ? `${subject.title} due` : `${subject.title}: ${e.title}`,
        href: subject.href,
      });
      continue;
    }
    // Multi-day events show on each of their days in range.
    for (
      let d = e.startsOn < from ? from : e.startsOn;
      d <= (e.endsOn ?? e.startsOn) && d <= to;
      d = addDays(d, 1)
    ) {
      days.get(d)?.entries.push({
        type: "event",
        id: e.id,
        title: e.title,
        time: d === e.startsOn ? e.startTime : null,
        href: `/calendar/events/${e.id}`,
      });
    }
  }
  for (const t of tasks) {
    days.get(t.dueOn!)?.entries.push({
      type: "task",
      id: t.id,
      title: t.title,
      done: t.status === "DONE",
      href: `/tasks/${t.id}`,
    });
  }
  return [...days.values()];
}

/** A month as full Monday-first weeks (so the grid includes edge days). */
export async function calendarMonth(
  ctx: AuthorContext,
  { month, penNameId }: { month: string; penNameId: string | null },
) {
  assertCanView(ctx, "planning");
  const m = monthInput.parse(month);
  const from = startOfMonthGrid(m);
  const [y, mm] = m.split("-").map(Number);
  const last = fromDbDate(new Date(Date.UTC(y, mm, 0)));
  const weekday = (toDbDate(last).getUTCDay() + 6) % 7;
  const to = addDays(last, 6 - weekday);
  return { month: m, days: await calendarRange(ctx, { from, to, penNameId }) };
}

/** What's coming up: the next `days` days that have something on them. */
export async function upcoming(
  ctx: AuthorContext,
  { from, days = 7, penNameId }: { from: DateString; days?: number; penNameId: string | null },
) {
  assertCanView(ctx, "planning");
  const range = await calendarRange(ctx, { from, to: addDays(from, days - 1), penNameId });
  return range.filter((d) => d.entries.length > 0);
}

// ─── Dates that belong to other objects ─────────────────────────────────────

const DEADLINE_TITLE = "Deadline";

/**
 * Sets (or with `date: null`, removes) the deadline of a story object that
 * can have dates (registry: `dated`), e.g. a book's draft deadline. One
 * deadline per object; it shows on the calendar and drives the pace.
 */
export async function setDeadline(ctx: AuthorContext, subjectId: string, date: string | null) {
  assertCan(ctx, "edit", "planning");
  const day = deadlineDate.parse(date);
  const subject = await resolveNode(ctx, subjectId);
  if (!subject || !storyObjectType(subject.kind).dated) throw new NotFoundError("Item");
  const current = await db.calendarEvent.findFirst({
    where: { workspaceId: ctx.workspaceId, subjectId, purpose: "DEADLINE", deletedAt: null },
    select: { id: true },
  });
  if (!day) {
    // Removing the date removes the entry (it was an attribute of the object).
    if (current) await db.$transaction((tx) => purgeStoryNodes(tx, ctx.workspaceId, [current.id]));
    return;
  }
  if (current) {
    await db.calendarEvent.update({ where: { id: current.id }, data: { startsOn: toDbDate(day) } });
    return;
  }
  await db.$transaction(async (tx) => {
    const id = await createStoryNode(tx, ctx.workspaceId, "EVENT");
    await tx.calendarEvent.create({
      data: {
        id,
        workspaceId: ctx.workspaceId,
        title: DEADLINE_TITLE,
        startsOn: toDbDate(day),
        purpose: "DEADLINE",
        subjectId,
      },
    });
  });
}

/** Deadlines of these objects (all visible ones when omitted): subject id → date. */
export async function deadlinesFor(
  ctx: AuthorContext,
  subjectIds?: string[],
): Promise<Map<string, DateString>> {
  assertCanView(ctx, "planning");
  const rows = await db.calendarEvent.findMany({
    where: {
      workspaceId: ctx.workspaceId,
      ...liveEvent,
      purpose: "DEADLINE",
      ...(subjectIds ? { subjectId: { in: subjectIds } } : {}),
    },
    select: { subjectId: true, startsOn: true },
  });
  return new Map(rows.map((r) => [r.subjectId!, fromDbDate(r.startsOn)]));
}
