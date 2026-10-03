import type { Metadata } from "next";

import { PageHeader } from "@/components/shell/page-header";
import { ImportWizard } from "@/modules/imports/ui";
import { requireAuthorContext } from "@/server/context";

export const metadata: Metadata = { title: "Import" };

export default async function ImportPage() {
  await requireAuthorContext();
  return (
    <div className="space-y-8">
      <PageHeader
        title="Import"
        description="Restore a backup or bring in a workspace from another account. You’ll see exactly what will happen before anything changes."
      />
      <ImportWizard />
    </div>
  );
}
