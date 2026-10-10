import { Orbit, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { listSeriesOptions } from "@/modules/library";
import { getPenNameForNewWork, listPenNames } from "@/modules/pen-names";
import { listWorldEntries, listWorldEntryTypes } from "@/modules/world";
import { WorldObjectDialog } from "@/modules/world/ui";
import { requireAuthorContext } from "@/server/context";

export const metadata: Metadata = { title: "World" };

export default async function WorldEntriesPage() {
  const ctx = await requireAuthorContext();
  const [entries, types, series, penNames, defaultPen] = await Promise.all([
    listWorldEntries(ctx, { penNameId: ctx.activePenNameId }),
    listWorldEntryTypes(ctx),
    listSeriesOptions(ctx),
    listPenNames(ctx),
    getPenNameForNewWork(ctx),
  ]);
  const showPenName = !ctx.activePenNameId && penNames.length > 1;

  return (
    <div className="space-y-8">
      <PageHeader
        title="World"
        description="Organizations, items and anything else in your story worlds, in your own words."
        actions={
          <WorldObjectDialog
            kind="WORLD_ENTRY"
            seriesOptions={series}
            penNames={penNames}
            defaultPenNameId={defaultPen.id}
            entryTypes={types}
            trigger={
              <Button>
                <Plus />
                New world entry
              </Button>
            }
          />
        }
      />
      {entries.length === 0 ? (
        <div className="flex flex-col items-center rounded-xl border border-dashed border-border px-6 py-16 text-center">
          <Orbit className="size-10 text-muted-foreground" aria-hidden />
          <p className="mt-4 font-display text-2xl font-semibold">Nothing here yet</p>
          <p className="mt-2 max-w-md text-sm text-muted-foreground">
            Add the organizations, items and other things your stories rely on, and link them to
            characters, places and scenes.
          </p>
        </div>
      ) : (
        <ul aria-label="World entries" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {entries.map((e) => (
            <li key={e.id}>
              <Link
                href={`/world-entries/${e.id}`}
                className="flex h-full flex-col gap-2 rounded-xl border border-border bg-surface p-4 shadow-sm transition-colors hover:border-primary/40"
              >
                <p className="font-display text-2xl leading-snug font-semibold break-words">
                  {e.name}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Badge>{e.entryType}</Badge>
                  {showPenName && <Badge>{e.penName.name}</Badge>}
                  {e.series && (
                    <Badge className="bg-secondary text-primary">{e.series.title}</Badge>
                  )}
                </div>
                {e.summary && (
                  <p className="line-clamp-2 text-sm text-muted-foreground">{e.summary}</p>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
