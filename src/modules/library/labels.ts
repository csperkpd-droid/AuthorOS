import type { WritingStatus, HeatLevel } from "@/generated/prisma/enums";

/** Where the writing stands. Publication is per edition (Publishing), never a writing status. */
export const WRITING_STATUS_LABELS: Record<WritingStatus, string> = {
  IDEA: "Idea",
  PLANNING: "Planning",
  DRAFTING: "Drafting",
  DRAFTED: "Drafted",
  REVISING: "Revising",
  EDITING: "Editing",
  PROOFREADING: "Proofreading",
  COMPLETE: "Complete",
};

export const HEAT_LEVEL_LABELS: Record<HeatLevel, string> = {
  CLEAN: "Clean",
  CLOSED_DOOR: "Closed door",
  OPEN_DOOR: "Open door",
  EXPLICIT: "Explicit",
};
