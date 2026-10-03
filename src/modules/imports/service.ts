import "server-only";

import { createHash } from "node:crypto";

import { db } from "@/lib/db";
import { ConflictError, RuleError } from "@/lib/errors";
import { formatCount } from "@/lib/format";
import type { AuthorContext } from "@/server/context";
import { assertCan } from "@/server/policy";

import { applyPlan } from "./apply";
import { ImportFileError } from "./errors";
import { planImport, type ImportConflict, type ImportCount } from "./plan";
import { importOptions, MAX_IMPORT_BYTES, type ImportOptionsInput } from "./schemas";
import { parserFor } from "./sources/registry";
import type { ImportFileInfo } from "./sources/types";
import { validateBundle } from "./validate";

/**
 * The Import Engine: source → Workspace Bundle → validation → plan → apply.
 *
 * `reviewImport` reads and checks the whole file and describes what an
 * import would create, update, skip or conflict on, without changing
 * anything. `runImport` repeats every step and writes the plan in one
 * transaction, only if it still matches the reviewed one (the token): it
 * imports everything or nothing.
 */

export type ImportFile = { sourceId: string; filename: string; bytes: Uint8Array };

export type ImportReview = {
  file: ImportFileInfo | null;
  options: { ids: "keep" | "new"; existing: "skip" | "replace" };
  /** Why the file can't be imported (nothing else is shown then). */
  errors: string[];
  counts: ImportCount[];
  conflicts: ImportConflict[];
  adjustments: string[];
  summary: string;
  canImport: boolean;
  token: string | null;
};

export type ImportResult = { created: number; updated: number; skipped: number };

function read(file: ImportFile) {
  if (file.bytes.byteLength === 0) throw new ImportFileError(["The file is empty."]);
  if (file.bytes.byteLength > MAX_IMPORT_BYTES)
    throw new ImportFileError(["The file is too large to import (200 MB at most)."]);
  const { bundle, info } = parserFor(file.sourceId)(file);
  const problems = validateBundle(bundle);
  if (problems.length) throw new ImportFileError(problems.slice(0, 25));
  return { bundle, info };
}

const fileHash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

const tokenFor = (bytes: Uint8Array, fingerprint: string) =>
  createHash("sha256")
    .update(`${fileHash(bytes)}:${fingerprint}`)
    .digest("hex")
    .slice(0, 32);

const totals = (counts: ImportCount[]) =>
  counts.reduce(
    (t, c) => ({ create: t.create + c.create, update: t.update + c.update, skip: t.skip + c.skip }),
    { create: 0, update: 0, skip: 0 },
  );

/** Validates the file and describes the import. Read-only. */
export async function reviewImport(
  ctx: AuthorContext,
  file: ImportFile,
  input: ImportOptionsInput = {},
): Promise<ImportReview> {
  assertCan(ctx, "manage", "workspace");
  const options = importOptions.parse(input);
  const empty = { counts: [], conflicts: [], adjustments: [], canImport: false, token: null };
  let parsed;
  try {
    parsed = read(file);
  } catch (error) {
    if (error instanceof ImportFileError)
      return {
        file: null,
        options,
        errors: error.problems,
        summary: "This file can’t be imported. Nothing was changed.",
        ...empty,
      };
    throw error;
  }
  const plan = await planImport(ctx, parsed.bundle, options);
  const t = totals(plan.counts);
  const parts = [
    t.create && `create ${formatCount(t.create, "item")}`,
    t.update && `update ${formatCount(t.update, "item")}`,
    t.skip && `skip ${formatCount(t.skip, "item")} that already exist${t.skip === 1 ? "s" : ""}`,
  ].filter(Boolean);
  const summary = plan.conflicts.length
    ? `${formatCount(
        plan.conflicts.reduce((n, c) => n + c.items.length, 0),
        "conflict",
      )} must be resolved before importing.`
    : t.create + t.update === 0
      ? "Everything in this file is already here. Importing would change nothing."
      : `This import will ${parts.join(", ")}.`;
  const canImport = plan.conflicts.length === 0 && t.create + t.update > 0;
  return {
    file: parsed.info,
    options,
    errors: [],
    counts: plan.counts,
    conflicts: plan.conflicts,
    adjustments: plan.adjustments,
    summary,
    canImport,
    token: canImport ? tokenFor(file.bytes, plan.fingerprint) : null,
  };
}

/**
 * Imports the file as reviewed, in one transaction. Throws (and changes
 * nothing) if the file is invalid, has conflicts, or the plan no longer
 * matches the review.
 */
export async function runImport(
  ctx: AuthorContext,
  file: ImportFile,
  input: ImportOptionsInput & { token: string },
): Promise<ImportResult> {
  assertCan(ctx, "manage", "workspace");
  const options = importOptions.parse(input);
  const { bundle } = read(file);
  return db.$transaction(
    async (tx) => {
      const plan = await planImport(ctx, bundle, options, tx);
      if (plan.conflicts.length)
        throw new RuleError("This file has conflicts. Review it again to see them.");
      if (tokenFor(file.bytes, plan.fingerprint) !== input.token)
        throw new ConflictError(
          "Your workspace changed since this file was reviewed. Review it again before importing.",
        );
      await applyPlan(tx, ctx, plan.ops);
      const t = totals(plan.counts);
      return { created: t.create, updated: t.update, skipped: t.skip };
    },
    { timeout: 10 * 60_000, maxWait: 15_000 },
  );
}
