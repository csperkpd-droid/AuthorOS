import "server-only";

import { EXPORT_FORMAT, EXPORT_VERSION } from "@/modules/exports";

import { workspaceBundle } from "../bundle";
import { ImportFileError } from "../errors";
import { upgradeBundle } from "../upgrade";
import type { ImportParser } from "./types";

/**
 * AuthorOS JSON ("authoros.workspace", version 1): the export already is a
 * Workspace Bundle, so this checks the envelope and validates every row.
 */
export const parseAuthorOsJson: ImportParser = ({ bytes }) => {
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new ImportFileError(["This file isn’t valid JSON."]);
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ImportFileError(["This file isn’t a Spellbound Draft backup."]);
  }
  const envelope = raw as { format?: unknown; version?: unknown };
  if (envelope.format !== EXPORT_FORMAT) {
    throw new ImportFileError([
      "This file isn’t a Spellbound Draft backup (it has no backup format marker).",
    ]);
  }
  if (typeof envelope.version !== "number" || envelope.version > EXPORT_VERSION) {
    throw new ImportFileError([
      `This backup was made by a newer version of Spellbound Draft (format version ${String(envelope.version)}).`,
    ]);
  }
  const parsed = workspaceBundle.safeParse(raw);
  if (!parsed.success) {
    throw new ImportFileError(
      parsed.error.issues.slice(0, 25).map((issue) => {
        const where = issue.path.map(String).join(".");
        return where ? `${where}: ${issue.message}` : issue.message;
      }),
    );
  }
  // Older versions are upgraded to the current format before anything else.
  const bundle = upgradeBundle(parsed.data);
  return {
    bundle,
    info: {
      sourceLabel: "Spellbound Draft backup",
      description: bundle.kind === "archive" ? "Complete archive" : "Standard backup",
      exportedAt: bundle.exportedAt,
      scopeLabel: bundle.scope.label,
      workspaceName: bundle.workspace.name,
    },
  };
};
