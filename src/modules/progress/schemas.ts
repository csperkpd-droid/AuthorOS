import { z } from "zod";

import { isDateString, isValidTimeZone } from "@/lib/dates";

export const dateString = z.string().refine(isDateString, "Use a valid date.");

export const timeZoneInput = z.string().refine(isValidTimeZone, "Unknown time zone.");

export const dailyGoalInput = z.preprocess(
  (v) => (v === "" || v === null || v === undefined ? null : Number(v)),
  z
    .number()
    .int("Use a whole number.")
    .min(1, "Use at least 1 word.")
    .max(100_000, "That’s a lot of words. Use 100,000 or fewer.")
    .nullable(),
);

export const writingLogInput = z.object({
  date: dateString,
  words: z.preprocess(
    (v) => Number(v),
    z.number().int("Use a whole number.").min(1, "Log at least 1 word.").max(100_000),
  ),
  bookId: z
    .string()
    .nullish()
    .transform((v) => (v ? v : null))
    .pipe(z.uuid().nullable()),
  minutes: z
    .preprocess(
      (v) => (v === "" || v === null || v === undefined ? null : Number(v)),
      z
        .number()
        .int()
        .min(1)
        .max(24 * 60)
        .nullable(),
    )
    .optional(),
  note: z
    .string()
    .trim()
    .max(500)
    .transform((v) => (v === "" ? null : v))
    .nullish(),
});
export type WritingLogInput = z.input<typeof writingLogInput>;
