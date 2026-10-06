import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/shell/page-header";
import { formatCount } from "@/lib/format";
import { listTropes } from "@/modules/tropes";
import { NewTropeDialog } from "@/modules/tropes/ui";
import { requireAuthorContext } from "@/server/context";
import { can } from "@/server/policy";

export const metadata: Metadata = { title: "Tropes" };

export default async function TropesPage() {
  const ctx = await requireAuthorContext();
  const tropes = await listTropes(ctx);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Tropes"
        description="Your tropes, shared by all your pen names. Add them to books and series from their pages, and to relationships and structures with Connect."
        actions={can(ctx, "edit", "storyBible") ? <NewTropeDialog /> : undefined}
      />
      {tropes.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No tropes yet. Create one here, or add one from a book or series page.
        </p>
      ) : (
        <ul
          aria-label="Tropes"
          className="divide-y divide-border rounded-xl border border-border bg-surface"
        >
          {tropes.map((t) => (
            <li key={t.id}>
              <Link
                href={`/tropes/${t.id}`}
                className="flex flex-wrap items-baseline justify-between gap-2 p-4 hover:bg-muted/50"
              >
                <span className="font-medium">{t.name}</span>
                <span className="text-xs text-muted-foreground">
                  {t.uses ? `Used ${formatCount(t.uses, "time")}` : "Not used yet"}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
