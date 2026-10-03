import { Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatCount } from "@/lib/format";
import { listLibrary } from "@/modules/library";
import { listIdentities } from "@/modules/pen-names";
import { PenNameDialog, PenNameMenu } from "@/modules/pen-names/ui";
import { requireAuthorContext } from "@/server/context";

export const metadata: Metadata = { title: "Pen names" };

/** All Identities: every pen name and the work published under it. */
export default async function IdentitiesPage() {
  const ctx = await requireAuthorContext();
  const [identities, library] = await Promise.all([
    listIdentities(ctx),
    listLibrary(ctx, { penNameId: null }),
  ]);
  const active = identities.filter((i) => !i.archivedAt);
  const archived = identities.filter((i) => i.archivedAt);

  const workFor = (penNameId: string) => ({
    series: library.series.filter((s) => s.penName.id === penNameId),
    books: library.standalone.filter((b) => b.penName.id === penNameId),
  });

  return (
    <div className="space-y-8">
      <PageHeader
        title="Pen names"
        description="Your author identities. Choose who you’re writing as from the sidebar."
        actions={
          <PenNameDialog
            trigger={
              <Button>
                <Plus />
                New pen name
              </Button>
            }
          />
        }
      />

      <ul className="space-y-4" aria-label="Pen names">
        {active.map((identity) => {
          const work = workFor(identity.id);
          const isActive = ctx.activePenNameId === identity.id;
          return (
            <li
              key={identity.id}
              className="rounded-xl border border-border bg-surface p-5 shadow-sm"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="flex flex-wrap items-center gap-2 font-serif text-xl">
                    {identity.name}
                    {identity.isDefault && <Badge>Default</Badge>}
                    {isActive && <Badge className="bg-primary/10 text-primary">Writing as</Badge>}
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {formatCount(identity.seriesCount, "series", "series")} ·{" "}
                    {formatCount(identity.bookCount, "book")}
                  </p>
                  {identity.bio && <p className="mt-2 max-w-prose text-sm">{identity.bio}</p>}
                </div>
                <PenNameMenu penName={identity} isActive={isActive} />
              </div>
              {(work.series.length > 0 || work.books.length > 0) && (
                <ul className="mt-4 flex flex-wrap gap-2 border-t border-border pt-4 text-sm">
                  {work.series.map((s) => (
                    <li key={s.id}>
                      <Link
                        href={`/library/series/${s.id}`}
                        className="inline-flex items-center gap-1.5 rounded-md bg-muted px-2 py-1 hover:text-primary"
                      >
                        <span className="text-xs text-muted-foreground">Series</span> {s.title}
                      </Link>
                    </li>
                  ))}
                  {work.books.map((b) => (
                    <li key={b.id}>
                      <Link
                        href={`/books/${b.id}`}
                        className="inline-flex rounded-md bg-muted px-2 py-1 hover:text-primary"
                      >
                        {b.title}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>

      {archived.length > 0 && (
        <section aria-labelledby="archived-heading" className="space-y-3">
          <h2 id="archived-heading" className="font-serif text-xl">
            Archived
          </h2>
          <p className="text-sm text-muted-foreground">
            Archived pen names are hidden from pickers. Their books keep their attribution.
          </p>
          <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
            {archived.map((identity) => (
              <li
                key={identity.id}
                className="flex flex-wrap items-center justify-between gap-3 p-4"
              >
                <div>
                  <p className="font-medium">{identity.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatCount(identity.seriesCount, "series", "series")} ·{" "}
                    {formatCount(identity.bookCount, "book")}
                  </p>
                </div>
                <PenNameMenu penName={identity} isActive={false} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
