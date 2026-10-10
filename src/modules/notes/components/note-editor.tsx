"use client";

import { useCallback, useState, type ComponentProps } from "react";

import { RichTextEditor } from "@/components/editor/rich-text-editor";
import { FormError } from "@/components/ui/field";
import { useAction } from "@/hooks/use-action";
import type { Doc } from "@/lib/text";
import { DocumentComments } from "@/modules/comments/ui";
import { keepDeviceDraftAction } from "@/modules/history/ui";

import { renameNoteAction, saveNoteBodyAction } from "../actions";

/** A note's title and body; both save automatically. */
export function NoteEditor({
  noteId,
  title,
  body,
  version,
  draftOwner,
  comments,
  canComment,
}: {
  noteId: string;
  title: string;
  body: Doc | null;
  version: number;
  /** The signed-in member unsynced text on this device belongs to (`draftOwner(ctx)`). */
  draftOwner: string;
  /** The note's comments (M16), kept beside the text. */
  comments: ComponentProps<typeof DocumentComments>["initial"];
  canComment: boolean;
}) {
  const [value, setValue] = useState(title);
  const rename = useAction(renameNoteAction);
  const save = useCallback(
    (doc: Doc, baseVersion: number) => saveNoteBodyAction(noteId, doc, baseVersion),
    [noteId],
  );
  const keep = useCallback(
    (doc: Doc, writtenAt: string) => keepDeviceDraftAction(noteId, doc, writtenAt),
    [noteId],
  );

  return (
    <div className="space-y-3">
      <input
        aria-label="Note title"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => {
          const next = value.trim();
          if (next && next !== title) void rename.run(noteId, next);
          else setValue(title);
        }}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        className="w-full rounded-md bg-transparent px-1 font-display text-3xl font-semibold tracking-tight focus-visible:focus-ring"
      />
      <FormError message={rename.error} />
      <RichTextEditor
        content={body}
        version={version}
        onSave={save}
        onKeepDraft={keep}
        workPlace={{
          owner: draftOwner,
          entry: { kind: "note", id: noteId, href: `/notes/${noteId}` },
        }}
        draft={{
          owner: draftOwner,
          item: `note:${noteId}`,
          label: value || title,
          href: `/notes/${noteId}`,
        }}
        label="Note text"
        placeholder="Write your note…"
        thing="note"
        aside={(api) => (
          <DocumentComments
            nodeId={noteId}
            initial={comments}
            editor={api.editor}
            version={api.version}
            saved={api.saved}
            canComment={canComment}
            thing="note"
          />
        )}
      />
    </div>
  );
}
