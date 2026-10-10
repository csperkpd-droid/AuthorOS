import { Trash2 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { listComments } from "@/modules/comments";
import { listConnections } from "@/modules/connections";
import { ConnectionsPanel } from "@/modules/connections/ui";
import { RevisionsDialog } from "@/modules/history/ui";
import { getNote } from "@/modules/notes";
import { NoteEditor, trashNoteAction } from "@/modules/notes/ui";
import { draftOwner } from "@/lib/local-drafts";
import { requireAuthorContext } from "@/server/context";
import { orNotFound } from "@/server/not-found";
import { can } from "@/server/policy";

type Props = PageProps<"/notes/[noteId]">;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const ctx = await requireAuthorContext();
  const note = await orNotFound(getNote(ctx, (await params).noteId));
  return { title: note.title };
}

export default async function NotePage({ params }: Props) {
  const { noteId } = await params;
  const ctx = await requireAuthorContext();
  const [note, connections, comments] = await Promise.all([
    orNotFound(getNote(ctx, noteId)),
    listConnections(ctx, noteId),
    orNotFound(listComments(ctx, noteId)),
  ]);

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
        <nav aria-label="Breadcrumb">
          <Link href="/notes" className="hover:text-foreground">
            Notes
          </Link>
        </nav>
        <div className="flex gap-2">
          <RevisionsDialog nodeId={note.id} noun="note" />
          <ConfirmDialog
            trigger={
              <Button variant="ghost" size="sm" aria-label="Move note to Trash">
                <Trash2 />
              </Button>
            }
            title={`Move “${note.title}” to the Trash?`}
            description="You can restore it, with its connections, from the Trash."
            confirmLabel="Move to Trash"
            destructive
            onConfirm={trashNoteAction.bind(null, note.id)}
            navigateTo="/notes"
          />
        </div>
      </div>
      <ConnectionsPanel
        nodeId={note.id}
        nodeKind="NOTE"
        connections={connections}
        heading="About"
        emptyText="Connect this note to the books, scenes, characters or anything else it’s about."
      />
      <NoteEditor
        key={note.id}
        noteId={note.id}
        title={note.title}
        body={note.body}
        version={note.version}
        draftOwner={draftOwner(ctx)}
        comments={comments}
        canComment={can(ctx, "comment", "storyBible")}
      />
    </div>
  );
}
