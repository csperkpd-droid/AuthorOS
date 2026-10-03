import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { docSchema, docToText, type Doc } from "@/lib/text";
import { createPlannedConnection, planConnection } from "@/modules/connections";
import { createStoryNode, liveNote } from "@/modules/story-graph";
import type { AuthorContext } from "@/server/context";

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
  const parsed = noteTitle.parse(title);
  await getNote(ctx, id);
  await db.note.update({ where: { id }, data: { title: parsed } });
}

/** Saves a note's body; refuses stale versions like scene saves do. */
export async function saveNoteBody(
  ctx: AuthorContext,
  { noteId, content, baseVersion }: { noteId: string; content: unknown; baseVersion: number },
) {
  await getNote(ctx, noteId);
  const doc = docSchema.parse(content);
  return db.$transaction(async (tx) => {
    const [current] = await tx.$queryRaw<{ version: number }[]>`
      SELECT "version" FROM "notes" WHERE "id" = ${noteId}::uuid FOR UPDATE`;
    if (!current) throw new NotFoundError("Note");
    if (current.version !== baseVersion) {
      throw new ConflictError(
        "This note was changed somewhere else. Reload to see the latest version.",
      );
    }
    const updated = await tx.note.update({
      where: { id: noteId },
      data: {
        body: doc as Prisma.InputJsonValue,
        bodyText: docToText(doc),
        version: { increment: 1 },
      },
      select: { version: true, updatedAt: true },
    });
    return { version: updated.version, wordCount: 0, savedAt: updated.updatedAt };
  });
}

export async function trashNote(ctx: AuthorContext, id: string) {
  await getNote(ctx, id);
  await db.note.update({ where: { id }, data: { deletedAt: new Date() } });
}
