import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { countWords, docSchema, docToText, type Doc } from "@/lib/text";
import type { AuthorContext } from "@/server/context";

import { revisionLabel, sceneDetailsInput, type SceneDetailsInput } from "./schemas";
import { getBookTree, requireScene } from "./structure";

/** Autosaves keep at most one checkpoint per window, so history stays readable. */
export const CHECKPOINT_INTERVAL_MS = 10 * 60 * 1000;

export async function getSceneForEditor(ctx: AuthorContext, id: string) {
  const ref = await requireScene(ctx, id);
  const [scene, tree] = await Promise.all([
    db.scene.findUniqueOrThrow({
      where: { id },
      select: {
        id: true,
        bookId: true,
        title: true,
        status: true,
        synopsis: true,
        content: true,
        wordCount: true,
        version: true,
        updatedAt: true,
        chapter: { select: { id: true, title: true, part: { select: { id: true, title: true } } } },
      },
    }),
    getBookTree(ctx, ref.bookId),
  ]);
  const index = tree.sceneOrder.findIndex((s) => s.id === id);
  return {
    scene: { ...scene, content: (scene.content as Doc | null) ?? null },
    tree,
    previous: index > 0 ? tree.sceneOrder[index - 1] : null,
    next: index >= 0 && index + 1 < tree.sceneOrder.length ? tree.sceneOrder[index + 1] : null,
  };
}

export type SaveResult = { version: number; wordCount: number; savedAt: Date };

/**
 * Saves scene content. `baseVersion` is the version the editor loaded; if the
 * scene changed since (another tab or device), the save is refused rather
 * than silently overwriting the author's other edits.
 */
export async function saveSceneContent(
  ctx: AuthorContext,
  { sceneId, content, baseVersion }: { sceneId: string; content: unknown; baseVersion: number },
): Promise<SaveResult> {
  await requireScene(ctx, sceneId);
  const doc = docSchema.parse(content);
  const text = docToText(doc);
  const wordCount = countWords(text);

  return db.$transaction(async (tx) => {
    // Lock the row so concurrent saves are serialized and versions stay exact.
    const [current] = await tx.$queryRaw<{ version: number }[]>`
      SELECT "version" FROM "scenes" WHERE "id" = ${sceneId}::uuid FOR UPDATE`;
    if (!current) throw new NotFoundError("Scene");
    if (current.version !== baseVersion) {
      throw new ConflictError(
        "This scene was changed somewhere else. Reload to see the latest version.",
      );
    }

    await checkpointIfDue(tx, ctx, sceneId);
    const updated = await tx.scene.update({
      where: { id: sceneId },
      data: {
        content: doc as Prisma.InputJsonValue,
        contentText: text,
        wordCount,
        version: { increment: 1 },
      },
      select: { version: true, wordCount: true, updatedAt: true },
    });
    return { version: updated.version, wordCount: updated.wordCount, savedAt: updated.updatedAt };
  });
}

/**
 * Before overwriting content, keep a copy of the previous content if the last
 * checkpoint is older than the interval (or there is none). Empty content is
 * not worth a checkpoint.
 */
async function checkpointIfDue(tx: Prisma.TransactionClient, ctx: AuthorContext, sceneId: string) {
  const latest = await tx.sceneRevision.findFirst({
    where: { sceneId },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  if (latest && Date.now() - latest.createdAt.getTime() < CHECKPOINT_INTERVAL_MS) return;
  await snapshot(tx, ctx, sceneId, { source: "AUTOSAVE", skipEmpty: true });
}

async function snapshot(
  tx: Prisma.TransactionClient,
  ctx: AuthorContext,
  sceneId: string,
  {
    source,
    label = null,
    skipEmpty = false,
  }: {
    source: "AUTOSAVE" | "MANUAL" | "BEFORE_RESTORE";
    label?: string | null;
    skipEmpty?: boolean;
  },
) {
  const scene = await tx.scene.findUniqueOrThrow({
    where: { id: sceneId },
    select: { content: true, contentText: true, wordCount: true },
  });
  if (skipEmpty && scene.contentText.trim() === "") return null;
  return tx.sceneRevision.create({
    data: {
      workspaceId: ctx.workspaceId,
      sceneId,
      content: jsonOrDbNull(scene.content),
      contentText: scene.contentText,
      wordCount: scene.wordCount,
      source,
      label,
      createdById: ctx.userId,
    },
    select: { id: true },
  });
}

export async function updateSceneDetails(ctx: AuthorContext, id: string, input: SceneDetailsInput) {
  const data = sceneDetailsInput.parse(input);
  await requireScene(ctx, id);
  await db.scene.update({
    where: { id },
    data: {
      ...(data.title !== undefined && { title: data.title }),
      ...(data.status !== undefined && { status: data.status }),
      ...(data.synopsis !== undefined && { synopsis: data.synopsis }),
    },
  });
}

// ─── Revisions ──────────────────────────────────────────────────────────────

export async function listRevisions(ctx: AuthorContext, sceneId: string) {
  await requireScene(ctx, sceneId);
  const revisions = await db.sceneRevision.findMany({
    where: { sceneId, workspaceId: ctx.workspaceId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      createdAt: true,
      wordCount: true,
      source: true,
      label: true,
      contentText: true,
    },
  });
  return revisions.map(({ contentText, ...r }) => ({ ...r, excerpt: contentText.slice(0, 240) }));
}

export async function getRevision(ctx: AuthorContext, revisionId: string) {
  const revision = await db.sceneRevision.findFirst({
    where: { id: revisionId, workspaceId: ctx.workspaceId },
    select: {
      id: true,
      sceneId: true,
      createdAt: true,
      wordCount: true,
      source: true,
      label: true,
      contentText: true,
    },
  });
  if (!revision) throw new NotFoundError("Revision");
  await requireScene(ctx, revision.sceneId);
  return revision;
}

/** Saves the current content as a named version the author chose to keep. */
export async function saveVersion(ctx: AuthorContext, sceneId: string, label?: string | null) {
  await requireScene(ctx, sceneId);
  const parsed = revisionLabel.parse(label);
  return db.$transaction((tx) => snapshot(tx, ctx, sceneId, { source: "MANUAL", label: parsed }));
}

/**
 * Restores an earlier version. The current content is kept as a
 * "before restore" revision first, so a restore can always be undone.
 */
export async function restoreRevision(ctx: AuthorContext, revisionId: string): Promise<SaveResult> {
  const revision = await getRevision(ctx, revisionId);
  const full = await db.sceneRevision.findUniqueOrThrow({
    where: { id: revisionId },
    select: { content: true, contentText: true, wordCount: true },
  });

  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 FROM "scenes" WHERE "id" = ${revision.sceneId}::uuid FOR UPDATE`;
    await snapshot(tx, ctx, revision.sceneId, { source: "BEFORE_RESTORE" });
    const updated = await tx.scene.update({
      where: { id: revision.sceneId },
      data: {
        // An empty revision must clear the content, not leave it unchanged.
        content: jsonOrDbNull(full.content),
        contentText: full.contentText,
        wordCount: full.wordCount,
        version: { increment: 1 },
      },
      select: { version: true, wordCount: true, updatedAt: true },
    });
    return { version: updated.version, wordCount: updated.wordCount, savedAt: updated.updatedAt };
  });
}

function jsonOrDbNull(value: Prisma.JsonValue | null) {
  return value === null ? Prisma.DbNull : (value as Prisma.InputJsonValue);
}

/** Most recently edited scenes, for "continue writing". Optionally one pen name's work only. */
export async function listRecentScenes(
  ctx: AuthorContext,
  { penNameId, limit = 5 }: { penNameId: string | null; limit?: number },
) {
  return db.scene.findMany({
    where: {
      workspaceId: ctx.workspaceId,
      deletedAt: null,
      chapter: { deletedAt: null, OR: [{ partId: null }, { part: { deletedAt: null } }] },
      book: {
        deletedAt: null,
        OR: [{ seriesId: null }, { series: { deletedAt: null } }],
        ...(penNameId ? { penNameId } : {}),
      },
    },
    orderBy: { updatedAt: "desc" },
    take: limit,
    select: {
      id: true,
      title: true,
      wordCount: true,
      updatedAt: true,
      book: { select: { id: true, title: true } },
      chapter: { select: { title: true } },
    },
  });
}
