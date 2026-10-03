import { PenLine } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/shell/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { availabilityLabel, navigation } from "@/config/navigation";
import { formatDateTime, formatWords } from "@/lib/format";
import { listRecentScenes } from "@/modules/manuscript";
import { getActivePenName } from "@/modules/pen-names";
import { getWorkspace } from "@/modules/workspaces";
import { getSessionUser, requireAuthorContext } from "@/server/context";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const ctx = await requireAuthorContext();
  const [user, workspace, active, recent] = await Promise.all([
    getSessionUser(),
    getWorkspace(ctx.workspaceId),
    getActivePenName(ctx),
    listRecentScenes(ctx, { penNameId: ctx.activePenNameId }),
  ]);
  const firstName = user?.name?.split(" ")[0];
  const upcoming = navigation
    .flatMap((g) => g.items)
    .filter((i) => i.availability.status === "planned");

  return (
    <div className="space-y-10">
      <PageHeader
        title={firstName ? `Welcome, ${firstName}` : "Welcome"}
        description={`${workspace.name} · ${active ? `Writing as ${active.name}` : "All identities"}`}
      />

      <section aria-labelledby="continue-heading" className="space-y-4">
        <h2 id="continue-heading" className="font-serif text-xl">
          Continue writing
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

      <section aria-labelledby="sections-heading" className="space-y-4">
        <h2 id="sections-heading" className="font-serif text-xl">
          Coming next
        </h2>
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {upcoming.map((item) => {
            const Icon = item.icon;
            return (
              <li key={item.href}>
                <Link href={item.href} className="block h-full">
                  <Card className="h-full transition-colors hover:border-primary/40">
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
                </Link>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
