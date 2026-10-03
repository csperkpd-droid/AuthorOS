import { z } from "zod";

import { FieldType, StoryNodeKind } from "@/generated/prisma/enums";

export const fieldLabel = z
  .string()
  .trim()
  .min(1, "Name the field.")
  .max(80, "Keep the name under 80 characters.");

export const newFieldInput = z.object({
  nodeKind: z.enum(StoryNodeKind),
  label: fieldLabel,
  type: z.enum(FieldType).default("TEXT"),
  /** Limit the field to one identity; null/absent = every identity. */
  penNameId: z.uuid().nullish(),
});
export type NewFieldInput = z.input<typeof newFieldInput>;

export const fieldValue = z.string().max(10_000, "That value is too long.");
