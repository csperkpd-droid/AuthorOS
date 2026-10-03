"use client";

import Link from "next/link";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { FormError } from "@/components/ui/field";
import type { TaskPriority, TaskStatus } from "@/generated/prisma/enums";
import { formatDay } from "@/lib/dates";
import { useAction } from "@/hooks/use-action";
import { cn } from "@/lib/utils";

import { setTaskStatusAction } from "../actions";

type Task = {
  id: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueOn: string | null;
  concerns: { id: string; title: string; href: string }[];
};

/** Tasks with a checkbox to complete (or reopen) each. */
export function TaskList({
  tasks,
  today,
  label = "Tasks",
}: {
  tasks: Task[];
  /** The author's today, to flag overdue tasks. */
  today: string;
  label?: string;
}) {
  const { run, error } = useAction(setTaskStatusAction);
  // Checked state shown immediately, until the server's list catches up.
  const [optimistic, setOptimistic] = useState<Record<string, boolean>>({});

  async function toggle(id: string, done: boolean) {
    setOptimistic((o) => ({ ...o, [id]: done }));
    const result = await run(id, done ? "DONE" : "TODO");
    setOptimistic((o) => {
      const next = { ...o };
      delete next[id];
      return next;
    });
    return result;
  }
  return (
    <>
      <FormError message={error} />
      <ul
        aria-label={label}
        className="divide-y divide-border rounded-xl border border-border bg-surface"
      >
        {tasks.map((t) => {
          const done = optimistic[t.id] ?? t.status === "DONE";
          const overdue = !done && t.dueOn !== null && t.dueOn < today;
          return (
            <li key={t.id} className="flex items-start gap-3 p-3">
              <input
                type="checkbox"
                checked={done}
                onChange={() => toggle(t.id, !done)}
                aria-label={done ? `Reopen ${t.title}` : `Mark ${t.title} done`}
                className="mt-1 size-4 shrink-0 accent-[var(--primary)]"
              />
              <div className="min-w-0 flex-1">
                <Link
                  href={`/tasks/${t.id}`}
                  className={cn(
                    "font-medium hover:underline",
                    done && "text-muted-foreground line-through",
                  )}
                >
                  {t.title}
                </Link>
                {t.concerns.length > 0 && (
                  <p className="truncate text-xs text-muted-foreground">
                    {t.concerns.map((c, i) => (
                      <span key={c.id}>
                        {i > 0 && ", "}
                        <Link href={c.href} className="hover:text-foreground hover:underline">
                          {c.title}
                        </Link>
                      </span>
                    ))}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 flex-wrap justify-end gap-1">
                {t.priority === "HIGH" && !done && (
                  <Badge className="bg-primary/10 text-primary">High</Badge>
                )}
                {t.dueOn && (
                  <Badge className={overdue ? "bg-destructive/10 text-destructive" : undefined}>
                    {overdue ? "Overdue · " : ""}
                    {formatDay(t.dueOn, { weekday: "short", month: "short" })}
                  </Badge>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}
