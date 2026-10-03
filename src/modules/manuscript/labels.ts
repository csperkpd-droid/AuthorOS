import type { SceneStatus } from "@/generated/prisma/enums";

export const SCENE_STATUS_LABELS: Record<SceneStatus, string> = {
  OUTLINED: "Outlined",
  DRAFT: "Draft",
  REVISED: "Revised",
  FINAL: "Final",
};

export const REVISION_SOURCE_LABELS: Record<string, string> = {
  AUTOSAVE: "Autosave checkpoint",
  MANUAL: "Saved version",
  BEFORE_RESTORE: "Before restore",
  AI_ACCEPTED: "Accepted suggestion",
  IMPORT: "Imported",
};
