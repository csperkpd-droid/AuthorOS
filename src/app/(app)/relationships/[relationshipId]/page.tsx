import { Heart, NotebookPen, Settings2, Trash2, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FieldHistoryDialog } from "@/modules/history/ui";
import { listConnections } from "@/modules/connections";
import { ConnectionsPanel } from "@/modules/connections/ui";
import { NewNoteDialog } from "@/modules/notes/ui";
import { getRelationship, groupDynamics, groupsIncluding } from "@/modules/relationships";
import { listCharacters } from "@/modules/characters";
import {
  GroupDynamics,
  MembersDialog,
  RelationshipDialog,
  trashRelationshipAction,
} from "@/modules/relationships/ui";
import { listOutlines, newStructureOptions } from "@/modules/structure";
import { NewStructureDialog, OutlineList } from "@/modules/structure/ui";
import { requireAuthorContext } from "@/server/context";
import { orNotFound } from "@/server/not-found";

type Props = PageProps<"/relationships/[relationshipId]">;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const ctx = await requireAuthorContext();
  const r = await orNotFound(getRelationship(ctx, (await params).relationshipId));
  return { title: r.title };
}

export default async function RelationshipPage({ params }: Props) {
  const { relationshipId } = await params;
  const ctx = await requireAuthorContext();
  const r = await orNotFound(getRelationship(ctx, relationshipId));
  const [connections, arcs, structureOptions, dynamics, groups, sameIdentity] = await Promise.all([
    listConnections(ctx, relationshipId),
    listOutlines(ctx, { relationshipId }),
    newStructureOptions(ctx, { penNameId: r.penNameId }),
    groupDynamics(ctx, relationshipId),
    groupsIncluding(ctx, relationshipId),
    listCharacters(ctx, { penNameId: r.penNameId }),
  ]);
  const title = r.title;

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
            <FieldHistoryDialog nodeId={r.id} />
            <RelationshipDialog
              characters={[]}
              relationship={{
                id: r.id,
                type: r.type,
                description: r.description,
                title,
                updatedAt: r.updatedAt,
              }}
              trigger={
                <Button variant="outline">
                  <Settings2 />
                  Details
                </Button>
              }
            />
            <MembersDialog
              relationshipId={r.id}
              members={r.members.map((m) => ({ id: m.id, role: m.role }))}
              characters={sameIdentity.map((c) => ({ id: c.id, name: c.name }))}
              trigger={
                <Button variant="outline">
                  <Users />
                  Members
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
        {r.members.length > 2 && (
          <Badge className="bg-primary/10 text-primary">Group of {r.members.length}</Badge>
        )}
        {r.members.map((c) => (
          <span key={c.id} className="text-sm">
            <Link href={`/characters/${c.id}`} className="text-primary hover:underline">
              {c.name}
            </Link>
            {c.role && <span className="text-muted-foreground"> ({c.role})</span>}
          </span>
        ))}
      </div>
      {r.description && <p className="max-w-prose whitespace-pre-line">{r.description}</p>}
      {groups.length > 0 && (
        <p className="text-sm text-muted-foreground">
          Part of{" "}
          {groups.map((g, i) => (
            <span key={g.id}>
              {i > 0 && ", "}
              <Link href={`/relationships/${g.id}`} className="text-primary hover:underline">
                {g.title}
              </Link>
            </span>
          ))}
          .
        </p>
      )}

      {dynamics.length > 0 && (
        <section aria-labelledby="dynamics-heading" className="space-y-3">
          <h2 id="dynamics-heading" className="font-serif text-xl">
            Within the group
          </h2>
          <p className="text-sm text-muted-foreground">
            Each pair can be a relationship of its own, developing differently, with its own scenes,
            notes and arc.
          </p>
          <GroupDynamics
            groupType={r.type}
            dynamics={dynamics.map((d) => ({
              members: d.members.map((m) => ({ id: m.id, name: m.name })),
              relationship: d.relationship
                ? { id: d.relationship.id, type: d.relationship.type }
                : null,
            }))}
          />
        </section>
      )}

      <section aria-labelledby="romance-heading" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="romance-heading" className="font-serif text-xl">
            Romance arcs
          </h2>
          {structureOptions.books.length > 0 && (
            <NewStructureDialog
              {...structureOptions}
              relationships={[{ id: r.id, label: title }]}
              defaults={{ kind: "ROMANCE", relationshipId: r.id }}
              trigger={
                <Button variant="outline" size="sm">
                  <Heart />
                  New romance arc
                </Button>
              }
            />
          )}
        </div>
        {arcs.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Plan this romance beat by beat (for example with Romancing the Beat) and place each beat
            in your scenes.
          </p>
        ) : (
          <OutlineList outlines={arcs} showWork />
        )}
      </section>

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
