import { z } from "zod";

import { ANCHOR_CONTEXT, MAX_QUOTE } from "@/lib/anchors";

export const commentBody = z
  .string()
  .trim()
  .min(1, "Write the comment first.")
  .max(5000, "Keep the comment under 5,000 characters.");

/**
 * A passage the author selected: offsets in the editor's plain text of the
 * document as saved at `version`, the exact quote and its context.
 */
export const anchorInput = z
  .object({
    version: z.number().int().min(0),
    start: z.number().int().min(0),
    end: z.number().int().min(1),
    quote: z
      .string()
      .min(1, "Select some text first.")
      .max(MAX_QUOTE, "Select a shorter passage (up to 2,000 characters)."),
    prefix: z.string().max(ANCHOR_CONTEXT).default(""),
    suffix: z.string().max(ANCHOR_CONTEXT).default(""),
  })
  .refine((a) => a.end - a.start === a.quote.length, "That selection doesn’t match its text.");
export type AnchorInput = z.input<typeof anchorInput>;

export const newCommentInput = z
  .object({
    version: z.number().int().min(0),
    start: z.number().int().min(0),
    end: z.number().int().min(1),
    quote: z
      .string()
      .min(1, "Select some text first.")
      .max(MAX_QUOTE, "Select a shorter passage (up to 2,000 characters)."),
    prefix: z.string().max(ANCHOR_CONTEXT).default(""),
    suffix: z.string().max(ANCHOR_CONTEXT).default(""),
    body: commentBody,
  })
  .refine((a) => a.end - a.start === a.quote.length, "That selection doesn’t match its text.");
export type NewCommentInput = z.input<typeof newCommentInput>;
