import { NotebookPen, Trash2 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { listConnections } from "@/modules/connections";
import { ConnectionsPanel } from "@/modules/connections/ui";
import { NewNoteDialog } from "@/modules/notes/ui";
import { getOutline, STRUCTURE_KIND_LABELS } from "@/modules/structure";
import {
  ArcRoleSelect,
  BeatBoard,
  OutlineTitle,
  SaveTemplateDialog,
  trashOutlineAction,
} from "@/modules/structure/ui";
import { requireAuthorContext } from "@/server/context";
import { orNotFound } from "@/server/not-found";

type Props = PageProps<"/structure/[outlineId]">;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const ctx = await requireAuthorContext();
  const outline = await orNotFound(getOutline(ctx, (await params).outlineId));
  return { title: outline.title };
}

export default async function OutlinePage({ params }: Props) {
  const { outlineId } = await params;
  const ctx = await requireAuthorContext();
  const [outline, connections] = await Promise.all([
    orNotFound(getOutline(ctx, outlineId)),
    listConnections(ctx, outlineId),
  ]);
  const placed = outline.beats.filter((b) => b.scenes.length > 0).length;

  return (
    <div className="space-y-8">
      <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground">
        <Link href="/structure" className="hover:text-foreground">
          Story structure
        </Link>
      </nav>
      <div className="space-y-3 border-b border-border pb-6">
        <div className="flex flex-wrap items-start gap-2">
          <div className="min-w-0 flex-1 basis-64">
            <OutlineTitle id={outline.id} title={outline.title} />
          </div>
          <SaveTemplateDialog
            outlineId={outline.id}
            defaultName={outline.title}
            forSeries={outline.series !== null}
          />
          <ConfirmDialog
            trigger={
              <Button variant="ghost" aria-label="Move structure to Trash">
                <Trash2 />
              </Button>
            }
            title={`Move “${outline.title}” to the Trash?`}
            description="Its beats and scene placements come back if you restore it. Your scenes are not affected."
            confirmLabel="Move to Trash"
            destructive
            onConfirm={trashOutlineAction.bind(null, outline.id)}
            navigateTo="/structure"
          />
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
          <Badge>{STRUCTURE_KIND_LABELS[outline.kind].one}</Badge>
          {outline.book && (
            <Link href={`/books/${outline.book.id}`} className="text-primary hover:underline">
              {outline.book.title}
            </Link>
          )}
          {outline.series && (
            <Link
              href={`/library/series/${outline.series.id}`}
              className="text-primary hover:underline"
            >
              Whole series: {outline.series.title}
            </Link>
          )}
          {outline.kind === "ROMANCE" && outline.arcRole && (
            <ArcRoleSelect outlineId={outline.id} value={outline.arcRole} />
          )}
          {outline.relationship && (
            <Link
              href={`/relationships/${outline.relationship.id}`}
              className="text-primary hover:underline"
            >
              {outline.relationship.title}
            </Link>
          )}
          {outline.character && (
            <Link
              href={`/characters/${outline.character.id}`}
              className="text-primary hover:underline"
            >
              {outline.character.name}
            </Link>
          )}
          {outline.template && (
            <span>
              From {outline.template.name}
              {outline.template.source && ` (${outline.template.source})`}
            </span>
          )}
          <span>
            {placed} of {outline.beats.length} beats placed
          </span>
        </div>
      </div>

      <BeatBoard
        outlineId={outline.id}
        books={outline.books}
        beats={outline.beats}
        bookScenes={outline.bookScenes}
      />

      <ConnectionsPanel
        nodeId={outline.id}
        nodeKind="OUTLINE"
        connections={connections}
        heading="Notes & links"
        emptyText="Notes about this structure, and links to anything related."
        actions={
          <NewNoteDialog
            about={{ id: outline.id, title: outline.title }}
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
