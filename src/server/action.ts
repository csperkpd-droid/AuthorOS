import "server-only";

import { refresh } from "next/cache";
import { ZodError } from "zod";

import { DomainError } from "@/lib/errors";

/** What every Server Action returns to the client. */
export type ActionResult<T = null> =
  { ok: true; data: T } | { ok: false; error: string; code?: DomainError["code"] };

/**
 * Runs a Server Action body: expected failures (validation, domain rules)
 * become `{ ok: false, error }` for the UI; anything else (including
 * redirects) propagates. Refreshes the current route on success unless told
 * not to (e.g. autosave, which must not re-render the editor).
 */
export async function runAction<T>(
  fn: () => Promise<T>,
  { refresh: shouldRefresh = true }: { refresh?: boolean } = {},
): Promise<ActionResult<T>> {
  try {
    const data = await fn();
    if (shouldRefresh) refresh();
    return { ok: true, data };
  } catch (error) {
    if (error instanceof ZodError) {
      return { ok: false, error: error.issues[0]?.message ?? "Please check what you entered." };
    }
    if (error instanceof DomainError) return { ok: false, error: error.message, code: error.code };
    throw error;
  }
}

/** Reads a string field from FormData ("" when missing). */
export function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}
