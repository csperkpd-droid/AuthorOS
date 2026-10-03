import { z } from "zod";

import { CharacterRole } from "@/generated/prisma/enums";

import { PROFILE_FIELD_IDS } from "./profile";

export const characterInput = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Give the character a name.")
    .max(200, "Keep the name under 200 characters."),
  /** Comma-separated in forms. */
  aliases: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((v) =>
      (Array.isArray(v) ? v : (v ?? "").split(","))
        .map((a) => a.trim())
        .filter(Boolean)
        .slice(0, 20),
    ),
  role: z.enum(CharacterRole).optional(),
  summary: z
    .string()
    .trim()
    .max(2000, "Keep the summary under 2,000 characters.")
    .transform((v) => (v === "" ? null : v))
    .nullish(),
  seriesId: z
    .string()
    .transform((v) => (v === "" ? null : v))
    .pipe(z.uuid().nullable())
    .nullish(),
});
export type CharacterInput = z.input<typeof characterInput>;

export const profileFieldInput = z.object({
  field: z.enum(PROFILE_FIELD_IDS as [string, ...string[]]),
  value: z.string().max(10_000, "That field is too long."),
});
