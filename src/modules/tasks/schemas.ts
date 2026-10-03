import { z } from "zod";

import { TaskPriority, TaskStatus } from "@/generated/prisma/enums";
import { isDateString } from "@/lib/dates";

const optionalDate = z
  .string()
  .nullish()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || isDateString(v), "Use a valid date.");

export const taskInput = z.object({
  title: z.string().trim().min(1, "Name the task.").max(300, "Keep it under 300 characters."),
  notes: z
    .string()
    .trim()
    .max(5000)
    .transform((v) => (v === "" ? null : v))
    .nullish(),
  priority: z.enum(TaskPriority).optional(),
  dueOn: optionalDate,
});
export type TaskInput = z.input<typeof taskInput>;

export const taskStatus = z.enum(TaskStatus);
