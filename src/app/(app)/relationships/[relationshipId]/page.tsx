import { NotebookPen, Settings2, Trash2 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { listConnections } from "@/modules/connections";
import { ConnectionsPanel } from "@/modules/connections/ui";
import { NewNoteDialog } from "@/modules/notes/ui";
import { getRelationship } from "@/modules/relationships";
import { RelationshipDialog, trashRelationshipAction } from "@/modules/relationships/ui";
import { requireAuthorContext } from "@/server/context";
import { orNotFound } from "@/server/not-found";

type Props = PageProps<"/relationships/[relationshipId]">;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const ctx = await requireAuthorContext();
  const r = await orNotFound(getRelationship(ctx, (await params).relationshipId));
  return { title: `${r.characterA.name} & ${r.characterB.name}` };
}

export default async function RelationshipPage({ params }: Props) {
  const { relationshipId } = await params;
  const ctx = await requireAuthorContext();
  const [r, connections] = await Promise.all([
    orNotFound(getRelationship(ctx, relationshipId)),
    listConnections(ctx, relationshipId),
  ]);
  const title = `${r.characterA.name} & ${r.characterB.name}`;

  return (
    <div className="space-y-10">
      <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground">
        <Link href="/relationships" className="hover:text-foreground">
          Relationships
        </Link>
      </nav>
      <PageHeader
        title={title}
        actions={
          <div className="flex flex-wrap gap-2">
            <RelationshipDialog
              characters={[]}
              relationship={{ id: r.id, type: r.type, description: r.description, title }}
              trigger={
                <Button variant="outline">
                  <Settings2 />
                  Details
                </Button>
              }
            />
            <ConfirmDialog
              trigger={
                <Button variant="ghost" aria-label="Move relationship to Trash">
                  <Trash2 />
                </Button>
              }
              title={`Move “${title}” to the Trash?`}
              description="The characters stay. You can restore the relationship from the Trash."
              confirmLabel="Move to Trash"
              destructive
              onConfirm={trashRelationshipAction.bind(null, r.id)}
              navigateTo="/relationships"
            />
          </div>
        }
      />
      <div className="flex flex-wrap items-center gap-3">
        <Badge>{r.type}</Badge>
        {[r.characterA, r.characterB].map((c) => (
          <Link
            key={c.id}
            href={`/characters/${c.id}`}
            className="text-sm text-primary hover:underline"
          >
            {c.name}
          </Link>
        ))}
      </div>
      {r.description && <p className="max-w-prose whitespace-pre-line">{r.description}</p>}

      <ConnectionsPanel
        nodeId={r.id}
        nodeKind="RELATIONSHIP"
        connections={connections}
        heading="Scenes, notes & links"
        emptyText="Connect the scenes where this relationship changes, and notes about it."
        actions={
          <NewNoteDialog
            about={{ id: r.id, title }}
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
