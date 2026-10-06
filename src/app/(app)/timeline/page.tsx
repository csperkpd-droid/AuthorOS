import { ChartGantt } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { listTimelines } from "@/modules/timeline";
import { requireAuthorContext } from "@/server/context";

export const metadata: Metadata = { title: "Timeline" };

export default async function TimelinesPage() {
  const ctx = await requireAuthorContext();
  const timelines = await listTimelines(ctx, { penNameId: ctx.activePenNameId });
  return (
    <div className="space-y-6">
      <PageHeader
        title="Timeline"
        description="When things happen in your story: scenes and events in story order, apart from reading order and from real-world dates. One timeline per series, and per standalone book."
      />
      {timelines.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Create a book first; its timeline appears here.
        </p>
      ) : (
        <ul
          aria-label="Timelines"
          className="divide-y divide-border rounded-xl border border-border bg-surface"
        >
          {timelines.map((t) => (
            <li key={t.id}>
              <Link href={t.href} className="flex items-center gap-3 p-4 hover:bg-muted/50">
                <ChartGantt className="size-4 text-muted-foreground" aria-hidden />
                <span className="font-medium">{t.title}</span>
                <Badge>{t.kind === "SERIES" ? "Series" : "Book"}</Badge>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
