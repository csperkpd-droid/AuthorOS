"use client";

import { useState } from "react";

import { formatDay } from "@/lib/dates";
import { formatNumber, formatWords } from "@/lib/format";
import { cn } from "@/lib/utils";

type Day = { date: string; words: number; metGoal: boolean };

/** Clean axis maximum: 1, 2 or 5 × a power of ten at or above `n`. */
function niceMax(n: number) {
  if (n <= 0) return 100;
  const p = 10 ** Math.floor(Math.log10(n));
  return ([1, 2, 5, 10].find((m) => m * p >= n) ?? 10) * p;
}

/**
 * Words written per day, one column per day (single series, so no legend:
 * the heading names it). The daily goal is a hairline reference. Each column
 * is focusable and shows its value on hover or focus; a table view carries
 * every value for screen readers and print.
 */
export function WordsChart({ days, goal }: { days: Day[]; goal: number | null }) {
  const [active, setActive] = useState<number | null>(null);
  const top = niceMax(Math.max(...days.map((d) => d.words), goal ?? 0));
  const ticks = [0, top / 2, top];
  const pct = (n: number) => `${(Math.max(n, 0) / top) * 100}%`;
  const shown = active !== null ? days[active] : null;

  return (
    <figure className="space-y-2">
      <div className="flex min-h-5 items-baseline justify-between text-xs text-muted-foreground">
        <span aria-live="polite">
          {shown ? (
            <>
              <span className="font-medium text-foreground">{formatWords(shown.words)}</span> on{" "}
              {formatDay(shown.date, { weekday: "short", month: "short" })}
            </>
          ) : (
            "Hover or focus a day for its words"
          )}
        </span>
        {goal !== null && <span>Goal {formatNumber(goal)} a day</span>}
      </div>
      <div className="flex gap-2 pt-3">
        {/* Y axis */}
        <div
          aria-hidden
          className="relative h-36 w-10 shrink-0 text-right text-[0.7rem] text-muted-foreground"
        >
          {ticks.map((t) => (
            <span
              key={t}
              className="absolute right-0 translate-y-1/2 leading-none"
              style={{ bottom: pct(t) }}
            >
              {formatNumber(t)}
            </span>
          ))}
        </div>
        <div className="relative h-36 min-w-0 flex-1">
          {/* Recessive hairline grid */}
          {ticks.map((t) => (
            <div
              key={t}
              aria-hidden
              className="absolute inset-x-0 border-t border-border"
              style={{ bottom: pct(t) }}
            />
          ))}
          {goal !== null && (
            <div
              aria-hidden
              className="absolute inset-x-0 border-t border-foreground/40"
              style={{ bottom: pct(goal) }}
            />
          )}
          <ol
            aria-label="Words written each day"
            className="absolute inset-0 flex items-end gap-[2px]"
          >
            {days.map((d, i) => (
              <li key={d.date} className="flex h-full min-w-0 flex-1 items-end justify-center">
                <button
                  type="button"
                  tabIndex={0}
                  aria-label={`${formatDay(d.date)}: ${formatWords(d.words)}`}
                  onMouseEnter={() => setActive(i)}
                  onMouseLeave={() => setActive(null)}
                  onFocus={() => setActive(i)}
                  onBlur={() => setActive(null)}
                  className="flex h-full w-full max-w-6 items-end focus-visible:outline-none"
                >
                  <span
                    className={cn(
                      "block w-full rounded-t-[4px] bg-primary transition-opacity",
                      active !== null && active !== i && "opacity-50",
                      active === i && "ring-2 ring-ring ring-offset-2 ring-offset-surface",
                    )}
                    style={{ height: d.words > 0 ? `max(2px, ${pct(d.words)})` : "0" }}
                  />
                </button>
              </li>
            ))}
          </ol>
        </div>
      </div>
      <div className="flex justify-between pl-12 text-[0.7rem] text-muted-foreground" aria-hidden>
        <span>{formatDay(days[0].date, { weekday: undefined, month: "short" })}</span>
        <span>Today</span>
      </div>
      <details className="text-sm">
        <summary className="cursor-pointer text-xs text-muted-foreground">Show as a table</summary>
        <table className="mt-2 w-full text-left text-xs">
          <thead>
            <tr className="text-muted-foreground">
              <th className="py-1 font-medium">Day</th>
              <th className="py-1 text-right font-medium">Words</th>
            </tr>
          </thead>
          <tbody>
            {[...days].reverse().map((d) => (
              <tr key={d.date} className="border-t border-border">
                <td className="py-1">{formatDay(d.date, { month: "short" })}</td>
                <td className="py-1 text-right tabular-nums">{formatNumber(d.words)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
