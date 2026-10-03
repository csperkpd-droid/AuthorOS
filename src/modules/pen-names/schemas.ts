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
  /** BCP 47 tag (e.g. "en"); empty = no language. Absent = unchanged. */
  language: z
    .string()
    .trim()
    .nullish()
    .transform((v) => (v === undefined ? undefined : v ? v : null))
    .refine((v) => v == null || /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(v), "Choose a language."),
});

export type PenNameInput = z.input<typeof penNameInput>;
