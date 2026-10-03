export {
  CHECKPOINT_INTERVAL_MS,
  getRevision,
  listRevisions,
  restoreRevision,
  revisionLabel,
  saveContent,
  saveVersion,
} from "./service";
export type { SaveResult } from "./service";
export { VERSIONED_KINDS, isVersionedKind } from "./versioned";
export type { VersionedKind } from "./versioned";
