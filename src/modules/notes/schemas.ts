import { z } from "zod";

export const noteTitle = z
  .string()
  .trim()
  .min(1, "Give the note a title.")
  .max(200, "Keep the title under 200 characters.");
