import { AlertTriangle, CheckCircle2, Clock, TrendingUp } from "lucide-react";
import Link from "next/link";

import { Progress } from "@/components/ui/progress";
import { formatDay } from "@/lib/dates";
import { formatNumber, formatWords } from "@/lib/format";

import type { BookPace } from "../service";

const STATUS = {
  done: { label: "Target reached", Icon: CheckCircle2 },
  "on-track": { label: "On track", Icon: TrendingUp },
  behind: { label: "Behind pace", Icon: AlertTriangle },
  overdue: { label: "Past the deadline", Icon: AlertTriangle },
  "no-deadline": { label: "No deadline", Icon: Clock },
} as const;

/** Books with a target or deadline: progress and the pace needed. */
export function BookPaceList({ books }: { books: BookPace[] }) {
  return (
    <ul
      aria-label="Book progress"
      className="divide-y divide-border rounded-xl border border-border bg-surface"
    >
      {books.map((b) => {
        const { label, Icon } = STATUS[b.status];
        return (
          <li key={b.id} className="space-y-2 p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <Link href={`/books/${b.id}`} className="font-medium hover:underline">
                {b.title}
              </Link>
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Icon
                  className={
                    b.status === "behind" || b.status === "overdue"
                      ? "size-3.5 text-destructive"
                      : "size-3.5 text-primary"
                  }
                  aria-hidden
                />
                {label}
              </span>
            </div>
            {b.target !== null && (
              <Progress
                value={(b.words / b.target) * 100}
                label={`${b.title}: progress toward target`}
              />
            )}
            <p className="text-xs text-muted-foreground">
              {formatWords(b.words)}
              {b.target !== null && ` of ${formatNumber(b.target)}`}
              {b.dueOn && ` · due ${formatDay(b.dueOn, { weekday: undefined, month: "short" })}`}
              {b.daysLeft !== null &&
                b.daysLeft >= 0 &&
                ` (${b.daysLeft === 1 ? "1 day" : `${b.daysLeft} days`} left)`}
              {b.neededPerDay !== null &&
                b.status !== "done" &&
                ` · needs ${formatNumber(b.neededPerDay)} a day`}
              {` · lately ${formatNumber(b.recentPerDay)} a day`}
            </p>
          </li>
        );
      })}
    </ul>
  );
}
