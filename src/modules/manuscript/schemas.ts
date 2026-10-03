import { z } from "zod";

import { SceneStatus } from "@/generated/prisma/enums";

export const structureTitle = z
  .string()
  .trim()
  .min(1, "Give it a title.")
  .max(200, "Keep the title under 200 characters.");

export const sceneDetailsInput = z.object({
  title: structureTitle.optional(),
  status: z.enum(SceneStatus).optional(),
  synopsis: z
    .string()
    .trim()
    .max(5000, "Keep the synopsis under 5,000 characters.")
    .transform((v) => (v === "" ? null : v))
    .nullish(),
});
export type SceneDetailsInput = z.input<typeof sceneDetailsInput>;
