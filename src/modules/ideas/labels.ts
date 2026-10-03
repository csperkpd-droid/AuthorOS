import type { IdeaStatus } from "@/generated/prisma/enums";

export const IDEA_STATUS_LABELS: Record<IdeaStatus, string> = {
  OPEN: "Open",
  USED: "Used",
  ARCHIVED: "Archived",
};
