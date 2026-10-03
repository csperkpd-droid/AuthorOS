import { z } from "zod";

export const penNameInput = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Give the pen name a name.")
    .max(120, "Keep it under 120 characters."),
  bio: z
    .string()
    .trim()
    .max(2000, "Keep the bio under 2,000 characters.")
    .transform((v) => (v === "" ? null : v))
    .nullish(),
});

export type PenNameInput = z.input<typeof penNameInput>;
