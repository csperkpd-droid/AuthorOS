import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/shell/page-header";
import { cn } from "@/lib/utils";
import { today } from "@/modules/progress";
import { listTasks } from "@/modules/tasks";
import { QuickAddTask, TaskList } from "@/modules/tasks/ui";
import { requireAuthorContext } from "@/server/context";

export const metadata: Metadata = { title: "Tasks" };

export default async function TasksPage({ searchParams }: PageProps<"/tasks">) {
  const ctx = await requireAuthorContext();
  const showDone = (await searchParams).show === "done";
  const [tasks, todayDate] = await Promise.all([
    listTasks(ctx, { status: showDone ? "done" : "open" }),
    today(ctx),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader title="Tasks" description="Writing to-dos, for any book, scene or character." />
      <QuickAddTask />
      <nav aria-label="Task filter" className="flex gap-1 text-sm">
        {[
          { href: "/tasks", label: "To do", active: !showDone },
          { href: "/tasks?show=done", label: "Done", active: showDone },
        ].map((f) => (
          <Link
            key={f.href}
            href={f.href}
            aria-current={f.active ? "page" : undefined}
            className={cn(
              "rounded-full px-3 py-1",
              f.active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted",
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
        <TaskList tasks={tasks} today={todayDate} />
      )}
    </div>
  );
}
