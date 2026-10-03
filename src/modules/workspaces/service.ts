import type { WorkspaceRole } from "@/generated/prisma/client";
import { db } from "@/lib/db";

export type Membership = { workspaceId: string; role: WorkspaceRole };

type NewAuthor = { id: string; name?: string | null; email: string };

/**
 * Returns the user's workspace membership, creating a personal workspace
 * (with the user as OWNER and a default pen name) on first use.
 *
 * Idempotent and safe under concurrency: a per-user advisory lock makes
 * simultaneous first requests create exactly one workspace.
 */
export async function ensurePersonalWorkspace(user: NewAuthor): Promise<Membership> {
  const existing = await findPrimaryMembership(user.id);
  if (existing) return existing;

  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${user.id}, 0))`;

    const created = await tx.workspaceMember.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: "asc" },
      select: { workspaceId: true, role: true },
    });
    if (created) return created;

    const displayName = user.name?.trim() || user.email.split("@")[0];
    const workspace = await tx.workspace.create({
      data: {
        name: `${displayName}'s workspace`,
        members: { create: { userId: user.id, role: "OWNER" } },
        penNames: { create: { name: displayName, isDefault: true } },
      },
      select: { id: true },
    });
    return { workspaceId: workspace.id, role: "OWNER" as const };
  });
}

/**
 * The workspace a user works in. In the single-author MVP this is their
 * oldest membership; a workspace switcher replaces this rule later.
 */
export async function findPrimaryMembership(userId: string): Promise<Membership | null> {
  return db.workspaceMember.findFirst({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: { workspaceId: true, role: true },
  });
}

export async function getWorkspace(workspaceId: string) {
  return db.workspace.findUniqueOrThrow({
    where: { id: workspaceId },
    select: { id: true, name: true, createdAt: true },
  });
}
