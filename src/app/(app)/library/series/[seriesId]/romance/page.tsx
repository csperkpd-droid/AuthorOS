import { Heart } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { newStructureOptions, seriesRomance } from "@/modules/structure";
import { NewStructureDialog, RomanceProgression } from "@/modules/structure/ui";
import { requireAuthorContext } from "@/server/context";
import { orNotFound } from "@/server/not-found";

type Props = PageProps<"/library/series/[seriesId]/romance">;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const ctx = await requireAuthorContext();
  const center = await orNotFound(seriesRomance(ctx, (await params).seriesId));
  return { title: `Romance · ${center.series.title}` };
}

export default async function SeriesRomancePage({ params }: Props) {
  const { seriesId } = await params;
  const ctx = await requireAuthorContext();
  const center = await orNotFound(seriesRomance(ctx, seriesId));
  const options = await newStructureOptions(ctx, { penNameId: center.series.penNameId });

  return (
    <div className="space-y-8">
      <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground">
        <Link href="/library" className="hover:text-foreground">
          Library
        </Link>
        {" › "}
        <Link href={`/library/series/${seriesId}`} className="hover:text-foreground">
          {center.series.title}
        </Link>
      </nav>
      <PageHeader
        title="Romance Center"
        description={`Every romance in ${center.series.title}, book by book.`}
        actions={
          center.books.length > 0 ? (
            <NewStructureDialog
              {...options}
              books={center.books.map((b) => ({ id: b.id, label: b.title }))}
              series={[{ id: center.series.id, label: center.series.title }]}
              defaults={{ seriesId, kind: "ROMANCE" }}
              trigger={
                <Button>
                  <Heart />
                  New romance arc
                </Button>
              }
            />
          ) : undefined
        }
      />
      {center.relationships.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-6 py-12 text-center text-sm text-muted-foreground">
          {center.books.length === 0
            ? "Add books to the series first."
            : "No romance arcs yet. Create a series-long arc for your main couple (and any others), then plan each beat for the book where it happens."}
        </p>
      ) : (
        <RomanceProgression books={center.books} relationships={center.relationships} />
      )}
    </div>
  );
}
