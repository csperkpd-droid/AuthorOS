import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { CURRENT_DOC_FORMAT } from "@/lib/doc-format";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { countWords, docSchema, docToText } from "@/lib/text";
import { resolveNode, storyObjectType } from "@/modules/story-graph";
import type { AuthorContext } from "@/server/context";
import { assertCan } from "@/server/policy";
import { z } from "zod";

import { isVersionedKind, versioned, type VersionedKind } from "./versioned";

/** Autosaves keep at most one checkpoint per window, so history stays readable. */
export const CHECKPOINT_INTERVAL_MS = 10 * 60 * 1000;

/**
 * A save that removes this many words, or this share of a text of at least
 * LARGE_EDIT_MIN_WORDS, saves the previous text first, whatever the time
 * since the last checkpoint: a bad paste or an accidental select-all is
 * always recoverable.
 */
export const LARGE_EDIT_WORDS = 200;
export const LARGE_EDIT_SHARE = 0.2;
const LARGE_EDIT_MIN_WORDS = 50;

const WORD = /[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu;

/**
 * How many words of `before` are gone from `after` (as a multiset, so text
 * replaced by other text of the same length counts as removed).
 */
export function wordsRemoved(before: string, after: string): number {
  const remaining = new Map<string, number>();
  for (const w of after.toLowerCase().match(WORD) ?? [])
    remaining.set(w, (remaining.get(w) ?? 0) + 1);
  let removed = 0;
  for (const w of before.toLowerCase().match(WORD) ?? []) {
    const left = remaining.get(w) ?? 0;
    if (left > 0) remaining.set(w, left - 1);
    else removed++;
  }
  return removed;
}

export function isLargeEdit(before: string, after: string): boolean {
  const total = (before.match(WORD) ?? []).length;
  const removed = wordsRemoved(before, after);
  return (
    removed >= LARGE_EDIT_WORDS ||
    (total >= LARGE_EDIT_MIN_WORDS && removed / total >= LARGE_EDIT_SHARE)
  );
}

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
    const previous = await access.read(tx, nodeId);
    if (isLargeEdit(previous.text, text))
      await snapshot(tx, ctx, kind, nodeId, {
        source: "BEFORE_LARGE_EDIT",
        label: "Before a large edit",
        skipEmpty: true,
      });
    else await checkpointIfDue(tx, ctx, kind, nodeId);
    const written = await access.write(tx, nodeId, {
      content: doc as Prisma.JsonValue,
      text,
      wordCount,
      format: CURRENT_DOC_FORMAT,
    });
    if (afterWrite) await afterWrite(tx, { before: previous.wordCount, after: wordCount });
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
    source: "AUTOSAVE" | "MANUAL" | "BEFORE_RESTORE" | "BEFORE_LARGE_EDIT" | "IMPORT";
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
      contentFormat: current.format,
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
    select: { content: true, contentText: true, wordCount: true, contentFormat: true },
  });

  return db.$transaction(async (tx) => {
    await versioned[kind].lock(tx, revision.nodeId);
    await snapshot(tx, ctx, kind, revision.nodeId, { source: "BEFORE_RESTORE" });
    // An empty revision clears the content (null is written as SQL NULL).
    const written = await versioned[kind].write(tx, revision.nodeId, {
      content: full.content,
      text: full.contentText,
      wordCount: full.wordCount,
      format: full.contentFormat,
    });
    return { ...written, wordCount: full.wordCount };
  });
}

/**
 * Keeps text written on a device that never reached the cloud, when the
 * object changed elsewhere in the meantime: saved as a version (the current
 * text is untouched), so the author can compare and restore. Nothing written
 * offline is ever dropped.
 */
export async function keepDeviceDraft(
  ctx: AuthorContext,
  { nodeId, content, writtenAt }: { nodeId: string; content: unknown; writtenAt: string },
) {
  assertCan(ctx, "edit", "any");
  await requireEditable(ctx, nodeId);
  const doc = docSchema.parse(content);
  const text = docToText(doc);
  const when = new Date(writtenAt);
  const label = `From this device, not synced (${Number.isNaN(when.getTime()) ? "unknown time" : when.toISOString().slice(0, 16).replace("T", " ")} UTC)`;
  return db.contentRevision.create({
    data: {
      workspaceId: ctx.workspaceId,
      nodeId,
      content: doc as Prisma.InputJsonValue,
      contentText: text,
      wordCount: countWords(text),
      contentFormat: CURRENT_DOC_FORMAT,
      source: "MANUAL",
      label,
      createdById: ctx.userId,
    },
    select: { id: true },
  });
}
