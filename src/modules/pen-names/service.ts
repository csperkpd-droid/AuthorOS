import "server-only";

import { db } from "@/lib/db";
import { createStoryNode } from "@/modules/story-graph";
import { NotFoundError, RuleError } from "@/lib/errors";
import type { AuthorContext } from "@/server/context";
import { assertCan } from "@/server/policy";

import { penNameInput, type PenNameInput } from "./schemas";

const penNameSelect = {
  id: true,
  name: true,
  bio: true,
  isDefault: true,
  archivedAt: true,
  language: true,
} as const;

export type PenNameSummary = {
  id: string;
  name: string;
  bio: string | null;
  isDefault: boolean;
  archivedAt: Date | null;
  /** Writing language (BCP 47), for search stemming. */
  language: string | null;
};

/** Pen names in display order: default first, then by creation. */
export async function listPenNames(
  ctx: AuthorContext,
  { includeArchived = false }: { includeArchived?: boolean } = {},
): Promise<PenNameSummary[]> {
  return db.penName.findMany({
    where: { workspaceId: ctx.workspaceId, ...(includeArchived ? {} : { archivedAt: null }) },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    select: penNameSelect,
  });
}

/** Every identity with how much work sits under it, for the All Identities view. */
export async function listIdentities(ctx: AuthorContext) {
  const penNames = await db.penName.findMany({
    where: { workspaceId: ctx.workspaceId },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    select: {
      ...penNameSelect,
      _count: {
        select: {
          books: {
            where: { deletedAt: null, OR: [{ seriesId: null }, { series: { deletedAt: null } }] },
          },
          series: { where: { deletedAt: null } },
        },
      },
    },
  });
  return penNames.map(({ _count, ...p }) => ({
    ...p,
    bookCount: _count.books,
    seriesCount: _count.series,
  }));
}

export async function getPenName(ctx: AuthorContext, id: string): Promise<PenNameSummary> {
  const penName = await db.penName.findFirst({
    where: { id, workspaceId: ctx.workspaceId },
    select: penNameSelect,
  });
  if (!penName) throw new NotFoundError("Pen name");
  return penName;
}

export async function getDefaultPenName(ctx: AuthorContext): Promise<PenNameSummary> {
  const penName = await db.penName.findFirst({
    where: { workspaceId: ctx.workspaceId, isDefault: true },
    select: penNameSelect,
  });
  if (!penName) throw new NotFoundError("Default pen name");
  return penName;
}

/** A pen name new work can be assigned to: it must exist here and not be archived. */
export async function requireAssignablePenName(
  ctx: AuthorContext,
  id: string,
): Promise<PenNameSummary> {
  const penName = await getPenName(ctx, id);
  if (penName.archivedAt)
    throw new RuleError(`“${penName.name}” is archived. Restore it before assigning work to it.`);
  return penName;
}

/** The pen name new work goes to: the active identity, else the default. */
export async function getPenNameForNewWork(ctx: AuthorContext): Promise<PenNameSummary> {
  const active = await getActivePenName(ctx);
  return active ?? getDefaultPenName(ctx);
}

export async function createPenName(
  ctx: AuthorContext,
  input: PenNameInput,
): Promise<PenNameSummary> {
  assertCan(ctx, "manage", "identity");
  const data = penNameInput.parse(input);
  return db.$transaction(async (tx) =>
    tx.penName.create({
      data: {
        id: await createStoryNode(tx, ctx.workspaceId, "PEN_NAME"),
        workspaceId: ctx.workspaceId,
        name: data.name,
        bio: data.bio ?? null,
        language: data.language ?? null,
      },
      select: penNameSelect,
    }),
  );
}

export async function updatePenName(
  ctx: AuthorContext,
  id: string,
  input: PenNameInput,
): Promise<PenNameSummary> {
  assertCan(ctx, "manage", "identity");
  const data = penNameInput.parse(input);
  await getPenName(ctx, id);
  return db.penName.update({
    where: { id },
    data: {
      name: data.name,
      bio: data.bio ?? null,
      ...(data.language !== undefined && { language: data.language }),
    },
    select: penNameSelect,
  });
}

export async function setDefaultPenName(ctx: AuthorContext, id: string): Promise<void> {
  assertCan(ctx, "manage", "identity");
  const penName = await getPenName(ctx, id);
  if (penName.archivedAt)
    throw new RuleError("Restore this pen name before making it the default.");
  if (penName.isDefault) return;

  // The partial unique index allows one default, so clear the old one first.
  await db.$transaction([
    db.penName.updateMany({
      where: { workspaceId: ctx.workspaceId, isDefault: true },
      data: { isDefault: false },
    }),
    db.penName.update({ where: { id }, data: { isDefault: true } }),
  ]);
}

/**
 * Archiving hides a pen name from pickers and switchers. Its books and series
 * keep their attribution and stay visible under All identities.
 */
export async function archivePenName(ctx: AuthorContext, id: string): Promise<void> {
  assertCan(ctx, "manage", "identity");
  const penName = await getPenName(ctx, id);
  if (penName.isDefault) {
    throw new RuleError("Choose another default pen name before archiving this one.");
  }
  if (penName.archivedAt) return;

  await db.$transaction([
    db.penName.update({ where: { id }, data: { archivedAt: new Date() } }),
    db.workspaceMember.updateMany({
      where: { workspaceId: ctx.workspaceId, activePenNameId: id },
      data: { activePenNameId: null },
    }),
  ]);
}

export async function restorePenName(ctx: AuthorContext, id: string): Promise<void> {
  assertCan(ctx, "manage", "identity");
  await getPenName(ctx, id);
  await db.penName.update({ where: { id }, data: { archivedAt: null } });
}

/** Switch the identity the author is working as (null = all identities). */
export async function setActiveIdentity(
  ctx: AuthorContext,
  penNameId: string | null,
): Promise<void> {
  if (penNameId !== null) await requireAssignablePenName(ctx, penNameId);
  await db.workspaceMember.update({
    where: { workspaceId_userId: { workspaceId: ctx.workspaceId, userId: ctx.userId } },
    data: { activePenNameId: penNameId },
  });
}

/** The active identity, or null when working across all identities. */
export async function getActivePenName(ctx: AuthorContext): Promise<PenNameSummary | null> {
  if (!ctx.activePenNameId) return null;
  return db.penName.findFirst({
    where: { id: ctx.activePenNameId, workspaceId: ctx.workspaceId, archivedAt: null },
    select: penNameSelect,
  });
}
