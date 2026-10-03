import { BookPlus, Library, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { listLibrary, listSeriesOptions } from "@/modules/library";
import { BookCard, BookDialog, SeriesDialog } from "@/modules/library/ui";
import { getActivePenName, getPenNameForNewWork, listPenNames } from "@/modules/pen-names";
import { requireAuthorContext } from "@/server/context";

export const metadata: Metadata = { title: "Library" };

type Library = Awaited<ReturnType<typeof listLibrary>>;

export default async function LibraryPage() {
  const ctx = await requireAuthorContext();
  const [active, library, penNames, seriesOptions, newWorkPen] = await Promise.all([
    getActivePenName(ctx),
    listLibrary(ctx, { penNameId: ctx.activePenNameId }),
    listPenNames(ctx),
    listSeriesOptions(ctx),
    getPenNameForNewWork(ctx),
  ]);
  const penOptions = penNames.map((p) => ({ id: p.id, name: p.name }));
  const isEmpty = library.series.length === 0 && library.standalone.length === 0;

  // Across all identities, group the shelves by pen name.
  const groups: { key: string; heading: string | null; library: Library }[] = active
    ? [{ key: active.id, heading: null, library }]
    : groupByPenName(library);

  return (
    <div className="space-y-8">
      <PageHeader
        title="Library"
        description={active ? `Writing as ${active.name}` : "All identities"}
        actions={
          <div className="flex flex-wrap gap-2">
            <SeriesDialog
              penNames={penOptions}
              defaultPenNameId={newWorkPen.id}
              trigger={
                <Button variant="outline">
                  <Plus />
                  New series
                </Button>
              }
            />
            <BookDialog
              penNames={penOptions}
              seriesOptions={seriesOptions.filter((s) => !active || s.penName.id === active.id)}
              defaultPenNameId={newWorkPen.id}
              trigger={
                <Button>
                  <BookPlus />
                  New book
                </Button>
              }
            />
          </div>
        }
      />

      {isEmpty ? (
        <div className="flex flex-col items-center rounded-xl border border-dashed border-border px-6 py-16 text-center">
          <Library className="size-10 text-muted-foreground" aria-hidden />
          <p className="mt-4 font-serif text-xl">No books yet</p>
          <p className="mt-2 max-w-md text-sm text-muted-foreground">
            Create a book to start writing, or a series to hold several books.
            {active && ` New work will be published as ${active.name}.`}
          </p>
        </div>
      ) : (
        groups.map((group) => (
          <section key={group.key} aria-label={group.heading ?? "Your books"} className="space-y-6">
            {group.heading && (
              <h2 className="border-b border-border pb-2 font-serif text-2xl">{group.heading}</h2>
            )}
            {group.library.series.map((series) => (
              <div key={series.id} className="space-y-3">
                <div className="flex items-baseline justify-between gap-3">
                  <h3 className="font-serif text-xl">
                    <Link href={`/library/series/${series.id}`} className="hover:text-primary">
                      {series.title}
                    </Link>
                  </h3>
                  <span className="text-sm text-muted-foreground">Series</span>
                </div>
                {series.books.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No books in this series yet.</p>
                ) : (
                  <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {series.books.map((book) => (
                      <li key={book.id}>
                        <BookCard book={book} />
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
            {group.library.standalone.length > 0 && (
              <div className="space-y-3">
                {group.library.series.length > 0 && (
                  <h3 className="font-serif text-xl">Standalone books</h3>
                )}
                <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {group.library.standalone.map((book) => (
                    <li key={book.id}>
                      <BookCard book={book} />
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        ))
      )}
    </div>
  );
}

function groupByPenName(library: Library) {
  const groups = new Map<string, { key: string; heading: string; library: Library }>();
  const group = (pen: { id: string; name: string; archivedAt: Date | null }) => {
    if (!groups.has(pen.id)) {
      groups.set(pen.id, {
        key: pen.id,
        heading: pen.archivedAt ? `${pen.name} (archived)` : pen.name,
        library: { series: [], standalone: [] },
      });
    }
    return groups.get(pen.id)!.library;
  };
  for (const s of library.series) group(s.penName).series.push(s);
  for (const b of library.standalone) group(b.penName).standalone.push(b);
  return [...groups.values()].sort((a, b) => a.heading.localeCompare(b.heading));
}
