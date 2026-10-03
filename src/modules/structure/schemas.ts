import { z } from "zod";

import { StructureKind } from "@/generated/prisma/enums";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Keep it under ${max.toLocaleString("en-US")} characters.`)
    .transform((v) => (v === "" ? null : v))
    .nullish();

export const outlineTitle = z.string().trim().min(1, "Give the structure a name.").max(200);

export const newOutlineInput = z.object({
  bookId: z.uuid(),
  kind: z.enum(StructureKind),
  templateId: z.uuid().nullish(),
  title: z.string().trim().max(200).nullish(),
  relationshipId: z.uuid().nullish(),
  characterId: z.uuid().nullish(),
});
export type NewOutlineInput = z.input<typeof newOutlineInput>;

export const beatInput = z.object({
  title: z.string().trim().min(1, "Give the beat a name.").max(200),
  description: optionalText(5000),
  targetPercent: z.preprocess(
    (v) => (v === "" || v === null || v === undefined ? null : Number(v)),
    z.number().int().min(0, "Use 0–100.").max(100, "Use 0–100.").nullable(),
  ),
});
export type BeatInput = z.input<typeof beatInput>;
