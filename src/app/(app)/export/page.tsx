import type { Metadata } from "next";

import { PageHeader } from "@/components/shell/page-header";
import { booksInScope } from "@/modules/exports";
import { ExportWizard } from "@/modules/exports/ui";
import { listPenNames } from "@/modules/pen-names";
import { requireAuthorContext } from "@/server/context";

export const metadata: Metadata = { title: "Export" };

export default async function ExportPage() {
  const ctx = await requireAuthorContext();
  const [penNames, books] = await Promise.all([
    listPenNames(ctx, { includeArchived: true }),
    booksInScope(ctx, { penNameIds: null, label: "", slug: "" }),
  ]);
  return (
    <div className="space-y-8">
      <PageHeader
        title="Export"
        description="Manuscripts to read and share, or a full structured backup of your story data."
      />
      <ExportWizard
        penNames={penNames.map((p) => ({ id: p.id, name: p.name }))}
        activePenNameId={ctx.activePenNameId}
        books={books.map((b) => ({
          id: b.id,
          title: b.title,
          penNameId: b.penName.id,
          seriesTitle: b.seriesTitle,
        }))}
      />
    </div>
  );
}
