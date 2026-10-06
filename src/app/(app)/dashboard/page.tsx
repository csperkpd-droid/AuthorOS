import { CalendarDays, Flame, PenLine, Plus, Target } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { availabilityLabel, navigation } from "@/config/navigation";
import { formatDay } from "@/lib/dates";
import { draftOwner } from "@/lib/local-drafts";
import { formatDateTime, formatNumber, formatWords } from "@/lib/format";
import { deadlinesFor, upcoming } from "@/modules/calendar";
import { listLibrary } from "@/modules/library";
import { listRecentScenes } from "@/modules/manuscript";
import { getActivePenName } from "@/modules/pen-names";
import { bookPace, writingStats } from "@/modules/progress";
import { BookPaceList, DailyGoalDialog, LogWordsDialog, WordsChart } from "@/modules/progress/ui";
import { getWritingPlace } from "@/modules/work-context";
import { ContinueWritingButton } from "@/modules/work-context/ui";
import { getWorkspace } from "@/modules/workspaces";
import { getSessionUser, requireAuthorContext } from "@/server/context";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const ctx = await requireAuthorContext();
  const penNameId = ctx.activePenNameId;
  const [user, workspace, active, recent, stats, pace, library, place] = await Promise.all([
    getSessionUser(),
    getWorkspace(ctx.workspaceId),
    getActivePenName(ctx),
    listRecentScenes(ctx, { penNameId }),
    writingStats(ctx, { days: 30 }),
    deadlinesFor(ctx).then((deadlines) => bookPace(ctx, { penNameId, deadlines })),
    listLibrary(ctx, { penNameId }),
    getWritingPlace(ctx),
  ]);
  // Continue Writing: the latest writing place; without one (or if it is no
  // longer available), the most recently written scene.
  const resume = place
    ? place
    : recent[0]
      ? {
          sceneId: recent[0].id,
          href: `/books/${recent[0].book.id}/scenes/${recent[0].id}`,
          title: recent[0].title,
          context: `${recent[0].book.title} › ${recent[0].chapter.title}`,
          anchor: null,
        }
      : null;
  const soon = await upcoming(ctx, { from: stats.today, days: 7, penNameId });
  const books = [...library.series.flatMap((s) => s.books), ...library.standalone].map((b) => ({
    id: b.id,
    title: b.title,
  }));
  const firstName = user?.name?.split(" ")[0];
  const later = navigation
    .flatMap((g) => g.items)
    .filter((i) => i.availability.status !== "available");
  const goalPercent = stats.goal ? Math.min((stats.todayWords / stats.goal) * 100, 100) : null;

  return (
    <div className="space-y-10">
      <PageHeader
        title={firstName ? `Welcome, ${firstName}` : "Welcome"}
        description={`${workspace.name} · ${active ? `Writing as ${active.name}` : "All identities"}`}
        actions={
          <LogWordsDialog
            today={stats.today}
            books={books}
            trigger={
              <Button variant="outline">
                <Plus />
                Log words
              </Button>
            }
          />
        }
      />

      {resume && (
        <section
          aria-labelledby="resume-heading"
          className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border bg-surface p-4"
        >
          <div className="min-w-0">
            <h2 id="resume-heading" className="text-xs text-muted-foreground">
              Where you left off
            </h2>
            <p className="truncate font-medium">{resume.title}</p>
            {resume.context && (
              <p className="truncate text-xs text-muted-foreground">{resume.context}</p>
            )}
          </div>
          <ContinueWritingButton
            owner={draftOwner(ctx)}
            sceneId={resume.sceneId}
            href={resume.href}
            anchor={resume.anchor}
          />
        </section>
      )}

      <section aria-labelledby="today-heading" className="space-y-4">
        <h2 id="today-heading" className="sr-only">
          Today
        </h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <Card>
            <CardContent className="space-y-2">
              <p className="text-sm text-muted-foreground">Words today</p>
              <p className="text-5xl font-semibold tracking-tight tabular-nums">
                {formatNumber(stats.todayWords)}
              </p>
              {goalPercent !== null ? (
                <>
                  <Progress value={goalPercent} label="Progress toward today’s goal" />
                  <p className="text-xs text-muted-foreground">
                    {stats.todayWords >= stats.goal!
                      ? "Goal reached"
                      : `${formatNumber(stats.goal! - stats.todayWords)} to your goal of ${formatNumber(stats.goal!)}`}
                  </p>
                </>
              ) : (
                <p className="text-xs text-muted-foreground">No daily goal set.</p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardContent className="space-y-2">
              <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <Flame className="size-4 text-primary" aria-hidden />
                Streak
              </p>
              <p className="text-3xl font-semibold tabular-nums">
                {stats.streak === 1 ? "1 day" : `${stats.streak} days`}
              </p>
              <p className="text-xs text-muted-foreground">Days in a row with words written.</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="space-y-2">
              <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <Target className="size-4 text-primary" aria-hidden />
                Last 7 days
              </p>
              <p className="text-3xl font-semibold tabular-nums">{formatWords(stats.weekWords)}</p>
              <DailyGoalDialog
                goal={stats.goal}
                trigger={
                  <button type="button" className="text-xs text-primary hover:underline">
                    {stats.goal ? "Change daily goal" : "Set a daily goal"}
                  </button>
                }
              />
            </CardContent>
          </Card>
        </div>
        <Card>
          <CardContent className="space-y-3">
            <h3 className="font-medium">Words written, last 30 days</h3>
            <WordsChart days={stats.days} goal={stats.goal} />
          </CardContent>
        </Card>
      </section>

      <div className="grid gap-10 lg:grid-cols-2">
        <section aria-labelledby="upcoming-heading" className="space-y-4">
          <div className="flex items-center justify-between gap-2">
            <h2 id="upcoming-heading" className="font-serif text-xl">
              Next 7 days
            </h2>
            <Link href="/calendar" className="text-sm text-primary hover:underline">
              Calendar
            </Link>
          </div>
          {soon.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing scheduled. Add events on the calendar, or due dates to tasks and books.
            </p>
          ) : (
            <ol
              aria-label="Coming up"
              className="divide-y divide-border rounded-xl border border-border bg-surface"
            >
              {soon.map((d) => (
                <li key={d.date} className="space-y-1 p-3">
                  <p className="text-sm font-medium">
                    {d.date === stats.today ? "Today" : formatDay(d.date)}
                  </p>
                  <ul className="space-y-0.5 text-sm">
                    {d.entries.map((e) => (
                      <li key={`${e.type}-${e.id}`} className="flex items-center gap-2">
                        <CalendarDays
                          className="size-3.5 shrink-0 text-muted-foreground"
                          aria-hidden
                        />
                        <Link href={e.href} className="truncate hover:underline">
                          {e.type === "task" ? `Task: ${e.title}` : e.title}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section aria-labelledby="pace-heading" className="space-y-4">
          <h2 id="pace-heading" className="font-serif text-xl">
            Books in progress
          </h2>
          {pace.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Give a book a target word count or a deadline (Book details) to see its pace here.
            </p>
          ) : (
            <BookPaceList books={pace} />
          )}
        </section>
      </div>

      <section aria-labelledby="continue-heading" className="space-y-4">
        <h2 id="continue-heading" className="font-serif text-xl">
          Recent scenes
        </h2>
        {recent.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing here yet.{" "}
            <Link href="/library" className="text-primary underline-offset-4 hover:underline">
              Open your library
            </Link>{" "}
            to create a book.
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
            {recent.map((scene) => (
              <li key={scene.id}>
                <Link
                  href={`/books/${scene.book.id}/scenes/${scene.id}`}
                  className="flex flex-wrap items-center gap-3 p-4 hover:bg-muted/50"
                >
                  <PenLine className="size-4 shrink-0 text-primary" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{scene.title}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {scene.book.title} › {scene.chapter.title}
                    </p>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {formatWords(scene.wordCount)} · {formatDateTime(scene.updatedAt)}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {later.length > 0 && (
        <section aria-labelledby="sections-heading" className="space-y-4">
          <h2 id="sections-heading" className="font-serif text-xl">
            Coming later
          </h2>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {later.map((item) => {
              const Icon = item.icon;
              return (
                <li key={item.href}>
                  <Card className="h-full">
                    <CardContent className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Icon className="size-5 text-primary" aria-hidden />
                        <span className="text-xs text-muted-foreground">
                          {availabilityLabel(item.availability)}
                        </span>
                      </div>
                      <p className="font-medium">{item.label}</p>
                      <p className="text-sm text-muted-foreground">{item.description}</p>
                    </CardContent>
                  </Card>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
