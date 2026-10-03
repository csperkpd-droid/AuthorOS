import type { StoryNodeKind } from "@/generated/prisma/enums";

import { STORY_KINDS, STORY_OBJECT_TYPES } from "./kinds";

/** Display names for every kind of story object (client-safe; from the registry). */
export const NODE_KIND_LABELS = Object.fromEntries(
  STORY_KINDS.map((kind) => [kind, STORY_OBJECT_TYPES[kind].label]),
) as Record<StoryNodeKind, { one: string; many: string }>;

/**
 * A relationship's name from its members: "Elara & Kael", or for a group
 * "Elara, Kael & Rowan".
 */
export function relationshipTitle(names: string[]): string {
  if (names.length <= 2) return names.join(" & ");
  return `${names.slice(0, -1).join(", ")} & ${names.at(-1)}`;
}

/** Every node kind, in display order. */
export const NODE_KINDS = STORY_KINDS;
