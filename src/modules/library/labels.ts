import type { BookStatus, HeatLevel } from "@/generated/prisma/enums";

export const BOOK_STATUS_LABELS: Record<BookStatus, string> = {
  PLANNING: "Planning",
  DRAFTING: "Drafting",
  REVISING: "Revising",
  COMPLETE: "Complete",
  PUBLISHED: "Published",
};

export const HEAT_LEVEL_LABELS: Record<HeatLevel, string> = {
  CLEAN: "Clean",
  CLOSED_DOOR: "Closed door",
  OPEN_DOOR: "Open door",
  EXPLICIT: "Explicit",
};

export const TROPE_SUGGESTIONS = [
  "Enemies to lovers",
  "Friends to lovers",
  "Second chance",
  "Fake relationship",
  "Forced proximity",
  "Grumpy/sunshine",
  "Only one bed",
  "Slow burn",
  "Small town",
  "Forbidden love",
];
