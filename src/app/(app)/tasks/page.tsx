import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/shell/page-header";
import { isDateString } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { taskWeek } from "@/modules/calendar";
import { today } from "@/modules/progress";
import { BOARD_DONE_DAYS, listTaskBoard, listTasks } from "@/modules/tasks";
import {
  QuickAddTask,
  TaskBoardView,
  TaskList,
  TaskViewTabs,
  TaskWeekView,
  type TaskViewName,
} from "@/modules/tasks/ui";
import { requireAuthorContext } from "@/server/context";

/** The views, as they appear in the address (`/tasks?view=board`). */
const VIEWS: readonly TaskViewName[] = ["list", "board", "week"];

export const metadata: Metadata = { title: "Tasks" };

export default async function TasksPage({ searchParams }: PageProps<"/tasks">) {
  const ctx = await requireAuthorContext();
  const params = await searchParams;
  const explicit =
    typeof params.view === "string" && (VIEWS as readonly string[]).includes(params.view);
  const view = (explicit ? params.view : "list") as TaskViewName;
  const todayDate = await today(ctx);

  return (
    <div className="space-y-6">
      <PageHeader title="Tasks" description="Writing to-dos, for any book, scene or character." />
      <QuickAddTask />
      <TaskViewTabs view={view} explicit={explicit} bare={Object.keys(params).length === 0} />
      {view === "board" ? (
        <TaskBoardView
          board={await listTaskBoard(ctx)}
          today={todayDate}
          doneDays={BOARD_DONE_DAYS}
        />
      ) : view === "week" ? (
        <TaskWeekView
          week={await taskWeek(ctx, {
            weekOf:
              typeof params.week === "string" && isDateString(params.week)
                ? params.week
                : todayDate,
            today: todayDate,
            penNameId: ctx.activePenNameId,
          })}
          today={todayDate}
        />
      ) : (
        <TaskListView showDone={params.show === "done"} today={todayDate} />
      )}
    </div>
  );
}

/** The List (M4): open tasks, or done ones. */
async function TaskListView({ showDone, today }: { showDone: boolean; today: string }) {
  const ctx = await requireAuthorContext();
  const tasks = await listTasks(ctx, { status: showDone ? "done" : "open" });
  return (
    <>
      <nav aria-label="Task filter" className="flex gap-1 text-sm">
        {[
          { href: "/tasks?view=list", label: "To do", active: !showDone },
          { href: "/tasks?view=list&show=done", label: "Done", active: showDone },
        ].map((f) => (
          <Link
            key={f.href}
            href={f.href}
            aria-current={f.active ? "page" : undefined}
            className={cn(
              "rounded-full px-3 py-1",
              f.active
                ? "bg-secondary text-primary"
                : "text-muted-foreground hover:bg-surface-hover",
            )}
          >
            {f.label}
          </Link>
        ))}
      </nav>
      {tasks.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-6 py-12 text-center text-sm text-muted-foreground">
          {showDone
            ? "Nothing done yet."
            : "Nothing to do. Add a task above, or from any book or scene."}
        </p>
      ) : (
        <TaskList tasks={tasks} today={today} />
      )}
    </>
  );
}
