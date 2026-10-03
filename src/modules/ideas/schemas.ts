import { z } from "zod";

import { IdeaStatus } from "@/generated/prisma/enums";

export const ideaInput = z.object({
  title: z
    .string()
    .trim()
    .min(1, "Write the idea down first.")
    .max(300, "Keep the headline under 300 characters."),
  body: z
    .string()
    .trim()
    .max(20_000, "That’s a lot for one idea; try a note instead.")
    .transform((v) => (v === "" ? null : v))
    .nullish(),
  status: z.enum(IdeaStatus).optional(),
});
export type IdeaInput = z.input<typeof ideaInput>;
