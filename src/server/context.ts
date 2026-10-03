import "server-only";

import { redirect } from "next/navigation";
import { cache } from "react";

import type { WorkspaceRole } from "@/generated/prisma/client";
import { auth } from "@/lib/auth";
import { ensurePersonalWorkspace } from "@/modules/workspaces";

/**
 * Who is acting and in which workspace. Every domain service takes this as
 * its first argument and scopes its queries by `workspaceId`.
 */
export type AuthorContext = {
  userId: string;
  workspaceId: string;
  role: WorkspaceRole;
};

export type SessionUser = {
  id: string;
  name: string | null;
  email: string;
  image: string | null;
};

/** The signed-in user, validated against the session table. Memoized per request. */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const session = await auth();
  const user = session?.user;
  if (!user?.id || !user.email) return null;
  return { id: user.id, name: user.name ?? null, email: user.email, image: user.image ?? null };
});

/**
 * The Data Access Layer entry point: call this in every page, server action
 * and route handler that touches author data. Redirects to sign-in when there
 * is no valid session.
 */
export const requireAuthorContext = cache(async (): Promise<AuthorContext> => {
  const user = await getSessionUser();
  if (!user) redirect("/sign-in");

  const membership = await ensurePersonalWorkspace(user);
  return { userId: user.id, ...membership };
});
