import type { Doc } from "./text";

/**
 * Document format versions (M8). Every stored rich-text document (scene
 * content, note bodies, saved versions) records the format it was written
 * in. When the editor's document model changes (a node type renamed, a new
 * required attribute), bump CURRENT_DOC_FORMAT and add an upgrade step:
 * documents are upgraded when read, never rewritten silently in bulk.
 */
export const CURRENT_DOC_FORMAT = 1;

type Step = (doc: Doc) => Doc;

/** Upgrade steps: UPGRADES[n] turns a format-n document into format n + 1. */
const UPGRADES: Record<number, Step> = {};

/** A document in the current format. Refuses documents from a newer format. */
export function upgradeDoc(doc: Doc, format: number): Doc {
  if (format > CURRENT_DOC_FORMAT)
    throw new Error(`Document format ${format} is newer than this version of Spellbound Draft.`);
  let current = doc;
  for (let f = format; f < CURRENT_DOC_FORMAT; f++) current = UPGRADES[f](current);
  return current;
}
