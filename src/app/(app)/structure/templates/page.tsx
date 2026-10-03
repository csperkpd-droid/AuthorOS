import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/shell/page-header";
import { listTemplates } from "@/modules/structure";
import { TemplateList } from "@/modules/structure/ui";
import { requireAuthorContext } from "@/server/context";

export const metadata: Metadata = { title: "Structure templates" };

export default async function TemplatesPage() {
  const ctx = await requireAuthorContext();
  const templates = await listTemplates(ctx);
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
      <section aria-labelledby="yours-heading" className="space-y-3">
        <h2 id="yours-heading" className="font-serif text-xl">
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
        <h2 id="builtin-heading" className="font-serif text-xl">
          Built in
        </h2>
        <TemplateList templates={builtIn} />
      </section>
    </div>
  );
}
