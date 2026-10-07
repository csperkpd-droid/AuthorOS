import { NotebookPen, Trash2 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { listConnections } from "@/modules/connections";
import { ConnectionsPanel } from "@/modules/connections/ui";
import { FieldHistoryDialog } from "@/modules/history/ui";
import { NewNoteDialog } from "@/modules/notes/ui";
import { NODE_KIND_LABELS } from "@/modules/story-graph";
import { getTrope } from "@/modules/tropes";
import { TropeForm, trashTropeAction } from "@/modules/tropes/ui";
import { requireAuthorContext } from "@/server/context";
import { orNotFound } from "@/server/not-found";
import { can } from "@/server/policy";

type Props = PageProps<"/tropes/[tropeId]">;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const ctx = await requireAuthorContext();
  const trope = await orNotFound(getTrope(ctx, (await params).tropeId));
  return { title: trope.name };
}

export default async function TropePage({ params }: Props) {
  const { tropeId } = await params;
  const ctx = await requireAuthorContext();
  const trope = await orNotFound(getTrope(ctx, tropeId));
  const connections = await listConnections(ctx, tropeId);
  const canEdit = can(ctx, "edit", "storyBible");

  return (
    <div className="space-y-8">
      <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground">
        <Link href="/tropes" className="hover:text-foreground">
          Tropes
        </Link>
      </nav>
      <PageHeader
        title={trope.name}
        actions={
          <div className="flex flex-wrap gap-2">
            <FieldHistoryDialog nodeId={trope.id} />
            {canEdit && (
              <ConfirmDialog
                trigger={
                  <Button variant="ghost" aria-label="Move trope to Trash">
                    <Trash2 />
                  </Button>
                }
                title={`Move “${trope.name}” to the Trash?`}
                description="It disappears from everything that uses it. Restore it from the Trash to bring it and its links back."
                confirmLabel="Move to Trash"
                destructive
                onConfirm={trashTropeAction.bind(null, trope.id)}
                navigateTo="/tropes"
              />
            )}
          </div>
        }
      />
      <TropeForm
        canEdit={canEdit}
        trope={{
          id: trope.id,
          name: trope.name,
          description: trope.description,
          updatedAt: trope.updatedAt.toISOString(),
        }}
      />
      <section aria-labelledby="used-in" className="space-y-3">
        <h2 id="used-in" className="text-lg font-semibold">
          Used in
        </h2>
        {trope.usedIn.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Not used yet. Add it from a book or series page, or connect it to a relationship or
            structure.
          </p>
        ) : (
          <ul
            aria-label={`Used in`}
            className="divide-y divide-border rounded-lg border border-border bg-surface"
          >
            {trope.usedIn.map((n) => (
              <li key={n.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                <Badge>{NODE_KIND_LABELS[n.kind].one}</Badge>
                <Link href={n.href} className="font-medium hover:underline">
                  {n.title}
                </Link>
                {n.context && <span className="text-xs text-muted-foreground">{n.context}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>
      <ConnectionsPanel
        nodeId={trope.id}
        nodeKind="TROPE"
        connections={connections}
        heading="Notes & links"
        hideKinds={["uses_trope"]}
        actions={
          <NewNoteDialog
            about={{ id: trope.id, title: trope.name }}
            trigger={
              <Button variant="outline" size="sm">
                <NotebookPen />
                New note
              </Button>
            }
          />
        }
      />
    </div>
  );
}
