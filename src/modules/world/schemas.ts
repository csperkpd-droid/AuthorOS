import { z } from "zod";

const name = z
  .string()
  .trim()
  .min(1, "Give it a name.")
  .max(200, "Keep the name under 200 characters.");

const summary = z
  .string()
  .trim()
  .max(2000, "Keep the summary under 2,000 characters.")
  .transform((v) => (v === "" ? null : v))
  .nullish();

const home = {
  /** The identity for an object outside any series. */
  penNameId: z.uuid().optional(),
  seriesId: z
    .string()
    .transform((v) => (v === "" ? null : v))
    .pipe(z.uuid().nullable())
    .nullish(),
};

export const placeInput = z.object({ name, summary, ...home });
export type PlaceInput = z.input<typeof placeInput>;

/**
 * What a world entry is, in the author's own words ("Organization", "Item",
 * "Guild"…). Free text, never parsed.
 */
export const entryType = z
  .string()
  .trim()
  .min(1, "Say what it is (for example Organization or Item).")
  .max(60, "Keep the type under 60 characters.");

export const worldEntryInput = z.object({ name, entryType, summary, ...home });
export type WorldEntryInput = z.input<typeof worldEntryInput>;
