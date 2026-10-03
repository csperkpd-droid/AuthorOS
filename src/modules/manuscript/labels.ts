import type { SceneStatus } from "@/generated/prisma/enums";

export const SCENE_STATUS_LABELS: Record<SceneStatus, string> = {
  OUTLINED: "Outlined",
  DRAFT: "Draft",
  REVISED: "Revised",
  FINAL: "Final",
};
