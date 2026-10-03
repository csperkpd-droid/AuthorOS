import { LayoutTemplate, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/shell/page-header";
import { Button, buttonVariants } from "@/components/ui/button";
import { listOutlines, newStructureOptions } from "@/modules/structure";
import { NewStructureDialog, OutlineList } from "@/modules/structure/ui";
import { requireAuthorContext } from "@/server/context";

export const metadata: Metadata = { title: "Story structure" };

export default async function StructurePage() {
  const ctx = await requireAuthorContext();
  const penNameId = ctx.activePenNameId;
  const [outlines, options] = await Promise.all([
    listOutlines(ctx, { penNameId }),
    newStructureOptions(ctx, { penNameId }),
  ]);

  return (
    <div className="space-y-8">
      <PageHeader
        title="Story structure"
        description="Plot, romance and character arcs, beat by beat, placed in your real scenes."
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/structure/templates" className={buttonVariants({ variant: "outline" })}>
              <LayoutTemplate />
              Templates
            </Link>
            {options.books.length > 0 && (
              <NewStructureDialog
                {...options}
                trigger={
                  <Button>
                    <Plus />
                    New structure
                  </Button>
                }
              />
            )}
          </div>
        }
      />
      {outlines.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-6 py-12 text-center text-sm text-muted-foreground">
          {options.books.length > 0
            ? "No structures yet. Apply a beat sheet such as Save the Cat or Romancing the Beat to a book."
            : "Create a book first, then give it a structure."}
        </p>
      ) : (
        <OutlineList outlines={outlines} showWork />
      )}
    </div>
  );
}
