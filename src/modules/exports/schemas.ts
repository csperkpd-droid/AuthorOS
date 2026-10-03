import { z } from "zod";

export const exportScopeInput = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("current") }),
  z.object({ kind: z.literal("selected"), penNameIds: z.array(z.uuid()).max(50) }),
  z.object({ kind: z.literal("all") }),
]);
export type ExportScopeInput = z.input<typeof exportScopeInput>;

export const EXPORT_FORMATS = ["docx", "markdown", "json"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];
