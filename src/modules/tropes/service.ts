import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { assertNotStale, staleError, type EditGuard } from "@/lib/concurrency";
import { db } from "@/lib/db";
import { NotFoundError, RuleError } from "@/lib/errors";
import { connect, disconnect, listConnections } from "@/modules/connections";
import { recordFieldHistory } from "@/modules/history";
import { createStoryNode, liveTrope, resolveNode, type NodeSummary } from "@/modules/story-graph";
import { deleteForever, restoreFromTrash } from "@/modules/trash";
import type { AuthorContext } from "@/server/context";
import { assertCan, assertCanView } from "@/server/policy";

import { addTropeInput, tropeInput, type AddTropeInput, type TropeInput } from "./schemas";

/**
 * Tropes (decision 110, M13): shared, reusable story descriptors ("Enemies
 * to lovers"), not owned by a pen name. Books, series, relationships and
 * structures use them through `uses_trope` Universal Connections; there is
 * no other link store. Names are unique among a workspace's live tropes,
 * ignoring case and surrounding spaces: asking for an existing name gives
 * the existing trope. Always the author's statement, never inferred.
 * Changes need story-bible edit rights; reads go through the Story Graph.
 */

export type TropeSummary = { id: string; name: string; description: string | null; uses: number };

export type TropeView = {
  id: string;
  name: string;
  description: string | null;
  updatedAt: Date;
  /** What uses it, as far as the reader may see (books, series, relationships, structures). */
  usedIn: NodeSummary[];
};

const sameName = (workspaceId: string, name: string) => ({
  workspaceId,
  ...liveTrope,
  name: { equals: name.trim(), mode: "insensitive" as const },
});

function isUniqueViolation(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

async function requireTrope(ctx: AuthorContext, id: string) {
  const node = await resolveNode(ctx, id);
  if (!node || node.kind !== "TROPE") throw new NotFoundError("Trope");
  return node;
}

// ─── Reads ──────────────────────────────────────────────────────────────────

/** Every live trope of the workspace, by name, with how many things use it. */
export async function listTropes(ctx: AuthorContext): Promise<TropeSummary[]> {
  assertCanView(ctx, "storyBible");
  const rows = await db.trope.findMany({
    where: { workspaceId: ctx.workspaceId, ...liveTrope },
    orderBy: { name: "asc" },
    select: { id: true, name: true, description: true },
  });
  const uses = await db.connection.groupBy({
    by: ["targetId"],
    where: {
      workspaceId: ctx.workspaceId,
      kind: "uses_trope",
      targetId: { in: rows.map((r) => r.id) },
    },
    _count: true,
  });
  const count = new Map(uses.map((u) => [u.targetId, u._count]));
  return rows.map((r) => ({ ...r, uses: count.get(r.id) ?? 0 }));
}

/** A trope with what uses it. Things the reader may not view are left out, never named. */
export async function getTrope(ctx: AuthorContext, id: string): Promise<TropeView> {
  assertCanView(ctx, "storyBible", { kind: "TROPE", id });
  await requireTrope(ctx, id);
  const row = await db.trope.findUniqueOrThrow({
    where: { id },
    select: { name: true, description: true, updatedAt: true },
  });
  const links = await listConnections(ctx, id, { kinds: ["uses_trope"] });
  return { id, ...row, usedIn: links.map((l) => l.other) };
}

/** The tropes a book, series, relationship or structure uses, by name. */
export async function tropesOf(ctx: AuthorContext, nodeId: string) {
  assertCanView(ctx, "storyBible", { kind: "NODE", id: nodeId });
  const links = await listConnections(ctx, nodeId, { kinds: ["uses_trope"] });
  return links
    .map((l) => ({ id: l.other.id, name: l.other.title, href: l.other.href }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// ─── Changes ────────────────────────────────────────────────────────────────

/**
 * Creates a trope, or returns the live trope that already has this name
 * (ignoring case and surrounding spaces): never a second one.
 */
export async function createTrope(
  ctx: AuthorContext,
  input: TropeInput,
): Promise<{ id: string; created: boolean }> {
  assertCan(ctx, "edit", "storyBible");
  const data = tropeInput.parse(input);
  const existing = await db.trope.findFirst({
    where: sameName(ctx.workspaceId, data.name),
    select: { id: true },
  });
  if (existing) return { id: existing.id, created: false };
  try {
    const id = await db.$transaction(async (tx) => {
      const id = await createStoryNode(tx, ctx.workspaceId, "TROPE");
      await tx.trope.create({
        data: {
          id,
          workspaceId: ctx.workspaceId,
          name: data.name,
          description: data.description || null,
        },
      });
      return id;
    });
    return { id, created: true };
  } catch (error) {
    // Someone created the same name at the same moment: use theirs.
    if (!isUniqueViolation(error)) throw error;
    const winner = await db.trope.findFirstOrThrow({
      where: sameName(ctx.workspaceId, data.name),
      select: { id: true },
    });
    return { id: winner.id, created: false };
  }
}

/** Renames a trope or changes its description (description history kept). */
export async function updateTrope(
  ctx: AuthorContext,
  id: string,
  input: TropeInput,
  guard: EditGuard = {},
) {
  assertCan(ctx, "edit", "storyBible");
  const data = tropeInput.parse(input);
  await requireTrope(ctx, id);
  const clash = await db.trope.findFirst({
    where: { ...sameName(ctx.workspaceId, data.name), id: { not: id } },
    select: { name: true },
  });
  if (clash) throw new RuleError(`There is already a trope called “${clash.name}”.`);
  try {
    await db.$transaction(async (tx) => {
      const row = await tx.trope.findUniqueOrThrow({
        where: { id },
        select: { description: true, updatedAt: true },
      });
      assertNotStale(row.updatedAt, guard.expectedUpdatedAt, "trope");
      const description = data.description === undefined ? undefined : data.description || null;
      await recordFieldHistory(tx, ctx, id, row, { description });
      const { count } = await tx.trope.updateMany({
        where: { id, updatedAt: row.updatedAt },
        data: { name: data.name, ...(description !== undefined && { description }) },
      });
      if (count === 0) throw staleError("trope");
    });
  } catch (error) {
    if (isUniqueViolation(error))
      throw new RuleError(`There is already a trope called “${data.name}”.`);
    throw error;
  }
}

/** Moves a trope to the Trash: it and its links are hidden until restored. */
export async function trashTrope(ctx: AuthorContext, id: string) {
  assertCan(ctx, "edit", "storyBible");
  await requireTrope(ctx, id);
  await db.trope.update({ where: { id }, data: { deletedAt: new Date() } });
}

/** Restores a trope from the Trash (refused if its name was taken meanwhile). */
export async function restoreTrope(ctx: AuthorContext, id: string) {
  assertCan(ctx, "edit", "storyBible");
  await restoreFromTrash(ctx, "TROPE", id);
}

/**
 * Deletes a trope in the Trash forever, through the Trash's reviewed path
 * (Red): the token of the report the author reviewed is required.
 */
export async function deleteTropeForever(ctx: AuthorContext, id: string, token: string) {
  assertCan(ctx, "manage", "workspace");
  if (!token) throw new RuleError("Review what this change affects first.");
  await deleteForever(ctx, "TROPE", id, token);
}

/**
 * Adds a trope to a book, series, relationship or structure: an existing
 * trope, or one found or created by name. Adding one it already has
 * changes nothing.
 */
export async function addTrope(ctx: AuthorContext, targetId: string, input: AddTropeInput) {
  assertCan(ctx, "edit", "storyBible");
  const data = addTropeInput.parse(input);
  if (!(await resolveNode(ctx, targetId))) throw new NotFoundError("Story item");
  const tropeId =
    "tropeId" in data ? data.tropeId : (await createTrope(ctx, { name: data.name })).id;
  const existing = await db.connection.findFirst({
    where: {
      workspaceId: ctx.workspaceId,
      sourceId: targetId,
      targetId: tropeId,
      kind: "uses_trope",
    },
    select: { id: true },
  });
  if (!existing) await connect(ctx, { sourceId: targetId, targetId: tropeId, kind: "uses_trope" });
  return { tropeId };
}

/** Removes a trope from something. The trope and the other object stay. */
export async function removeTrope(ctx: AuthorContext, targetId: string, tropeId: string) {
  assertCan(ctx, "edit", "storyBible");
  if (!(await resolveNode(ctx, targetId))) throw new NotFoundError("Story item");
  const link = await db.connection.findFirst({
    where: {
      workspaceId: ctx.workspaceId,
      sourceId: targetId,
      targetId: tropeId,
      kind: "uses_trope",
    },
    select: { id: true },
  });
  if (!link) throw new NotFoundError("Trope");
  await disconnect(ctx, link.id);
}
