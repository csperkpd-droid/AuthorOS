import type { StoryNodeKind } from "@/generated/prisma/enums";

/** Display names for every kind of story object (client-safe). */
export const NODE_KIND_LABELS: Record<StoryNodeKind, { one: string; many: string }> = {
  SERIES: { one: "Series", many: "Series" },
  BOOK: { one: "Book", many: "Books" },
  PART: { one: "Part", many: "Parts" },
  CHAPTER: { one: "Chapter", many: "Chapters" },
  SCENE: { one: "Scene", many: "Scenes" },
  CHARACTER: { one: "Character", many: "Characters" },
  RELATIONSHIP: { one: "Relationship", many: "Relationships" },
  NOTE: { one: "Note", many: "Notes" },
  IDEA: { one: "Idea", many: "Ideas" },
};

/** Every node kind, in display order. */
export const NODE_KINDS = Object.keys(NODE_KIND_LABELS) as StoryNodeKind[];
