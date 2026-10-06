import { z } from "zod";

/** A place in a document (lib/work-place.ts), as stored for Continue Writing. */
export const placeAnchorInput = z.object({
  version: z.number().int().min(0),
  pos: z.number().int().min(0),
  before: z.string().max(200),
  after: z.string().max(200),
  scrollY: z.number().min(0).max(10_000_000),
});
