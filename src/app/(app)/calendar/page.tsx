import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/shell/page-header";
import { Button, buttonVariants } from "@/components/ui/button";
import { addMonths, formatDay, monthOf } from "@/lib/dates";
import { calendarMonth } from "@/modules/calendar";
import { EventDialog, MonthCalendar } from "@/modules/calendar/ui";
import { today } from "@/modules/progress";
import { requireAuthorContext } from "@/server/context";

export const metadata: Metadata = { title: "Calendar" };

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export default async function CalendarPage({ searchParams }: PageProps<"/calendar">) {
  const ctx = await requireAuthorContext();
  const todayDate = await today(ctx);
  const requested = (await searchParams).month;
  const month =
    typeof requested === "string" && MONTH.test(requested) ? requested : monthOf(todayDate);
  const { days } = await calendarMonth(ctx, { month, penNameId: ctx.activePenNameId });
  const label = formatDay(`${month}-01`, { weekday: undefined, day: undefined, year: "numeric" });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Calendar"
        description="Events, task due dates, book deadlines and the words you wrote each day."
        actions={
          <EventDialog
            defaultDate={todayDate}
            trigger={
              <Button>
                <Plus />
                New event
              </Button>
            }
          />
        }
      />
      <nav aria-label="Months" className="flex items-center justify-between gap-2">
        <Link
          href={`/calendar?month=${addMonths(month, -1)}`}
          className={buttonVariants({ variant: "ghost", size: "sm" })}
          aria-label="Previous month"
        >
          <ChevronLeft />
        </Link>
        <h2 className="font-serif text-xl" aria-live="polite">
          {label}
        </h2>
        <div className="flex items-center gap-1">
          {month !== monthOf(todayDate) && (
            <Link href="/calendar" className={buttonVariants({ variant: "outline", size: "sm" })}>
              Today
            </Link>
          )}
          <Link
            href={`/calendar?month=${addMonths(month, 1)}`}
            className={buttonVariants({ variant: "ghost", size: "sm" })}
            aria-label="Next month"
          >
            <ChevronRight />
          </Link>
        </div>
      </nav>
      <MonthCalendar month={month} days={days} today={todayDate} />
    </div>
  );
}
