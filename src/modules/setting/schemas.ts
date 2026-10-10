import { z } from "zod";

/** A place created from a scene's "Set in" picker. */
export const newPlaceName = z
  .string()
  .trim()
  .min(1, "Give the place a name.")
  .max(200, "Keep the name under 200 characters.");
