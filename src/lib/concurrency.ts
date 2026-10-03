import { ConflictError } from "./errors";

/**
 * Optimistic concurrency for edits of story metadata (M8): forms send the
 * `updatedAt` they were opened with; an edit is refused when the object
 * changed since (another tab, device or collaborator), instead of silently
 * overwriting it. Rich text uses versions instead (history module).
 */
export type EditGuard = { expectedUpdatedAt?: string | Date | null };

export function staleError(noun: string) {
  return new ConflictError(
    `This ${noun} was changed somewhere else since you opened it. Your edits are still in the form: copy what you need, then reload to see the latest version.`,
  );
}

/** Throws when `expected` is given and differs from the object's current `updatedAt`. */
export function assertNotStale(
  current: Date,
  expected: EditGuard["expectedUpdatedAt"],
  noun: string,
) {
  if (!expected) return;
  const time = new Date(expected).getTime();
  if (Number.isNaN(time) || time !== current.getTime()) throw staleError(noun);
}
