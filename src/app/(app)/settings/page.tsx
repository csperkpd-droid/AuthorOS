import type { Metadata } from "next";

import { PageHeader } from "@/components/shell/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { listPenNames } from "@/modules/pen-names";
import { getWorkspace } from "@/modules/workspaces";
import { getSessionUser, requireAuthorContext } from "@/server/context";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const ctx = await requireAuthorContext();
  const [user, workspace, penNames] = await Promise.all([
    getSessionUser(),
    getWorkspace(ctx.workspaceId),
    listPenNames(ctx),
  ]);

  return (
    <div className="space-y-8">
      <PageHeader title="Settings" />

      <Card>
        <CardHeader>
          <CardTitle>Account</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-3 text-sm sm:grid-cols-[10rem_1fr]">
            <dt className="text-muted-foreground">Email</dt>
            <dd>{user?.email}</dd>
            <dt className="text-muted-foreground">Name</dt>
            <dd>{user?.name ?? "—"}</dd>
            <dt className="text-muted-foreground">Workspace</dt>
            <dd>{workspace.name}</dd>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Pen names</CardTitle>
          <CardDescription>
            The names you publish under. Books and series will be assigned a pen name.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="divide-y divide-border">
            {penNames.map((p) => (
              <li key={p.id} className="flex items-center justify-between py-2 text-sm">
                <span>{p.name}</span>
                {p.isDefault && (
                  <span className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                    Default
                  </span>
                )}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
