"use server";

import { runAction } from "@/server/action";
import { requireAuthorContext } from "@/server/context";

import { createNote, renameNote, saveNoteBody, trashNote } from "./service";

/** Creates a note (optionally about a story object); the client opens it. */
export async function createNoteAction(title: string, aboutId?: string) {
  return runAction(async () => createNote(await requireAuthorContext(), { title, aboutId }), {
    refresh: false,
  });
}

export async function renameNoteAction(id: string, title: string) {
  return runAction(async () => renameNote(await requireAuthorContext(), id, title));
}

/** Autosave. No refresh, so the editor isn't re-rendered under the author. */
export async function saveNoteBodyAction(noteId: string, content: unknown, baseVersion: number) {
  return runAction(
    async () => saveNoteBody(await requireAuthorContext(), { noteId, content, baseVersion }),
    { refresh: false },
  );
}

export async function trashNoteAction(id: string) {
  return runAction(async () => trashNote(await requireAuthorContext(), id), { refresh: false });
}
