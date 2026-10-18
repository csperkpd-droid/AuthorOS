"use client";

import { CalendarDays, ChevronLeft, ChevronRight, Flag } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import type { TaskStatus } from "@/generated/prisma/enums";
import { addDays, formatDay } from "@/lib/dates";
import { cn } from "@/lib/utils";

import { setTaskDueDateAction, setTaskStatusAction } from "../actions";
import { TASK_STATUS_LABELS } from "../labels";
import { TaskLanes, type Lane, type LaneTask } from "./task-lanes";

export const TASK_VIEWS = ["list", "board", "week"] as const;
export type TaskViewName = (typeof TASK_VIEWS)[number];

const VIEW_LABELS: Record<TaskViewName, string> = { list: "List", board: "Board", week: "Week" };
const VIEW_KEY = "spellbound:task-view";

function remember(view: TaskViewName) {
  try {
    window.localStorage.setItem(VIEW_KEY, view);
  } catch {
    // Not remembered (private window): the address still says the view.
  }
}

function readView(): TaskViewName | null {
  try {
    const v = window.localStorage.getItem(VIEW_KEY);
    return (TASK_VIEWS as readonly string[]).includes(v ?? "") ? (v as TaskViewName) : null;
  } catch {
    return null;
  }
}

/**
 * The Tasks views (M18): List, Board and Week, the view in the address. An
 * explicit `?view=` always wins and is remembered on this device; plain
 * `/tasks` opens the view last used here.
 */
export function TaskViewTabs({
  view,
  explicit,
  bare,
}: {
  view: TaskViewName;
  explicit: boolean;
  /** The address is plain `/tasks` (no other options), so the last view may open. */
  bare: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  useEffect(() => {
    if (explicit) {
      remember(view);
      return;
    }
    if (!bare) return;
    const last = readView();
    if (last && last !== view) router.replace(`${pathname}?view=${last}`);
  }, [explicit, bare, view, router, pathname]);

  return (
    <nav aria-label="Task views" className="flex gap-1 text-sm">
      {TASK_VIEWS.map((v) => (
        <Link
          key={v}
          href={`/tasks?view=${v}`}
          onClick={() => remember(v)}
          aria-current={v === view ? "page" : undefined}
          className={cn(
            "rounded-md border border-border px-3 py-1",
            v === view
              ? "border-primary/50 bg-secondary font-medium text-primary"
              : "text-muted-foreground hover:bg-surface-hover",
          )}
        >
          {VIEW_LABELS[v]}
        </Link>
      ))}
    </nav>
  );
}

type Board = Record<TaskStatus, LaneTask[]>;
const STATUSES: TaskStatus[] = ["TODO", "IN_PROGRESS", "DONE"];

/**
 * The Board (M18): To do, In progress and Done. Moving a card changes its
 * status only; each column keeps the List's order. Done shows the last 14
 * days. On phones one column shows at a time.
 */
export function TaskBoardView({
  board,
  today,
  doneDays,
}: {
  board: Board;
  today: string;
  doneDays: number;
}) {
  const [column, setColumn] = useState<TaskStatus>("TODO");
  const lanes: Lane[] = STATUSES.map((status) => ({
    id: status,
    label: TASK_STATUS_LABELS[status],
    tasks: board[status],
    empty:
      status === "DONE"
        ? `Nothing finished in the last ${doneDays} days.`
        : status === "IN_PROGRESS"
          ? "Nothing in progress."
          : "Nothing to do.",
    footer:
      status === "DONE" ? (
        <Link
          href="/tasks?view=list&show=done"
          className="block px-1 pt-1 text-xs font-medium text-primary hover:underline"
        >
          All done tasks →
        </Link>
      ) : undefined,
    className: status === column ? undefined : "hidden md:block",
  }));
  return (
    <div className="space-y-3">
      <div role="tablist" aria-label="Board column" className="flex gap-1 text-sm md:hidden">
        {STATUSES.map((status) => (
          <button
            key={status}
            type="button"
            role="tab"
            aria-selected={status === column}
            onClick={() => setColumn(status)}
            className={cn(
              "flex-1 rounded-md border border-border px-2 py-1",
              status === column && "border-primary/50 bg-secondary font-medium text-primary",
            )}
          >
            {TASK_STATUS_LABELS[status]} ({board[status].length})
          </button>
        ))}
      </div>
      <TaskLanes
        label="Task board"
        lanes={lanes}
        today={today}
        className="grid gap-3 md:grid-cols-3"
        onMove={(id, status) => setTaskStatusAction(id, status as TaskStatus)}
      />
    </div>
  );
}

type WeekEntry = {
  type: "event" | "deadline";
  id: string;
  title: string;
  href: string;
  time?: string | null;
};
type Week = {
  start: string;
  days: { date: string; tasks: LaneTask[]; entries: WeekEntry[] }[];
  overdue: LaneTask[];
  undated: LaneTask[];
};

const NO_DATE = "no-date";

/**
 * The Week (M18): Monday to Sunday with the tasks due each day, the
 * calendar's events and deadlines as read-only context, and Overdue and No
 * date trays. Moving a task to a day changes its due date; to No date
 * clears it. A list of days on narrower screens.
 */
export function TaskWeekView({ week, today }: { week: Week; today: string }) {
  const thisWeek = week.days.some((d) => d.date === today);
  const end = addDays(week.start, 6);
  const lanes: Lane[] = [
    {
      id: "overdue",
      label: "Overdue",
      tasks: week.overdue,
      droppable: false,
      empty: "Nothing overdue.",
    },
    { id: NO_DATE, label: "No date", tasks: week.undated, empty: "Every open task has a date." },
    ...week.days.map((d) => ({
      id: d.date,
      label: formatDay(d.date, { weekday: "long", month: "short" }),
      tasks: d.tasks,
      current: d.date === today,
      empty: d.entries.length ? "No tasks." : "Nothing planned.",
      header: d.entries.length ? (
        <ul aria-label={`Calendar on ${formatDay(d.date)}`} className="space-y-1">
          {d.entries.map((e) => (
            <li key={`${e.type}-${e.id}`} className="flex items-center gap-1.5 text-xs">
              {e.type === "deadline" ? (
                <Flag className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              ) : (
                <CalendarDays className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              )}
              <Link href={e.href} className="min-w-0 truncate hover:underline">
                {e.time ? `${e.time} ` : ""}
                {e.title}
              </Link>
            </li>
          ))}
        </ul>
      ) : undefined,
    })),
  ];
  return (
    <div className="space-y-3">
      <nav aria-label="Week" className="flex flex-wrap items-center gap-2 text-sm">
        <Link
          href={`/tasks?view=week&week=${addDays(week.start, -7)}`}
          aria-label="Previous week"
          className="flex size-8 items-center justify-center rounded-md border border-border hover:bg-surface-hover"
        >
          <ChevronLeft className="size-4" aria-hidden />
        </Link>
        <Link
          href={`/tasks?view=week&week=${addDays(week.start, 7)}`}
          aria-label="Next week"
          className="flex size-8 items-center justify-center rounded-md border border-border hover:bg-surface-hover"
        >
          <ChevronRight className="size-4" aria-hidden />
        </Link>
        <h2 className="font-medium">
          {formatDay(week.start, { weekday: undefined, month: "short" })} –{" "}
          {formatDay(end, { weekday: undefined, month: "short", year: "numeric" })}
        </h2>
        {!thisWeek && (
          <Link href="/tasks?view=week" className="text-primary hover:underline">
            This week
          </Link>
        )}
      </nav>
      <p className="text-xs text-muted-foreground">
        A task’s day is its due date: moving it to another day changes when it’s due.
      </p>
      <TaskLanes
        label="Task week"
        lanes={lanes}
        today={today}
        className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
        onMove={(id, laneId) => setTaskDueDateAction(id, laneId === NO_DATE ? null : laneId)}
      />
    </div>
  );
}
