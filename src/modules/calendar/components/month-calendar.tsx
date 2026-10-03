import { BookMarked, CalendarDays, CircleCheck, Circle, PenLine } from "lucide-react";
import Link from "next/link";

import { formatDay, monthOf } from "@/lib/dates";
import { formatNumber, formatWords } from "@/lib/format";
import { cn } from "@/lib/utils";

import type { CalendarDay, CalendarEntry } from "../service";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function EntryIcon({ entry }: { entry: CalendarEntry }) {
  const cls = "size-3.5 shrink-0";
  if (entry.type === "event")
    return <CalendarDays className={cn(cls, "text-primary")} aria-hidden />;
  if (entry.type === "deadline")
    return <BookMarked className={cn(cls, "text-destructive")} aria-hidden />;
  return entry.done ? (
    <CircleCheck className={cn(cls, "text-muted-foreground")} aria-hidden />
  ) : (
    <Circle className={cn(cls, "text-muted-foreground")} aria-hidden />
  );
}

const TYPE_LABEL = { event: "Event", task: "Task", deadline: "Deadline" } as const;

function Entry({ entry }: { entry: CalendarEntry }) {
  return (
    <Link
      href={entry.href}
      className={cn(
        "flex min-w-0 items-center gap-1 rounded px-1 py-0.5 text-xs hover:bg-muted",
        entry.type === "task" && entry.done && "text-muted-foreground line-through",
      )}
    >
      <EntryIcon entry={entry} />
      <span className="sr-only">{TYPE_LABEL[entry.type]}: </span>
      {entry.type === "event" && entry.time && (
        <span className="text-muted-foreground">{entry.time}</span>
      )}
      <span className="truncate">{entry.title}</span>
    </Link>
  );
}

/**
 * A month: a Monday-first grid on wider screens, a list of days with
 * something on them on phones. Shows events, task due dates, book deadlines
 * and words written.
 */
export function MonthCalendar({
  month,
  days,
  today,
}: {
  month: string;
  days: CalendarDay[];
  today: string;
}) {
  const busy = days.filter((d) => monthOf(d.date) === month && (d.entries.length || d.words));
  return (
    <>
      <div className="hidden md:block">
        <div
          role="table"
          aria-label="Month"
          className="overflow-hidden rounded-xl border border-border"
        >
          <div role="row" className="grid grid-cols-7 border-b border-border bg-muted/40">
            {WEEKDAYS.map((d) => (
              <div
                role="columnheader"
                key={d}
                className="px-2 py-1 text-xs font-medium text-muted-foreground"
              >
                {d}
              </div>
            ))}
          </div>
          {Array.from({ length: days.length / 7 }, (_, w) => (
            <div
              role="row"
              key={w}
              className="grid grid-cols-7 border-b border-border last:border-b-0"
            >
              {days.slice(w * 7, w * 7 + 7).map((d) => {
                const inMonth = monthOf(d.date) === month;
                return (
                  <div
                    role="cell"
                    key={d.date}
                    aria-label={formatDay(d.date)}
                    aria-current={d.date === today ? "date" : undefined}
                    className={cn(
                      "min-h-28 space-y-0.5 border-r border-border p-1 last:border-r-0",
                      !inMonth && "bg-muted/30 text-muted-foreground",
                    )}
                  >
                    <div className="flex items-center justify-between px-1">
                      <span
                        className={cn(
                          "text-xs",
                          d.date === today &&
                            "flex size-5 items-center justify-center rounded-full bg-primary font-medium text-primary-foreground",
                        )}
                      >
                        {Number(d.date.slice(8))}
                      </span>
                      {d.words !== 0 && (
                        <span className="flex items-center gap-0.5 text-[0.7rem] text-muted-foreground">
                          <PenLine className="size-3" aria-hidden />
                          {formatNumber(d.words)}
                          <span className="sr-only"> words written</span>
                        </span>
                      )}
                    </div>
                    {d.entries.map((e) => (
                      <Entry key={`${e.type}-${e.id}`} entry={e} />
                    ))}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <div className="md:hidden">
        {busy.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border px-6 py-10 text-center text-sm text-muted-foreground">
            Nothing this month yet.
          </p>
        ) : (
          <ol
            aria-label="Days"
            className="divide-y divide-border rounded-xl border border-border bg-surface"
          >
            {busy.map((d) => (
              <li key={d.date} className="space-y-1 p-3">
                <div className="flex items-baseline justify-between gap-2">
                  <p className={cn("font-medium", d.date === today && "text-primary")}>
                    {formatDay(d.date)}
                    {d.date === today && " · Today"}
                  </p>
                  {d.words !== 0 && (
                    <p className="text-xs text-muted-foreground">{formatWords(d.words)} written</p>
                  )}
                </div>
                {d.entries.map((e) => (
                  <Entry key={`${e.type}-${e.id}`} entry={e} />
                ))}
              </li>
            ))}
          </ol>
        )}
      </div>
    </>
  );
}
