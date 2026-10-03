import { z } from "zod";

import { FieldType, StoryNodeKind } from "@/generated/prisma/enums";

export const fieldLabel = z
  .string()
  .trim()
  .min(1, "Name the field.")
  .max(80, "Keep the name under 80 characters.");

export const newFieldInput = z
  .object({
    nodeKind: z.enum(StoryNodeKind),
    label: fieldLabel,
    type: z.enum(FieldType).default("TEXT"),
    /**
     * Where the field applies: one pen name, one series, one book, or (none
     * set) every identity. At most one may be given.
     */
    penNameId: z.uuid().nullish(),
    seriesId: z.uuid().nullish(),
    bookId: z.uuid().nullish(),
  })
  .refine((v) => [v.penNameId, v.seriesId, v.bookId].filter(Boolean).length <= 1, {
    message: "Choose one scope for the field.",
  });
export type NewFieldInput = z.input<typeof newFieldInput>;

export const fieldValue = z.string().max(10_000, "That value is too long.");
