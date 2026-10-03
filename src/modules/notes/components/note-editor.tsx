"use client";

import { useCallback, useState } from "react";

import { RichTextEditor } from "@/components/editor/rich-text-editor";
import { FormError } from "@/components/ui/field";
import { useAction } from "@/hooks/use-action";
import type { Doc } from "@/lib/text";

import { renameNoteAction, saveNoteBodyAction } from "../actions";

/** A note's title and body; both save automatically. */
export function NoteEditor({
  noteId,
  title,
  body,
  version,
}: {
  noteId: string;
  title: string;
  body: Doc | null;
  version: number;
}) {
  const [value, setValue] = useState(title);
  const rename = useAction(renameNoteAction);
  const save = useCallback(
    (doc: Doc, baseVersion: number) => saveNoteBodyAction(noteId, doc, baseVersion),
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
        className="w-full rounded-md bg-transparent px-1 font-serif text-3xl tracking-tight focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      />
      <FormError message={rename.error} />
      <RichTextEditor
        content={body}
        version={version}
        onSave={save}
        label="Note text"
        placeholder="Write your note…"
        thing="note"
      />
    </div>
  );
}
