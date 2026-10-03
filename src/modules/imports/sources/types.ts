import type { WorkspaceBundle } from "../bundle";

/** What a source reports about the file, shown in the review. */
export type ImportFileInfo = {
  /** e.g. "AuthorOS backup (.json)". */
  sourceLabel: string;
  /** "Standard backup", "Complete archive"… */
  description: string;
  exportedAt: Date | null;
  /** What the file covers ("Entire workspace", a pen name…). */
  scopeLabel: string | null;
  workspaceName: string | null;
};

/**
 * An import source turns a file into a Workspace Bundle. That is all a
 * source does: validation of the bundle, the review and the import itself
 * are shared by every source.
 *
 * Sources for other apps (Scrivener, Plottr, DOCX, EPUB) will generate fresh
 * ids for what they create and leave the rest of the bundle empty.
 */
export type ImportParser = (file: { bytes: Uint8Array; filename: string }) => {
  bundle: WorkspaceBundle;
  info: ImportFileInfo;
};
