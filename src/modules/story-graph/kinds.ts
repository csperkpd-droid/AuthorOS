import type { StoryNodeKind } from "@/generated/prisma/enums";

/**
 * The Story Object Registry: the one authoritative definition of every kind
 * of story object. Client-safe (no data access); the server-side adapters
 * that read and write each kind live in `./adapters.ts`, keyed by the same
 * kinds.
 *
 * Every cross-cutting feature reads this instead of keeping its own list of
 * kinds: the resolver and pickers, the Trash, search, connections, custom
 * fields, Change Impact, authorization, export and import. Adding a kind is
 * the enum value, its table (with the two story-node triggers), one entry
 * here, one adapter, and its export/import columns; TypeScript reports every
 * place still missing it.
 *
 * The four layers stay distinct (docs/ARCHITECTURE.md → Story Graph):
 * story objects (`layer`), the structural hierarchy (`hierarchy`), structure
 * and beat placement (`structure`), and universal connections
 * (`connectable`).
 */

/** Where an object belongs, for authorization and for the author's mental model. */
export type StoryArea = "identity" | "manuscript" | "storyBible" | "structure" | "planning";

/**
 * How an object's author identity (pen name) is determined:
 * - `self`: it is a pen name;
 * - `column`: its own `pen_name_id`;
 * - `book`: its book's pen name (parts, chapters, scenes);
 * - `members`: its members' (relationships; members share one pen name);
 * - `owner`: its book's or series' (structures, their beats, timeline events);
 * - `shared`: none; shared by every identity of the workspace.
 */
export type IdentityRule = "self" | "column" | "book" | "members" | "owner" | "shared";

/** The key of a kind's rows in the JSON export and the import bundle. */
export type BundleKey =
  | "penNames"
  | "series"
  | "books"
  | "parts"
  | "chapters"
  | "scenes"
  | "characters"
  | "relationships"
  | "notes"
  | "ideas"
  | "tasks"
  | "calendarEvents"
  | "outlines"
  | "timelineEvents"
  | "tropes"
  | "outlineBeats";

export type StoryObjectType = {
  kind: StoryNodeKind;
  /** Display names ("Structure", "Structures"). */
  label: { one: string; many: string };
  /** In sentences ("3 structures"). */
  noun: { one: string; many: string };
  area: StoryArea;
  identity: IdentityRule;
  /**
   * Structural hierarchy (Series → Book → Part → Chapter → Scene): the kinds
   * that can contain this one, nearest first. Null = not in the hierarchy.
   * Hierarchy links are foreign keys, never connections.
   */
  hierarchy: { parents: StoryNodeKind[] } | null;
  /**
   * Structure: whether it can own structures (books and series own
   * structures, relationships own romance arcs, characters character arcs)
   * and whether it can be placed on beats (scenes only).
   */
  structure: { owner: boolean; placedOnBeats: boolean };
  /** Can take part in universal connections (registry in `connections`). */
  connectable: boolean;
  /** Can carry custom field values. */
  fieldable: boolean;
  /**
   * Search: `text` = full-text over its text (and its title); `title` =
   * matched by title only.
   */
  search: "text" | "title";
  /** Has versioned rich text (history module). */
  versioned: boolean;
  /**
   * What removing it means: `trash` (soft delete, restore, delete forever
   * with Change Impact), `archive` (hidden from choices, never deleted) or
   * `remove` (no Trash of its own: removed by its owner's action, after a
   * Change Impact review; beats, decision 112).
   */
  lifecycle: "trash" | "archive" | "remove";
  /** Moves with its identity when a book or series changes pen name (Change Impact). */
  movesWithIdentity: boolean;
  /** Can have dates of its own on the calendar (deadlines). */
  dated: boolean;
  bundle: BundleKey;
  /** Its table (whose primary key is the story-node id, with the two node triggers). */
  table: string;
};

type Entry = Omit<StoryObjectType, "kind">;

const DEFINITIONS = {
  PEN_NAME: {
    label: { one: "Pen name", many: "Pen names" },
    noun: { one: "pen name", many: "pen names" },
    area: "identity",
    identity: "self",
    hierarchy: null,
    structure: { owner: false, placedOnBeats: false },
    connectable: true,
    fieldable: false,
    search: "title",
    versioned: false,
    lifecycle: "archive",
    movesWithIdentity: false,
    dated: true,
    bundle: "penNames",
    table: "pen_names",
  },
  SERIES: {
    label: { one: "Series", many: "Series" },
    noun: { one: "series", many: "series" },
    area: "manuscript",
    identity: "column",
    hierarchy: { parents: [] },
    structure: { owner: true, placedOnBeats: false },
    connectable: true,
    fieldable: true,
    search: "title",
    versioned: false,
    lifecycle: "trash",
    movesWithIdentity: true,
    dated: true,
    bundle: "series",
    table: "series",
  },
  BOOK: {
    label: { one: "Book", many: "Books" },
    noun: { one: "book", many: "books" },
    area: "manuscript",
    identity: "column",
    hierarchy: { parents: ["SERIES"] },
    structure: { owner: true, placedOnBeats: false },
    connectable: true,
    fieldable: true,
    search: "title",
    versioned: false,
    lifecycle: "trash",
    movesWithIdentity: true,
    dated: true,
    bundle: "books",
    table: "books",
  },
  PART: {
    label: { one: "Part", many: "Parts" },
    noun: { one: "part", many: "parts" },
    area: "manuscript",
    identity: "book",
    hierarchy: { parents: ["BOOK"] },
    structure: { owner: false, placedOnBeats: false },
    connectable: true,
    fieldable: true,
    search: "title",
    versioned: false,
    lifecycle: "trash",
    movesWithIdentity: true,
    dated: false,
    bundle: "parts",
    table: "parts",
  },
  CHAPTER: {
    label: { one: "Chapter", many: "Chapters" },
    noun: { one: "chapter", many: "chapters" },
    area: "manuscript",
    identity: "book",
    hierarchy: { parents: ["PART", "BOOK"] },
    structure: { owner: false, placedOnBeats: false },
    connectable: true,
    fieldable: true,
    search: "title",
    versioned: false,
    lifecycle: "trash",
    movesWithIdentity: true,
    dated: false,
    bundle: "chapters",
    table: "chapters",
  },
  SCENE: {
    label: { one: "Scene", many: "Scenes" },
    noun: { one: "scene", many: "scenes" },
    area: "manuscript",
    identity: "book",
    hierarchy: { parents: ["CHAPTER"] },
    structure: { owner: false, placedOnBeats: true },
    connectable: true,
    fieldable: true,
    search: "text",
    versioned: true,
    lifecycle: "trash",
    movesWithIdentity: true,
    dated: false,
    bundle: "scenes",
    table: "scenes",
  },
  CHARACTER: {
    label: { one: "Character", many: "Characters" },
    noun: { one: "character", many: "characters" },
    area: "storyBible",
    identity: "column",
    hierarchy: null,
    structure: { owner: true, placedOnBeats: false },
    connectable: true,
    fieldable: true,
    search: "text",
    versioned: false,
    lifecycle: "trash",
    movesWithIdentity: true,
    dated: false,
    bundle: "characters",
    table: "characters",
  },
  RELATIONSHIP: {
    label: { one: "Relationship", many: "Relationships" },
    noun: { one: "relationship", many: "relationships" },
    area: "storyBible",
    identity: "members",
    hierarchy: null,
    structure: { owner: true, placedOnBeats: false },
    connectable: true,
    fieldable: true,
    search: "title",
    versioned: false,
    lifecycle: "trash",
    movesWithIdentity: true,
    dated: false,
    bundle: "relationships",
    table: "relationships",
  },
  NOTE: {
    label: { one: "Note", many: "Notes" },
    noun: { one: "note", many: "notes" },
    area: "storyBible",
    identity: "shared",
    hierarchy: null,
    structure: { owner: false, placedOnBeats: false },
    connectable: true,
    fieldable: true,
    search: "text",
    versioned: true,
    lifecycle: "trash",
    movesWithIdentity: false,
    dated: false,
    bundle: "notes",
    table: "notes",
  },
  IDEA: {
    label: { one: "Idea", many: "Ideas" },
    noun: { one: "idea", many: "ideas" },
    area: "storyBible",
    identity: "shared",
    hierarchy: null,
    structure: { owner: false, placedOnBeats: false },
    connectable: true,
    fieldable: true,
    search: "text",
    versioned: false,
    lifecycle: "trash",
    movesWithIdentity: false,
    dated: false,
    bundle: "ideas",
    table: "ideas",
  },
  OUTLINE: {
    label: { one: "Structure", many: "Structures" },
    noun: { one: "structure", many: "structures" },
    area: "structure",
    identity: "owner",
    hierarchy: null,
    structure: { owner: false, placedOnBeats: false },
    connectable: true,
    fieldable: true,
    search: "title",
    versioned: false,
    lifecycle: "trash",
    movesWithIdentity: true,
    dated: false,
    bundle: "outlines",
    table: "outlines",
  },
  TASK: {
    label: { one: "Task", many: "Tasks" },
    noun: { one: "task", many: "tasks" },
    area: "planning",
    identity: "shared",
    hierarchy: null,
    structure: { owner: false, placedOnBeats: false },
    connectable: true,
    fieldable: true,
    search: "title",
    versioned: false,
    lifecycle: "trash",
    movesWithIdentity: false,
    dated: false,
    bundle: "tasks",
    table: "tasks",
  },
  EVENT: {
    label: { one: "Event", many: "Events" },
    noun: { one: "event", many: "events" },
    area: "planning",
    identity: "shared",
    hierarchy: null,
    structure: { owner: false, placedOnBeats: false },
    connectable: true,
    fieldable: true,
    search: "title",
    versioned: false,
    lifecycle: "trash",
    movesWithIdentity: false,
    dated: false,
    bundle: "calendarEvents",
    table: "calendar_events",
  },
  TIMELINE_EVENT: {
    label: { one: "Timeline event", many: "Timeline events" },
    noun: { one: "timeline event", many: "timeline events" },
    area: "storyBible",
    identity: "owner",
    hierarchy: null,
    structure: { owner: false, placedOnBeats: false },
    connectable: true,
    fieldable: false,
    search: "title",
    versioned: false,
    lifecycle: "trash",
    movesWithIdentity: true,
    dated: false,
    bundle: "timelineEvents",
    table: "timeline_events",
  },
  TROPE: {
    label: { one: "Trope", many: "Tropes" },
    noun: { one: "trope", many: "tropes" },
    area: "storyBible",
    identity: "shared",
    hierarchy: null,
    structure: { owner: false, placedOnBeats: false },
    connectable: true,
    fieldable: false,
    search: "title",
    versioned: false,
    lifecycle: "trash",
    movesWithIdentity: false,
    dated: false,
    bundle: "tropes",
    table: "tropes",
  },
  BEAT: {
    label: { one: "Beat", many: "Beats" },
    noun: { one: "beat", many: "beats" },
    area: "structure",
    identity: "owner",
    hierarchy: null,
    structure: { owner: false, placedOnBeats: false },
    connectable: true,
    fieldable: false,
    search: "title",
    versioned: false,
    // Removed from its structure with Change Impact (or with the structure).
    lifecycle: "remove",
    // Goes wherever its structure goes.
    movesWithIdentity: false,
    dated: false,
    bundle: "outlineBeats",
    table: "beats",
  },
} as const satisfies Record<StoryNodeKind, Entry>;

/** Every kind, in display order. */
export const STORY_KINDS = Object.keys(DEFINITIONS) as StoryNodeKind[];

export const STORY_OBJECT_TYPES = Object.fromEntries(
  STORY_KINDS.map((kind) => [kind, { kind, ...DEFINITIONS[kind] } as StoryObjectType]),
) as Record<StoryNodeKind, StoryObjectType>;

export function storyObjectType(kind: StoryNodeKind): StoryObjectType {
  return STORY_OBJECT_TYPES[kind];
}

/** The kinds matching a predicate, in display order. */
export function kindsWhere(test: (type: StoryObjectType) => boolean): StoryNodeKind[] {
  return STORY_KINDS.filter((kind) => test(STORY_OBJECT_TYPES[kind]));
}

/** The kind whose rows an export/import bundle keeps under `key`. */
export function kindForBundleKey(key: BundleKey): StoryNodeKind {
  return STORY_KINDS.find((kind) => STORY_OBJECT_TYPES[kind].bundle === key)!;
}
