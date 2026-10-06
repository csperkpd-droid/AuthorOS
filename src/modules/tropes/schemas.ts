import { z } from "zod";

/** A trope's name: trimmed, never blank. Unique among live tropes, ignoring case. */
export const tropeName = z
  .string()
  .trim()
  .min(1, "Give the trope a name.")
  .max(200, "Keep the name under 200 characters.");

export const tropeInput = z.object({
  name: tropeName,
  description: z.string().max(20_000).nullable().optional(),
});

/** Adding a trope to something: an existing trope, or one found or created by name. */
export const addTropeInput = z.union([
  z.object({ tropeId: z.uuid() }),
  z.object({ name: tropeName }),
]);

export type TropeInput = z.input<typeof tropeInput>;
export type AddTropeInput = z.input<typeof addTropeInput>;
