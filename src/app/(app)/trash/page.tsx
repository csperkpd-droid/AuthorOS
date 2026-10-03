import type { Metadata } from "next";

import { PageHeader } from "@/components/shell/page-header";
import { listTrash } from "@/modules/trash";
import { TrashList } from "@/modules/trash/ui";
import { requireAuthorContext } from "@/server/context";

export const metadata: Metadata = { title: "Trash" };

export default async function TrashPage() {
  const ctx = await requireAuthorContext();
  const items = await listTrash(ctx);
  return (
    <div className="space-y-8">
      <PageHeader title="Trash" description="Restore deleted work, or delete it forever." />
      <TrashList items={items} />
    </div>
  );
}
