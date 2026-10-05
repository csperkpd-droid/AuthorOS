import "server-only";

import type { WorkspaceRole } from "@/generated/prisma/client";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import type { StoryArea } from "@/modules/story-graph";

import type { AuthorContext } from "./context";

/**
 * Authorization, checked close to the data: every service that changes
 * author data calls `assertCan()` as its first statement (enforced by
 * tests/integration/authorization.test.ts), so a route, page or action
 * can't skip it.
 *
 * - **Actions** grow with collaboration: `view`; `comment` and `suggest`
 *   (reviewers and editors propose, the author decides); `edit` (change
 *   story data); `manage` (workspace-level and irreversible operations:
 *   pen names, deleting forever, imports, backups, shared definitions).
 * - **Areas** are the Story Object Registry's areas plus `workspace`.
 * - **Roles** grant actions per area. Today's members are owners; editors
 *   and viewers are defined so co-authors, editors, beta readers and ARC
 *   readers can be added by granting, not by rewriting services.
 *
 * - **Reads** (M9) are checked the same way, below the UI: every service
 *   that returns author data calls `assertCanView()` first (enforced by
 *   tests/integration/read-authorization.test.ts), and the Story Graph
 *   resolver and search drop what the context may not view. Workspace
 *   membership alone grants nothing: the role's grants decide.
 *
 * Sharing a single book (beta readers, ARC, co-authors) will add resource
 * grants: `can(ctx, action, area, resource)` already takes the resource, and
 * every read and write already passes through it.
 */

export type PolicyAction = "view" | "comment" | "suggest" | "edit" | "manage";
export type PolicyArea = StoryArea | "workspace";

const AREAS: PolicyArea[] = [
  "identity",
  "manuscript",
  "storyBible",
  "structure",
  "planning",
  "workspace",
];
const CONTRIBUTE: PolicyAction[] = ["view", "comment", "suggest", "edit"];
const everywhere = (actions: PolicyAction[]) =>
  Object.fromEntries(AREAS.map((a) => [a, actions])) as Record<PolicyArea, PolicyAction[]>;

export const ROLE_GRANTS: Record<WorkspaceRole, Record<PolicyArea, PolicyAction[]>> = {
  OWNER: everywhere([...CONTRIBUTE, "manage"]),
  /** A co-author or editor: works on the story, doesn't manage the workspace. */
  EDITOR: { ...everywhere(CONTRIBUTE), identity: ["view"], workspace: ["view"] },
  /** Read only (beta readers will add `comment` through resource grants). */
  VIEWER: everywhere(["view"]),
};

/** A specific object an action applies to (reserved for resource grants). */
export type PolicyResource = { kind: string; id: string };

/**
 * Whether the context may do `action` in `area`. `"any"` = in at least one
 * area: a first check for services whose area depends on the object (e.g.
 * restoring from the Trash), followed by the precise check once known.
 */
export function can(
  ctx: Pick<AuthorContext, "role">,
  action: PolicyAction,
  area: PolicyArea | "any" = "workspace",
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  resource?: PolicyResource,
): boolean {
  const grants = ROLE_GRANTS[ctx.role];
  if (!grants) return false;
  if (area === "any") return Object.values(grants).some((actions) => actions.includes(action));
  return grants[area]?.includes(action) ?? false;
}

/** Throws ForbiddenError unless allowed. Call first in every service that changes data. */
export function assertCan(
  ctx: Pick<AuthorContext, "role">,
  action: PolicyAction,
  area: PolicyArea | "any" = "workspace",
  resource?: PolicyResource,
): void {
  if (!can(ctx, action, area, resource)) throw new ForbiddenError();
}

/**
 * Reads (M9): whether the context may view data in `area` (`"any"` = in at
 * least one area). Same grants as every other action.
 */
export function canView(
  ctx: Pick<AuthorContext, "role">,
  area: PolicyArea | "any",
  resource?: PolicyResource,
): boolean {
  return can(ctx, "view", area, resource);
}

/**
 * Call first in every service that returns author data. A refused read of a
 * specific object (`resource`) is reported as not found, exactly like an id
 * that doesn't exist, so a refusal never reveals that the object exists.
 * A refused list or search is forbidden (it names no object).
 */
export function assertCanView(
  ctx: Pick<AuthorContext, "role">,
  area: PolicyArea | "any",
  resource?: PolicyResource,
): void {
  if (canView(ctx, area, resource)) return;
  throw resource ? new NotFoundError("Item") : new ForbiddenError();
}
