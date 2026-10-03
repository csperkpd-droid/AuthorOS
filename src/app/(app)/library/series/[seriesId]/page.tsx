import { BookPlus, Settings2, Trash2 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { formatCount, formatWords } from "@/lib/format";
import { getSeries, listSeriesOptions } from "@/modules/library";
import { BookDialog, SeriesBookOrder, SeriesDialog, trashSeriesAction } from "@/modules/library/ui";
import { listPenNames } from "@/modules/pen-names";
import { requireAuthorContext } from "@/server/context";
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
  const [series, penNames, seriesOptions] = await Promise.all([
    orNotFound(getSeries(ctx, seriesId)),
    listPenNames(ctx),
    listSeriesOptions(ctx),
  ]);
  const penOptions = penNames.map((p) => ({ id: p.id, name: p.name }));
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
    </div>
  );
}
