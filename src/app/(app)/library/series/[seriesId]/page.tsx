import { BookPlus, Heart, Plus, Settings2, Trash2, UserRound } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/shell/page-header";
import { Button, buttonVariants } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { formatCount, formatWords } from "@/lib/format";
import { FieldHistoryDialog } from "@/modules/history/ui";
import { getSeries, listSeriesOptions } from "@/modules/library";
import { BookDialog, SeriesBookOrder, SeriesDialog, trashSeriesAction } from "@/modules/library/ui";
import { ChangePenNameDialog } from "@/modules/impact/ui";
import { listPenNames } from "@/modules/pen-names";
import { listKits, listOutlines, newStructureOptions } from "@/modules/structure";
import {
  ApplyKitDialog,
  NewStructureDialog,
  OutlineList,
  SaveKitDialog,
} from "@/modules/structure/ui";
import { listTropes, tropesOf } from "@/modules/tropes";
import { TropePicker } from "@/modules/tropes/ui";
import { requireAuthorContext } from "@/server/context";
import { can, canView } from "@/server/policy";
import { orNotFound } from "@/server/not-found";

export async function generateMetadata({
  params,
}: PageProps<"/library/series/[seriesId]">): Promise<Metadata> {
  const ctx = await requireAuthorContext();
  const series = await orNotFound(getSeries(ctx, (await params).seriesId));
  return { title: series.title };
}

export default async function SeriesPage({ params }: PageProps<"/library/series/[seriesId]">) {
  const { seriesId } = await params;
  const ctx = await requireAuthorContext();
  const series = await orNotFound(getSeries(ctx, seriesId));
  const [penNames, seriesOptions, outlines, structureOptions, kits] = await Promise.all([
    listPenNames(ctx),
    listSeriesOptions(ctx),
    listOutlines(ctx, { seriesId }),
    newStructureOptions(ctx, { penNameId: series.penName.id }),
    listKits(ctx),
  ]);
  const penOptions = penNames.map((p) => ({ id: p.id, name: p.name }));
  const [tropes, allTropes] = canView(ctx, "storyBible")
    ? await Promise.all([tropesOf(ctx, seriesId), listTropes(ctx)])
    : [null, []];
  const totalWords = series.books.reduce((n, b) => n + b.wordCount, 0);

  return (
    <div className="space-y-8">
      <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground">
        <Link href="/library" className="hover:text-foreground">
          Library
        </Link>{" "}
        › Series
      </nav>
      <PageHeader
        title={series.title}
        description={`${series.penName.name} · ${formatCount(series.books.length, "book")} · ${formatWords(totalWords)}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <FieldHistoryDialog nodeId={series.id} />
            <SeriesDialog
              series={series}
              penNames={penOptions}
              trigger={
                <Button variant="outline">
                  <Settings2 />
                  Details
                </Button>
              }
            />
            <ChangePenNameDialog
              kind="SERIES"
              id={series.id}
              title={series.title}
              currentPenNameId={series.penName.id}
              penNames={penOptions}
              trigger={
                <Button variant="outline">
                  <UserRound />
                  Change pen name…
                </Button>
              }
            />
            <ConfirmDialog
              trigger={
                <Button variant="ghost" aria-label="Move series to Trash">
                  <Trash2 />
                </Button>
              }
              title={`Move “${series.title}” to the Trash?`}
              description={`The series and its ${formatCount(series.books.length, "book")} will be hidden until you restore them from the Trash.`}
              confirmLabel="Move to Trash"
              destructive
              onConfirm={trashSeriesAction.bind(null, series.id)}
              navigateTo="/library"
            />
            <BookDialog
              penNames={penOptions}
              seriesOptions={seriesOptions}
              defaultSeriesId={series.id}
              trigger={
                <Button>
                  <BookPlus />
                  Add book
                </Button>
              }
            />
          </div>
        }
      />
      {series.description && (
        <p className="max-w-prose text-muted-foreground">{series.description}</p>
      )}

      {tropes && (
        <TropePicker
          targetId={series.id}
          targetTitle={series.title}
          tropes={tropes}
          allTropes={allTropes}
          canEdit={can(ctx, "edit", "storyBible")}
        />
      )}

      {series.books.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-6 py-10 text-center text-sm text-muted-foreground">
          No books in this series yet.
        </p>
      ) : (
        <section aria-labelledby="order-heading" className="space-y-3">
          <h2 id="order-heading" className="font-serif text-xl">
            Reading order
          </h2>
          <SeriesBookOrder books={series.books} seriesTitle={series.title} />
        </section>
      )}

      <section aria-labelledby="series-structures-heading" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="series-structures-heading" className="font-serif text-xl">
            Structures
          </h2>
          <div className="flex flex-wrap gap-2">
            <Link
              href={`/library/series/${series.id}/romance`}
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              <Heart />
              Romance Center
            </Link>
            {outlines.some((o) => o.series?.id === series.id) && (
              <SaveKitDialog target={{ seriesId: series.id }} defaultName={`${series.title} kit`} />
            )}
            {series.books.length > 0 && (
              <ApplyKitDialog
                kits={kits}
                target={{ seriesId: series.id }}
                relationships={structureOptions.relationships}
                characters={structureOptions.characters}
              />
            )}
            {series.books.length > 0 && (
              <NewStructureDialog
                {...structureOptions}
                books={series.books.map((b) => ({ id: b.id, label: b.title }))}
                series={[{ id: series.id, label: series.title }]}
                defaults={{ seriesId: series.id }}
                trigger={
                  <Button variant="outline" size="sm">
                    <Plus />
                    New structure
                  </Button>
                }
              />
            )}
          </div>
        </div>
        {outlines.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Plan arcs that span the whole series, such as a slow-burn romance, or structures for
            single books.
          </p>
        ) : (
          <OutlineList outlines={outlines} showWork />
        )}
      </section>
    </div>
  );
}
