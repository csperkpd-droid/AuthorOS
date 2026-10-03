import type { Metadata } from "next";
import Link from "next/link";

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
            {penNames.length === 1 ? "1 pen name" : `${penNames.length} pen names`}. Default:{" "}
            {penNames.find((p) => p.isDefault)?.name}.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link
            href="/identities"
            className="text-sm text-primary underline-offset-4 hover:underline"
          >
            Manage pen names
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
