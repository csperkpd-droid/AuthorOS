import type { BookStatus } from "@/generated/prisma/enums";

export const BOOK_STATUS_LABELS: Record<BookStatus, string> = {
  PLANNING: "Planning",
  DRAFTING: "Drafting",
  REVISING: "Revising",
  COMPLETE: "Complete",
  PUBLISHED: "Published",
};
