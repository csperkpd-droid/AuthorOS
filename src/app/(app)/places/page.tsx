import { MapPin, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatCount } from "@/lib/format";
import { listSeriesOptions } from "@/modules/library";
import { getPenNameForNewWork, listPenNames } from "@/modules/pen-names";
import { listPlaces } from "@/modules/world";
import { WorldObjectDialog } from "@/modules/world/ui";
import { requireAuthorContext } from "@/server/context";

export const metadata: Metadata = { title: "Places" };

export default async function PlacesPage() {
  const ctx = await requireAuthorContext();
  const [places, series, penNames, defaultPen] = await Promise.all([
    listPlaces(ctx, { penNameId: ctx.activePenNameId }),
    listSeriesOptions(ctx),
    listPenNames(ctx),
    getPenNameForNewWork(ctx),
  ]);
  const showPenName = !ctx.activePenNameId && penNames.length > 1;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Places"
        description={
          ctx.activePenNameId
            ? "Where this pen name’s stories happen, and every scene set there."
            : "Where your stories happen, across all your pen names."
        }
        actions={
          <WorldObjectDialog
            kind="PLACE"
            seriesOptions={series}
            penNames={penNames}
            defaultPenNameId={defaultPen.id}
            trigger={
              <Button>
                <Plus />
                New place
              </Button>
            }
          />
        }
      />
      {places.length === 0 ? (
        <div className="flex flex-col items-center rounded-xl border border-dashed border-border px-6 py-16 text-center">
          <MapPin className="size-10 text-muted-foreground" aria-hidden />
          <p className="mt-4 font-display text-2xl font-semibold">No places yet</p>
          <p className="mt-2 max-w-md text-sm text-muted-foreground">
            Create places here, or set a scene in a new place while you write.
          </p>
        </div>
      ) : (
        <ul aria-label="Places" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {places.map((p) => (
            <li key={p.id}>
              <Link
                href={`/places/${p.id}`}
                className="flex h-full flex-col gap-2 rounded-xl border border-border bg-surface p-4 shadow-sm transition-colors hover:border-primary/40"
              >
                <p className="font-display text-2xl leading-snug font-semibold break-words">
                  {p.name}
                </p>
                <div className="flex flex-wrap gap-2">
                  {showPenName && <Badge>{p.penName.name}</Badge>}
                  {p.series && (
                    <Badge className="bg-secondary text-primary">{p.series.title}</Badge>
                  )}
                </div>
                {p.summary && (
                  <p className="line-clamp-2 text-sm text-muted-foreground">{p.summary}</p>
                )}
                <p className="mt-auto text-xs text-muted-foreground">
                  {formatCount(p.sceneCount, "scene")} set here
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
