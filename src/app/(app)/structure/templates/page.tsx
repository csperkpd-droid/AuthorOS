import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/shell/page-header";
import { Boxes } from "lucide-react";

import { Button } from "@/components/ui/button";
import { listKits, listTemplates } from "@/modules/structure";
import { KitDialog, KitList, TemplateList } from "@/modules/structure/ui";
import { requireAuthorContext } from "@/server/context";

export const metadata: Metadata = { title: "Structure templates" };

export default async function TemplatesPage() {
  const ctx = await requireAuthorContext();
  const [templates, kits] = await Promise.all([listTemplates(ctx), listKits(ctx)]);
  const yours = templates.filter((t) => !t.builtIn);
  const builtIn = templates.filter((t) => t.builtIn);

  return (
    <div className="space-y-8">
      <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground">
        <Link href="/structure" className="hover:text-foreground">
          Story structure
        </Link>
      </nav>
      <PageHeader
        title="Templates"
        description="Applying a template creates a new structure with its own beats; editing either never changes the other."
      />
      <section aria-labelledby="kits-heading" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="kits-heading" className="text-lg font-semibold">
            Template kits
          </h2>
          <KitDialog
            templates={templates}
            trigger={
              <Button variant="outline" size="sm">
                <Boxes />
                New kit
              </Button>
            }
          />
        </div>
        {kits.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            A kit applies several templates at once, such as a main plot, a romance arc and a
            character arc. Create one here, or use “Save as kit” on a book.
          </p>
        ) : (
          <KitList kits={kits} templates={templates} />
        )}
      </section>
      <section aria-labelledby="yours-heading" className="space-y-3">
        <h2 id="yours-heading" className="text-lg font-semibold">
          Your templates
        </h2>
        {yours.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Open any structure and choose “Save as template” to reuse it.
          </p>
        ) : (
          <TemplateList templates={yours} />
        )}
      </section>
      <section aria-labelledby="builtin-heading" className="space-y-3">
        <h2 id="builtin-heading" className="text-lg font-semibold">
          Built in
        </h2>
        <TemplateList templates={builtIn} />
      </section>
    </div>
  );
}
