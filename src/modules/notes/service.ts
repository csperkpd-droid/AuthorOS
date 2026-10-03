import "server-only";

import { db } from "@/lib/db";
import { NotFoundError } from "@/lib/errors";
import type { Doc } from "@/lib/text";
import { createPlannedConnection, planConnection } from "@/modules/connections";
import { saveContent } from "@/modules/history";
import { createStoryNode, liveNote } from "@/modules/story-graph";
import type { AuthorContext } from "@/server/context";
import { assertCan } from "@/server/policy";

import { noteTitle } from "./schemas";

/** Notes, newest first, optionally only those about a given story object. */
export async function listNotes(ctx: AuthorContext, { aboutId }: { aboutId?: string } = {}) {
  return db.note.findMany({
    where: {
      workspaceId: ctx.workspaceId,
      ...liveNote,
      ...(aboutId ? { node: { outgoing: { some: { kind: "about", targetId: aboutId } } } } : {}),
    },
    orderBy: { updatedAt: "desc" },
    select: { id: true, title: true, bodyText: true, updatedAt: true },
  });
}

export async function getNote(ctx: AuthorContext, id: string) {
  const note = await db.note.findFirst({
    where: { id, workspaceId: ctx.workspaceId, ...liveNote },
    select: { id: true, title: true, body: true, version: true, updatedAt: true },
  });
  if (!note) throw new NotFoundError("Note");
  return { ...note, body: (note.body as Doc | null) ?? null };
}

/**
 * Creates a note, optionally already "about" a story object. The note and its
 * connection are created together or not at all.
 */
export async function createNote(
  ctx: AuthorContext,
  { title, aboutId }: { title: string; aboutId?: string },
) {
  assertCan(ctx, "edit", "storyBible");
  const parsedTitle = noteTitle.parse(title);
  return db.$transaction(async (tx) => {
    const id = await createStoryNode(tx, ctx.workspaceId, "NOTE");
    // Validate before writing the note; the note itself is pending in this transaction.
    const plan = aboutId
      ? await planConnection(
          ctx,
          { sourceId: id, targetId: aboutId, kind: "about" },
          { id, kind: "NOTE" },
        )
      : null;
    await tx.note.create({ data: { id, workspaceId: ctx.workspaceId, title: parsedTitle } });
    if (plan) await createPlannedConnection(tx, ctx, plan);
    return { id };
  });
}

export async function renameNote(ctx: AuthorContext, id: string, title: string) {
  assertCan(ctx, "edit", "storyBible");
  const parsed = noteTitle.parse(title);
  await getNote(ctx, id);
  await db.note.update({ where: { id }, data: { title: parsed } });
}

/** Saves a note's body through the shared history layer (versioned, checkpointed). */
export async function saveNoteBody(
  ctx: AuthorContext,
  { noteId, content, baseVersion }: { noteId: string; content: unknown; baseVersion: number },
) {
  assertCan(ctx, "edit", "storyBible");
  await getNote(ctx, noteId);
  return saveContent(ctx, { nodeId: noteId, content, baseVersion });
}

export async function trashNote(ctx: AuthorContext, id: string) {
  assertCan(ctx, "edit", "storyBible");
  await getNote(ctx, id);
  await db.note.update({ where: { id }, data: { deletedAt: new Date() } });
}
