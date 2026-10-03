import { z } from "zod";

const optionalText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label} must be under ${max.toLocaleString("en-US")} characters.`)
    .transform((v) => (v === "" ? null : v))
    .nullish();

export const connectionDetails = z.object({
  label: optionalText(120, "The label"),
  note: optionalText(2000, "The note"),
  attribute: z.string().max(64).nullish(),
});

export const newConnectionInput = connectionDetails.extend({
  sourceId: z.uuid(),
  targetId: z.uuid(),
  kind: z.string(),
});

export type NewConnectionInput = z.input<typeof newConnectionInput>;
export type ConnectionDetails = z.input<typeof connectionDetails>;
