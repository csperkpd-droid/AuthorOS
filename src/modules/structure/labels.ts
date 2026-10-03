import type { StructureKind } from "@/generated/prisma/enums";

export const STRUCTURE_KIND_LABELS: Record<StructureKind, { one: string; hint: string }> = {
  PLOT: { one: "Plot", hint: "The main story structure of the book." },
  ROMANCE: { one: "Romance arc", hint: "The arc of one relationship." },
  CHARACTER_ARC: { one: "Character arc", hint: "How one character changes." },
  SUBPLOT: { one: "Subplot", hint: "A secondary storyline." },
  CUSTOM: { one: "Custom", hint: "Your own structure." },
};
