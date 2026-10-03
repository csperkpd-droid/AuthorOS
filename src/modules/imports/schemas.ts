import { z } from "zod";

export const importOptions = z.object({
  /** "keep": restore with the original ids. "new": import a copy with new ids. */
  ids: z.enum(["keep", "new"]).default("keep"),
  /** What happens to objects that already exist here. */
  existing: z.enum(["skip", "replace"]).default("skip"),
});

export type ImportOptionsInput = z.input<typeof importOptions>;

/** Largest file accepted, uncompressed. */
export const MAX_IMPORT_BYTES = 200 * 1024 * 1024;
