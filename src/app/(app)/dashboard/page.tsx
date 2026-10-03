import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/shell/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { availabilityLabel, navigation } from "@/config/navigation";
import { getWorkspace } from "@/modules/workspaces";
import { getSessionUser, requireAuthorContext } from "@/server/context";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const ctx = await requireAuthorContext();
  const [user, workspace] = await Promise.all([getSessionUser(), getWorkspace(ctx.workspaceId)]);
  const firstName = user?.name?.split(" ")[0];

  const upcoming = navigation
    .flatMap((g) => g.items)
    .filter((i) => i.availability.status === "planned");

  return (
    <div className="space-y-8">
      <PageHeader
        title={firstName ? `Welcome, ${firstName}` : "Welcome"}
        description={workspace.name}
      />
      <section aria-labelledby="sections-heading" className="space-y-4">
        <h2 id="sections-heading" className="font-serif text-xl">
          Your workspace
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
