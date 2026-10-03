import "server-only";

import { addDays, fromDbDate, startOfMonthGrid, toDbDate, type DateString } from "@/lib/dates";
import { db } from "@/lib/db";
import { NotFoundError } from "@/lib/errors";
import { createPlannedConnection, planConnection } from "@/modules/connections";
import { visibleBookWhere } from "@/modules/library";
import { writingDays } from "@/modules/progress";
import { createStoryNode, liveEvent } from "@/modules/story-graph";
import { listTasks } from "@/modules/tasks";
import type { AuthorContext } from "@/server/context";

import { eventInput, monthInput, type EventInput } from "./schemas";

/**
 * The author's calendar: their own events, plus what other modules put on a
 * date (task due dates, book deadlines, words written per day). Events are
 * story nodes, so they can concern books and other story objects.
 */

const eventSelect = {
  id: true,
  title: true,
  description: true,
  startsOn: true,
  endsOn: true,
  startTime: true,
} as const;

function toView(e: {
  id: string;
  title: string;
  description: string | null;
  startsOn: Date;
  endsOn: Date | null;
  startTime: string | null;
}) {
  return {
    ...e,
    startsOn: fromDbDate(e.startsOn),
    endsOn: e.endsOn ? fromDbDate(e.endsOn) : null,
  };
}
export type EventView = ReturnType<typeof toView>;

export async function getEvent(ctx: AuthorContext, id: string): Promise<EventView> {
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

export async function updateEvent(ctx: AuthorContext, id: string, input: EventInput) {
  const data = eventInput.parse(input);
  await getEvent(ctx, id);
  await db.calendarEvent.update({
    where: { id },
    data: {
      title: data.title,
      description: data.description ?? null,
      startsOn: toDbDate(data.startsOn),
      endsOn: data.endsOn ? toDbDate(data.endsOn) : null,
      startTime: data.startTime,
    },
  });
}

export async function trashEvent(ctx: AuthorContext, id: string) {
  await getEvent(ctx, id);
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
  const [events, tasks, books, words] = await Promise.all([
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
    db.book.findMany({
      where: {
        workspaceId: ctx.workspaceId,
        ...visibleBookWhere,
        ...(penNameId ? { penNameId } : {}),
        dueOn: { gte: toDbDate(from), lte: toDbDate(to) },
      },
      select: { id: true, title: true, dueOn: true },
    }),
    writingDays(ctx, from, to),
  ]);

  const days = new Map<DateString, CalendarDay>();
  for (let d = from; d <= to; d = addDays(d, 1)) {
    days.set(d, { date: d, entries: [], words: words.get(d) ?? 0 });
  }
  for (const e of events.map(toView)) {
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
  for (const b of books) {
    days.get(fromDbDate(b.dueOn!))?.entries.push({
      type: "deadline",
      id: b.id,
      title: `${b.title} due`,
      href: `/books/${b.id}`,
    });
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
  const range = await calendarRange(ctx, { from, to: addDays(from, days - 1), penNameId });
  return range.filter((d) => d.entries.length > 0);
}
