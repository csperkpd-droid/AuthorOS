import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { anchorText, findAnchor, makeAnchor, reanchor, type TextAnchor } from "@/lib/anchors";
import { db } from "@/lib/db";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { liveScene, resolveNode, storyObjectType } from "@/modules/story-graph";
import type { AuthorContext } from "@/server/context";
import { assertCan, assertCanView } from "@/server/policy";

import {
  anchorInput,
  commentBody,
  newCommentInput,
  type AnchorInput,
  type NewCommentInput,
} from "./schemas";

/**
 * Comments with external anchors (decisions 87 and 114, M16). A comment
 * annotates a passage of a scene's or note's text and never enters the
 * document: adding, editing, resolving or deleting one never changes the
 * text, its versions, its word count or its exports.
 *
 * - The passage is anchored here: offsets in the editor's plain text
 *   (`lib/anchors.ts`), the exact quote and its context, the version.
 * - Every save, restore and import of the text re-finds each passage in the
 *   same transaction (`reanchorComments`), strictly: when that isn't
 *   certain, the comment is flagged (Needs review) with its original quote,
 *   never moved to other text. Only the author attaches it elsewhere
 *   (`updateCommentAnchor`).
 * - States: Open, Needs review, Resolved (kept, hidden by default). These
 *   are not validity states.
 * - Deleting is a soft delete with Undo (`restoreComment`); deleted comments
 *   are not in the Trash. A comment is hidden while its scene or note is in
 *   the Trash (the read funnel) and goes when it is deleted forever.
 * - Adding and changing comments is the `comment` action on the document's
 *   area; reading them, `view`.
 */

type Tx = Prisma.TransactionClient;
type Client = Tx | typeof db;
type DocKind = "SCENE" | "NOTE";

export type CommentView = {
  id: string;
  body: string;
  state: "OPEN" | "NEEDS_REVIEW" | "RESOLVED";
  start: number;
  end: number;
  quote: string;
  prefix: string;
  suffix: string;
  docVersion: number;
  anchorLost: boolean;
  createdAt: Date;
  updatedAt: Date;
};

const viewSelect = {
  id: true,
  body: true,
  state: true,
  anchorStart: true,
  anchorEnd: true,
  quote: true,
  prefix: true,
  suffix: true,
  docVersion: true,
  anchorLost: true,
  createdAt: true,
  updatedAt: true,
} as const;

const toView = (c: Prisma.CommentGetPayload<{ select: typeof viewSelect }>): CommentView => ({
  id: c.id,
  body: c.body,
  state: c.state,
  start: c.anchorStart,
  end: c.anchorEnd,
  quote: c.quote,
  prefix: c.prefix,
  suffix: c.suffix,
  docVersion: c.docVersion,
  anchorLost: c.anchorLost,
  createdAt: c.createdAt,
  updatedAt: c.updatedAt,
});

const anchorOf = (c: {
  anchorStart: number;
  anchorEnd: number;
  quote: string;
  prefix: string;
  suffix: string;
}): TextAnchor => ({
  start: c.anchorStart,
  end: c.anchorEnd,
  quote: c.quote,
  prefix: c.prefix,
  suffix: c.suffix,
});

const anchorColumns = (a: TextAnchor) => ({
  anchorStart: a.start,
  anchorEnd: a.end,
  quote: a.quote,
  prefix: a.prefix,
  suffix: a.suffix,
});

/** A visible scene or note (the read funnel: nothing in the Trash, nothing not viewable). */
async function requireDocument(ctx: AuthorContext, nodeId: string): Promise<DocKind> {
  const node = await resolveNode(ctx, nodeId);
  if (!node || (node.kind !== "SCENE" && node.kind !== "NOTE"))
    throw new NotFoundError("Scene or note");
  return node.kind;
}

/** Row-locks a scene or note and reads its document and version. */
async function lockDocument(tx: Tx, kind: DocKind, id: string) {
  const rows =
    kind === "SCENE"
      ? await tx.$queryRaw<{ version: number; content: unknown }[]>`
          SELECT "version", "content" FROM "scenes" WHERE "id" = ${id}::uuid FOR UPDATE`
      : await tx.$queryRaw<{ version: number; content: unknown }[]>`
          SELECT "version", "body" AS "content" FROM "notes" WHERE "id" = ${id}::uuid FOR UPDATE`;
  if (!rows[0]) throw new NotFoundError("Scene or note");
  return { version: rows[0].version, text: anchorText(rows[0].content) };
}

/** A comment of a visible scene or note, and that document's kind. */
async function requireComment(ctx: AuthorContext, id: string) {
  const comment = await db.comment.findFirst({
    where: { id, workspaceId: ctx.workspaceId },
    select: { id: true, nodeId: true, deletedAt: true },
  });
  if (!comment) throw new NotFoundError("Comment");
  const kind = await requireDocument(ctx, comment.nodeId).catch(() => {
    throw new NotFoundError("Comment");
  });
  return { ...comment, kind };
}

/** The `comment` action on the document's area. */
function assertCanComment(ctx: AuthorContext, kind: DocKind) {
  assertCan(ctx, "comment", storyObjectType(kind).area);
}

// ─── Reads ──────────────────────────────────────────────────────────────────

/**
 * The comments of a scene or note, in text order (resolved ones included:
 * the editor hides them by default). Deleted comments are left out.
 */
export async function listComments(ctx: AuthorContext, nodeId: string): Promise<CommentView[]> {
  assertCanView(ctx, "any", { kind: "NODE", id: nodeId });
  await requireDocument(ctx, nodeId);
  const rows = await db.comment.findMany({
    where: { workspaceId: ctx.workspaceId, nodeId, deletedAt: null },
    orderBy: [{ anchorStart: "asc" }, { createdAt: "asc" }],
    select: viewSelect,
  });
  return rows.map(toView);
}

/**
 * For a book's binder: how many comments need review in each of its scenes
 * (scenes in the Trash and deleted comments don't count).
 */
export async function countCommentsToReview(
  ctx: AuthorContext,
  bookId: string,
): Promise<Record<string, number>> {
  assertCanView(ctx, "manuscript", { kind: "BOOK", id: bookId });
  const book = await resolveNode(ctx, bookId);
  if (!book || book.kind !== "BOOK") throw new NotFoundError("Book");
  const scenes = await db.scene.findMany({
    where: { workspaceId: ctx.workspaceId, bookId, ...liveScene },
    select: { id: true },
  });
  const counts = await db.comment.groupBy({
    by: ["nodeId"],
    where: {
      workspaceId: ctx.workspaceId,
      nodeId: { in: scenes.map((s) => s.id) },
      state: "NEEDS_REVIEW",
      deletedAt: null,
    },
    _count: true,
  });
  return Object.fromEntries(counts.map((c) => [c.nodeId, c._count]));
}

// ─── Changes ────────────────────────────────────────────────────────────────

/**
 * Comments on a passage. The passage is what the author selected in the
 * text as saved at `version`: if the text changed since, the passage is
 * found again strictly, or the comment is refused (select it again).
 */
export async function addComment(ctx: AuthorContext, nodeId: string, input: NewCommentInput) {
  assertCan(ctx, "comment", "any");
  const data = newCommentInput.parse(input);
  const kind = await requireDocument(ctx, nodeId);
  assertCanComment(ctx, kind);
  return db.$transaction(async (tx) => {
    const doc = await lockDocument(tx, kind, nodeId);
    const anchor = locate(doc, data);
    return tx.comment.create({
      data: {
        workspaceId: ctx.workspaceId,
        nodeId,
        body: data.body,
        ...anchorColumns(anchor),
        docVersion: doc.version,
        createdById: ctx.userId,
      },
      select: { id: true },
    });
  });
}

/** The selected passage in the current text, or a refusal when it can't be found for certain. */
function locate(
  doc: { version: number; text: string },
  input: TextAnchor & { version: number },
): TextAnchor {
  if (input.version === doc.version && doc.text.slice(input.start, input.end) === input.quote)
    return makeAnchor(doc.text, input.start, input.end);
  const found = findAnchor(doc.text, input);
  if (!found)
    throw new ConflictError(
      "The text changed since you selected it. Select the passage again to comment on it.",
    );
  return makeAnchor(doc.text, found.start, found.end);
}

/** Edits a comment's text. Refused if it changed since the author started (`expectedBody`). */
export async function updateCommentBody(
  ctx: AuthorContext,
  id: string,
  body: string,
  guard: { expectedBody?: string } = {},
) {
  assertCan(ctx, "comment", "any");
  const next = commentBody.parse(body);
  const comment = await requireComment(ctx, id);
  assertCanComment(ctx, comment.kind);
  if (comment.deletedAt) throw new NotFoundError("Comment");
  const { count } = await db.comment.updateMany({
    where: {
      id,
      deletedAt: null,
      ...(guard.expectedBody !== undefined ? { body: guard.expectedBody } : {}),
    },
    data: { body: next },
  });
  if (count === 0)
    throw new ConflictError(
      "This comment was changed somewhere else since you opened it. Reload to see the latest version.",
    );
}

/**
 * Resolves a comment (kept, hidden by default) or reopens it. A reopened
 * comment whose passage was lost meanwhile needs review.
 */
export async function setCommentResolved(ctx: AuthorContext, id: string, resolved: boolean) {
  assertCan(ctx, "comment", "any");
  const comment = await requireComment(ctx, id);
  assertCanComment(ctx, comment.kind);
  if (comment.deletedAt) throw new NotFoundError("Comment");
  await db.$transaction(async (tx) => {
    const row = await tx.comment.findUniqueOrThrow({
      where: { id },
      select: { state: true, anchorLost: true },
    });
    if (resolved) {
      if (row.state === "RESOLVED") return;
      await tx.comment.update({
        where: { id },
        data: { state: "RESOLVED", resolvedAt: new Date() },
      });
    } else {
      if (row.state !== "RESOLVED") return;
      await tx.comment.update({
        where: { id },
        data: { state: row.anchorLost ? "NEEDS_REVIEW" : "OPEN", resolvedAt: null },
      });
    }
  });
}

/**
 * Attaches a comment that needs review to a passage the author chose
 * (selected in the text as saved at `version`). The only way a flagged
 * comment points at text again; the old quote is replaced by the new one.
 */
export async function updateCommentAnchor(ctx: AuthorContext, id: string, input: AnchorInput) {
  assertCan(ctx, "comment", "any");
  const data = anchorInput.parse(input);
  const comment = await requireComment(ctx, id);
  assertCanComment(ctx, comment.kind);
  if (comment.deletedAt) throw new NotFoundError("Comment");
  await db.$transaction(async (tx) => {
    const doc = await lockDocument(tx, comment.kind, comment.nodeId);
    if (data.version !== doc.version || doc.text.slice(data.start, data.end) !== data.quote)
      throw new ConflictError(
        "The text changed since you selected it. Select the passage again to attach the comment.",
      );
    const row = await tx.comment.findUniqueOrThrow({ where: { id }, select: { state: true } });
    await tx.comment.update({
      where: { id },
      data: {
        ...anchorColumns(makeAnchor(doc.text, data.start, data.end)),
        docVersion: doc.version,
        anchorLost: false,
        state: row.state === "RESOLVED" ? "RESOLVED" : "OPEN",
      },
    });
  });
}

/** Deletes a comment (soft: `restoreComment` undoes it). Returns the Undo token. */
export async function deleteComment(ctx: AuthorContext, id: string) {
  assertCan(ctx, "comment", "any");
  const comment = await requireComment(ctx, id);
  assertCanComment(ctx, comment.kind);
  if (comment.deletedAt) return { deletedAt: comment.deletedAt };
  const deletedAt = new Date();
  await db.comment.updateMany({ where: { id, deletedAt: null }, data: { deletedAt } });
  const row = await db.comment.findUniqueOrThrow({ where: { id }, select: { deletedAt: true } });
  return { deletedAt: row.deletedAt! };
}

/**
 * Undo for `deleteComment`, with the token it returned. Repeating it is
 * harmless; an Undo for another deletion of the same comment is refused.
 * The passage is re-found in the current text, as on a save.
 */
export async function restoreComment(ctx: AuthorContext, id: string, deletedAt: string | Date) {
  assertCan(ctx, "comment", "any");
  const comment = await requireComment(ctx, id);
  assertCanComment(ctx, comment.kind);
  if (!comment.deletedAt) return;
  if (comment.deletedAt.getTime() !== new Date(deletedAt).getTime())
    throw new ConflictError("This comment changed since it was deleted. Reload to see it.");
  await db.$transaction(async (tx) => {
    const doc = await lockDocument(tx, comment.kind, comment.nodeId);
    const row = await tx.comment.findUniqueOrThrow({ where: { id } });
    await tx.comment.update({
      where: { id },
      data: { deletedAt: null, ...reanchored(row, doc) },
    });
  });
}

// ─── Re-anchoring (inside the text's own transaction) ────────────────────────

type Row = {
  id: string;
  state: "OPEN" | "NEEDS_REVIEW" | "RESOLVED";
  anchorStart: number;
  anchorEnd: number;
  quote: string;
  prefix: string;
  suffix: string;
  docVersion: number;
  anchorLost: boolean;
};

/**
 * What changes for one comment against new text: nothing (same place), a
 * new place (found for certain), or lost (an open comment needs review; a
 * resolved one stays resolved and reopens as needing review). A comment
 * already lost stays so until the author attaches it.
 */
function reanchored(row: Row, doc: { version: number; text: string }) {
  if (row.anchorLost) return {};
  const next = reanchor(doc.text, anchorOf(row));
  if (!next) return { anchorLost: true, state: row.state === "OPEN" ? "NEEDS_REVIEW" : row.state };
  const same =
    next.start === row.anchorStart &&
    next.end === row.anchorEnd &&
    next.prefix === row.prefix &&
    next.suffix === row.suffix &&
    row.docVersion === doc.version;
  return same ? {} : { ...anchorColumns(next), docVersion: doc.version };
}

/**
 * Re-finds the passages of a scene's or note's comments after its text was
 * written (a save, a restore or an import), in that write's transaction.
 * Called by the services that write text, after their own checks; it only
 * records where each passage is now, never changes the text.
 */
export async function reanchorComments(
  tx: Client,
  {
    workspaceId,
    nodeId,
    content,
    version,
  }: { workspaceId: string; nodeId: string; content: unknown; version: number },
) {
  const rows = await tx.comment.findMany({
    where: { workspaceId, nodeId, deletedAt: null, anchorLost: false },
    select: {
      id: true,
      state: true,
      anchorStart: true,
      anchorEnd: true,
      quote: true,
      prefix: true,
      suffix: true,
      docVersion: true,
      anchorLost: true,
    },
  });
  if (!rows.length) return;
  const doc = { version, text: anchorText(content) };
  for (const row of rows) {
    const change = reanchored(row, doc);
    if (Object.keys(change).length)
      await tx.comment.update({ where: { id: row.id }, data: change as never });
  }
}
