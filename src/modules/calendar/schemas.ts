import { z } from "zod";

import { isDateString } from "@/lib/dates";

const date = z.string().refine(isDateString, "Use a valid date.");

export const eventInput = z
  .object({
    title: z.string().trim().min(1, "Name the event.").max(300),
    description: z
      .string()
      .trim()
      .max(5000)
      .transform((v) => (v === "" ? null : v))
      .nullish(),
    startsOn: date,
    endsOn: z
      .string()
      .nullish()
      .transform((v) => (v ? v : null))
      .refine((v) => v === null || isDateString(v), "Use a valid date."),
    startTime: z
      .string()
      .nullish()
      .transform((v) => (v ? v : null))
      .refine((v) => v === null || /^([01]\d|2[0-3]):[0-5]\d$/.test(v), "Use a time like 09:30."),
  })
  .refine((v) => v.endsOn === null || v.endsOn >= v.startsOn, {
    message: "The event can’t end before it starts.",
    path: ["endsOn"],
  });
export type EventInput = z.input<typeof eventInput>;

/** "2026-10" */
export const monthInput = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Use a month like 2026-10.");
