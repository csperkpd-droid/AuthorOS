import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { countWords, docSchema, docToText } from "@/lib/text";
import { resolveNode, storyObjectType } from "@/modules/story-graph";
import type { AuthorContext } from "@/server/context";
import { assertCan } from "@/server/policy";
import { z } from "zod";

import { isVersionedKind, versioned, type VersionedKind } from "./versioned";

/** Autosaves keep at most one checkpoint per window, so history stays readable. */
export const CHECKPOINT_INTERVAL_MS = 10 * 60 * 1000;

export const revisionLabel = z
  .string()
  .trim()
  .max(120, "Keep the label under 120 characters.")
  .transform((v) => (v === "" ? null : v))
  .nullish();

export type SaveResult = { version: number; wordCount: number; savedAt: Date };

/** A visible, versioned story object in this workspace. */
/** A versioned object the author may edit (the area comes from its kind). */
async function requireEditable(ctx: AuthorContext, nodeId: string): Promise<VersionedKind> {
  const kind = await requireVersioned(ctx, nodeId);
  assertCan(ctx, "edit", storyObjectType(kind).area);
  return kind;
}

async function requireVersioned(ctx: AuthorContext, nodeId: string): Promise<VersionedKind> {
  const node = await resolveNode(ctx, nodeId);
  if (!node || !isVersionedKind(node.kind)) throw new NotFoundError("Item");
  return node.kind;
}

/**
 * Saves rich text for a versioned object. `baseVersion` is the version the
 * editor loaded; if the object changed since (another tab or device), the
 * save is refused instead of silently overwriting. Before overwriting, the
 * previous content is checkpointed if the last revision is old enough.
 * Callers check access first; this re-checks visibility.
 */
export async function saveContent(
  ctx: AuthorContext,
  { nodeId, content, baseVersion }: { nodeId: string; content: unknown; baseVersion: number },
  {
    afterWrite,
  }: {
    /**
     * Runs in the save's transaction with the word counts before and after
     * (e.g. to record words written). Restores don't call it.
     */
    afterWrite?: (
      tx: Prisma.TransactionClient,
      words: { before: number; after: number },
    ) => Promise<void>;
  } = {},
): Promise<SaveResult> {
  assertCan(ctx, "edit", "any");
  const kind = await requireEditable(ctx, nodeId);
  const doc = docSchema.parse(content);
  const text = docToText(doc);
  const wordCount = countWords(text);
  const access = versioned[kind];

  return db.$transaction(async (tx) => {
    // The row lock serializes concurrent saves so versions stay exact.
    const current = await access.lock(tx, nodeId);
    if (current === null) throw new NotFoundError("Item");
    if (current !== baseVersion) {
      throw new ConflictError(
        `This ${access.noun} was changed somewhere else. Reload to see the latest version.`,
      );
    }
    await checkpointIfDue(tx, ctx, kind, nodeId);
    const before = afterWrite ? (await access.read(tx, nodeId)).wordCount : 0;
    const written = await access.write(tx, nodeId, {
      content: doc as Prisma.JsonValue,
      text,
      wordCount,
    });
    if (afterWrite) await afterWrite(tx, { before, after: wordCount });
    return { ...written, wordCount };
  });
}

async function checkpointIfDue(
  tx: Prisma.TransactionClient,
  ctx: AuthorContext,
  kind: VersionedKind,
  nodeId: string,
) {
  const latest = await tx.contentRevision.findFirst({
    where: { nodeId },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  if (latest && Date.now() - latest.createdAt.getTime() < CHECKPOINT_INTERVAL_MS) return;
  await snapshot(tx, ctx, kind, nodeId, { source: "AUTOSAVE", skipEmpty: true });
}

async function snapshot(
  tx: Prisma.TransactionClient,
  ctx: AuthorContext,
  kind: VersionedKind,
  nodeId: string,
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
  const current = await versioned[kind].read(tx, nodeId);
  // Empty content is not worth an automatic checkpoint.
  if (skipEmpty && current.text.trim() === "") return null;
  return tx.contentRevision.create({
    data: {
      workspaceId: ctx.workspaceId,
      nodeId,
      content: current.content ?? undefined,
      contentText: current.text,
      wordCount: current.wordCount,
      source,
      label,
      createdById: ctx.userId,
    },
    select: { id: true },
  });
}

/** Every revision of an object, newest first. Nothing is ever pruned. */
export async function listRevisions(ctx: AuthorContext, nodeId: string) {
  await requireVersioned(ctx, nodeId);
  const revisions = await db.contentRevision.findMany({
    where: { nodeId, workspaceId: ctx.workspaceId },
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
  const revision = await db.contentRevision.findFirst({
    where: { id: revisionId, workspaceId: ctx.workspaceId },
    select: {
      id: true,
      nodeId: true,
      createdAt: true,
      wordCount: true,
      source: true,
      label: true,
      contentText: true,
    },
  });
  if (!revision) throw new NotFoundError("Revision");
  await requireVersioned(ctx, revision.nodeId);
  return revision;
}

/** Saves the current content as a named version the author chose to keep. */
export async function saveVersion(ctx: AuthorContext, nodeId: string, label?: string | null) {
  assertCan(ctx, "edit", "any");
  const kind = await requireEditable(ctx, nodeId);
  const parsed = revisionLabel.parse(label);
  return db.$transaction((tx) =>
    snapshot(tx, ctx, kind, nodeId, { source: "MANUAL", label: parsed }),
  );
}

/**
 * Restores an earlier version. The current content is kept as a
 * "before restore" revision first, so a restore can always be undone.
 */
export async function restoreRevision(ctx: AuthorContext, revisionId: string): Promise<SaveResult> {
  assertCan(ctx, "edit", "any");
  const revision = await getRevision(ctx, revisionId);
  const kind = await requireEditable(ctx, revision.nodeId);
  const full = await db.contentRevision.findUniqueOrThrow({
    where: { id: revisionId },
    select: { content: true, contentText: true, wordCount: true },
  });

  return db.$transaction(async (tx) => {
    await versioned[kind].lock(tx, revision.nodeId);
    await snapshot(tx, ctx, kind, revision.nodeId, { source: "BEFORE_RESTORE" });
    // An empty revision clears the content (null is written as SQL NULL).
    const written = await versioned[kind].write(tx, revision.nodeId, {
      content: full.content,
      text: full.contentText,
      wordCount: full.wordCount,
    });
    return { ...written, wordCount: full.wordCount };
  });
}
