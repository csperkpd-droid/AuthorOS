import type { WorkspaceRole } from "@/generated/prisma/client";
import { db } from "@/lib/db";

export type Membership = {
  workspaceId: string;
  role: WorkspaceRole;
  /** The identity the member is working as; null = all identities. */
  activePenNameId: string | null;
};

const membershipSelect = { workspaceId: true, role: true, activePenNameId: true } as const;

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
      select: membershipSelect,
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
    return { workspaceId: workspace.id, role: "OWNER" as const, activePenNameId: null };
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
    select: membershipSelect,
  });
}

export async function getWorkspace(workspaceId: string) {
  return db.workspace.findUniqueOrThrow({
    where: { id: workspaceId },
    select: { id: true, name: true, createdAt: true },
  });
}
