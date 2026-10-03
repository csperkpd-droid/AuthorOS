import { z } from "zod";

import { ArcRole, StructureKind } from "@/generated/prisma/enums";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Keep it under ${max.toLocaleString("en-US")} characters.`)
    .transform((v) => (v === "" ? null : v))
    .nullish();

const optionalId = z
  .string()
  .nullish()
  .transform((v) => (v ? v : null))
  .pipe(z.uuid().nullable());

export const outlineTitle = z.string().trim().min(1, "Give the structure a name.").max(200);

/** A structure for one book (`bookId`) or a whole series (`seriesId`). */
export const newOutlineInput = z
  .object({
    bookId: optionalId,
    seriesId: optionalId,
    kind: z.enum(StructureKind),
    templateId: optionalId,
    title: z.string().trim().max(200).nullish(),
    relationshipId: optionalId,
    characterId: optionalId,
    arcRole: z.enum(ArcRole).nullish(),
  })
  .refine((v) => (v.bookId === null) !== (v.seriesId === null), {
    message: "Choose a book or a series.",
  });
export type NewOutlineInput = z.input<typeof newOutlineInput>;

export const beatInput = z.object({
  title: z.string().trim().min(1, "Give the beat a name.").max(200),
  description: optionalText(5000),
  targetPercent: z.preprocess(
    (v) => (v === "" || v === null || v === undefined ? null : Number(v)),
    z.number().int().min(0, "Use 0–100.").max(100, "Use 0–100.").nullable(),
  ),
  /** Series structures: the book this beat is planned for. */
  bookId: optionalId.optional(),
});
export type BeatInput = z.input<typeof beatInput>;

export const templateInput = z.object({
  name: z.string().trim().min(1, "Name the template.").max(200),
  description: optionalText(2000),
});
export type TemplateInput = z.input<typeof templateInput>;

export const kitInput = z.object({
  name: z.string().trim().min(1, "Name the kit.").max(200),
  description: optionalText(2000),
  templateIds: z.array(z.uuid()).min(1, "Choose at least one template.").max(30),
});
export type KitInput = z.input<typeof kitInput>;

/**
 * Applying a kit to a book or series. Romance templates apply once per chosen
 * relationship, character-arc templates once per chosen character; choosing
 * none skips that template.
 */
export const applyKitInput = z
  .object({
    kitId: z.uuid(),
    bookId: optionalId,
    seriesId: optionalId,
    owners: z
      .record(
        z.uuid(),
        z.object({
          relationshipIds: z.array(z.uuid()).optional(),
          characterIds: z.array(z.uuid()).optional(),
        }),
      )
      .default({}),
  })
  .refine((v) => (v.bookId === null) !== (v.seriesId === null), {
    message: "Choose a book or a series.",
  });
export type ApplyKitInput = z.input<typeof applyKitInput>;
