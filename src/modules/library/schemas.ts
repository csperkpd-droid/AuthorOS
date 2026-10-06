import { z } from "zod";

import { WritingStatus, HeatLevel } from "@/generated/prisma/enums";

/** Empty form fields become null. */
const optionalText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label} must be under ${max.toLocaleString("en-US")} characters.`)
    .transform((v) => (v === "" ? null : v))
    .nullish();

const title = z
  .string()
  .trim()
  .min(1, "Give it a title.")
  .max(200, "Keep the title under 200 characters.");

export const seriesInput = z.object({
  title,
  description: optionalText(5000, "Description"),
  penNameId: z.uuid().optional(),
});
export type SeriesInput = z.input<typeof seriesInput>;

export const writingStatusValues = Object.values(WritingStatus);

export const bookInput = z.object({
  title,
  subtitle: optionalText(200, "Subtitle"),
  description: optionalText(5000, "Description"),
  writingStatus: z.enum(WritingStatus).optional(),
  targetWordCount: z.preprocess(
    (v) => (v === "" || v === null || v === undefined ? null : Number(v)),
    z
      .number()
      .int("Use a whole number.")
      .min(0, "Use a positive number.")
      .max(10_000_000, "That target is too large.")
      .nullable(),
  ),
  penNameId: z.uuid().optional(),
  heatLevel: z.preprocess((v) => (v === "" ? null : v), z.enum(HeatLevel).nullish()),
});
export type BookInput = z.input<typeof bookInput>;

export const newBookInput = bookInput.partial({ targetWordCount: true }).extend({
  seriesId: z.uuid().nullish(),
});
export type NewBookInput = z.input<typeof newBookInput>;
