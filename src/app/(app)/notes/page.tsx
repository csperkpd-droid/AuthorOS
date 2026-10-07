import { NotebookPen, StickyNote } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/format";
import { listNotes } from "@/modules/notes";
import { NewNoteDialog } from "@/modules/notes/ui";
import { requireAuthorContext } from "@/server/context";

export const metadata: Metadata = { title: "Notes" };

export default async function NotesPage() {
  const ctx = await requireAuthorContext();
  const notes = await listNotes(ctx);

  return (
    <div className="space-y-8">
      <PageHeader
        title="Notes"
        description="Research and notes, connected to anything in your story."
        actions={
          <NewNoteDialog
            trigger={
              <Button>
                <NotebookPen />
                New note
              </Button>
            }
          />
        }
      />
      {notes.length === 0 ? (
        <div className="flex flex-col items-center rounded-xl border border-dashed border-border px-6 py-16 text-center">
          <StickyNote className="size-10 text-muted-foreground" aria-hidden />
          <p className="mt-4 font-display text-2xl font-semibold">No notes yet</p>
          <p className="mt-2 max-w-md text-sm text-muted-foreground">
            Notes can be about a book, scene, character, relationship or anything else.
          </p>
        </div>
      ) : (
        <ul
          aria-label="Notes"
          className="divide-y divide-border rounded-xl border border-border bg-surface"
        >
          {notes.map((n) => (
            <li key={n.id}>
              <Link href={`/notes/${n.id}`} className="block p-4 hover:bg-surface-hover">
                <p className="font-medium">{n.title}</p>
                {n.bodyText && (
                  <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{n.bodyText}</p>
                )}
                <p className="mt-1 text-xs text-muted-foreground">
                  Edited {formatDateTime(n.updatedAt)}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
