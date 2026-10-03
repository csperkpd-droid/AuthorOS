import { z } from "zod";

/**
 * ProseMirror/Tiptap document helpers that run on the server, so word counts
 * and search text never depend on what the client claims.
 */
export type DocNode = {
  type: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  content?: DocNode[];
};

export const MAX_DOC_BYTES = 2_000_000;

const nodeSchema: z.ZodType<DocNode> = z.lazy(() =>
  z.object({
    type: z.string().min(1).max(64),
    text: z.string().optional(),
    attrs: z.record(z.string(), z.unknown()).optional(),
    marks: z
      .array(
        z.object({
          type: z.string().min(1).max(64),
          attrs: z.record(z.string(), z.unknown()).optional(),
        }),
      )
      .optional(),
    content: z.array(nodeSchema).optional(),
  }),
);

export const docSchema = z
  .object({ type: z.literal("doc"), content: z.array(nodeSchema).optional() })
  .refine((doc) => JSON.stringify(doc).length <= MAX_DOC_BYTES, {
    message: "This scene is too large to save. Split it into several scenes.",
  });

export type Doc = z.infer<typeof docSchema>;

const INLINE_TYPES = new Set(["text", "hardBreak"]);

/** Plain text of a document: blocks separated by blank lines. */
export function docToText(doc: DocNode | null | undefined): string {
  if (!doc) return "";
  return nodeText(doc).trim();
}

function nodeText(node: DocNode): string {
  if (node.type === "text") return node.text ?? "";
  if (node.type === "hardBreak") return "\n";
  const children = node.content ?? [];
  const inline = children.length > 0 && children.every((c) => INLINE_TYPES.has(c.type));
  return children.map(nodeText).join(inline ? "" : "\n\n");
}

const WORD = /[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu;

/** Counts words the way authors expect: "don't" and "well-known" are one word each. */
export function countWords(text: string): number {
  return text.match(WORD)?.length ?? 0;
}
