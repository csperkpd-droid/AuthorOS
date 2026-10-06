import { z } from "zod";

import {
  ArcRole,
  WritingStatus,
  CalendarPurpose,
  CharacterRole,
  FieldType,
  HeatLevel,
  IdeaStatus,
  KitItemType,
  RevisionSource,
  SceneStatus,
  StoryNodeKind,
  StructureKind,
  TaskPriority,
  TaskStatus,
  WritingSource,
} from "@/generated/prisma/enums";
import { docSchema } from "@/lib/text";

/**
 * The Workspace Bundle: the one shape every import source produces.
 *
 * An AuthorOS JSON export already is a bundle; future sources (Scrivener,
 * Plottr, DOCX, EPUB…) convert their files into one. Planning and applying
 * an import only ever sees a bundle, so they don't depend on the source.
 *
 * Only known columns are read (anything else in the file is ignored), every
 * value is checked, and derived values (plain text, word counts, member
 * keys) are recomputed on import rather than trusted.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const id = z
  .string()
  .regex(UUID, "Not a valid id.")
  .transform((v) => v.toLowerCase());
const ref = id
  .nullable()
  .optional()
  .transform((v) => v ?? null);

const date = z.coerce.date().refine((d) => !Number.isNaN(d.getTime()), "Not a valid date.");
const optDate = date
  .nullable()
  .optional()
  .transform((v) => v ?? null);
const stamp = date.optional().transform((v) => v ?? new Date());

const str = (max: number) => z.string().max(max);
const title = (max = 300) => z.string().trim().min(1).max(max);
const optStr = (max: number) =>
  z
    .string()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => v ?? null);
const position = z.string().min(1).max(100);
const int = (min = 0, max = 2_000_000_000) => z.number().int().min(min).max(max);
const optInt = (min = 0, max = 2_000_000_000) =>
  int(min, max)
    .nullable()
    .optional()
    .transform((v) => v ?? null);
const doc = docSchema
  .nullable()
  .optional()
  .transform((v) => v ?? null);
const list = <T extends z.ZodType>(item: T, max = 200_000) =>
  z.array(item).max(max).optional().default([]);
const stringMap = z
  .record(z.string().max(100), z.string().max(10_000))
  .refine((r) => Object.keys(r).length <= 200, "Too many entries.");

const softDeleted = {
  createdAt: stamp,
  updatedAt: stamp,
  deletedAt: optDate,
};

export const bundlePenName = z.object({
  id,
  name: title(120),
  bio: optStr(2000),
  isDefault: z.boolean().optional().default(false),
  language: z
    .string()
    .regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/, "Not a language code.")
    .nullable()
    .optional()
    .transform((v) => v ?? null),
  createdAt: stamp,
  updatedAt: stamp,
  archivedAt: optDate,
});

const series = z.object({
  id,
  penNameId: id,
  title: title(),
  description: optStr(20_000),
  ...softDeleted,
});

const book = z.object({
  id,
  penNameId: id,
  seriesId: ref,
  seriesPosition: optStr(40),
  title: title(),
  subtitle: optStr(500),
  description: optStr(20_000),
  writingStatus: z.enum(WritingStatus).optional().default("PLANNING"),
  /** Version 1–2 files only: the old status, publication included (see upgrade.ts). */
  status: z.string().max(40).optional(),
  targetWordCount: optInt(0, 10_000_000),
  /** Before version 6 only: book tropes as text (upgraded into Trope objects). */
  tropes: z.array(str(200)).max(100).optional().default([]),
  heatLevel: z
    .enum(HeatLevel)
    .nullable()
    .optional()
    .transform((v) => v ?? null),
  /** Version 1 files only: becomes the book's deadline entry (see upgrade.ts). */
  dueOn: optDate,
  ...softDeleted,
});

const part = z.object({ id, bookId: id, title: title(), position, ...softDeleted });

const chapter = z.object({
  id,
  bookId: id,
  partId: ref,
  title: title(),
  position,
  ...softDeleted,
});

const scene = z.object({
  id,
  bookId: id,
  chapterId: id,
  title: title(),
  position,
  status: z.enum(SceneStatus).optional().default("DRAFT"),
  synopsis: optStr(20_000),
  content: doc,
  contentFormat: int(1, 1000).optional().default(1),
  version: int().optional().default(0),
  ...softDeleted,
});

const character = z.object({
  id,
  penNameId: id,
  seriesId: ref,
  name: title(200),
  aliases: z.array(str(200)).max(100).optional().default([]),
  role: z.enum(CharacterRole).optional().default("SUPPORTING"),
  summary: optStr(20_000),
  profile: stringMap.optional().default({}),
  ...softDeleted,
});

const relationship = z.object({
  id,
  type: title(120),
  description: optStr(20_000),
  members: z
    .array(
      z.object({
        characterId: id,
        position: int(0, 1000),
        role: z
          .string()
          .trim()
          .max(60)
          .nullable()
          .optional()
          .transform((v) => (v ? v : null)),
      }),
    )
    .max(100),
  ...softDeleted,
});

const note = z.object({
  id,
  title: title(),
  body: doc,
  bodyFormat: int(1, 1000).optional().default(1),
  version: int().optional().default(0),
  ...softDeleted,
});

const idea = z.object({
  id,
  title: title(),
  body: optStr(50_000),
  status: z.enum(IdeaStatus).optional().default("OPEN"),
  ...softDeleted,
});

const task = z.object({
  id,
  title: title(),
  notes: optStr(20_000),
  status: z.enum(TaskStatus).optional().default("TODO"),
  priority: z.enum(TaskPriority).optional().default("NORMAL"),
  dueOn: optDate,
  completedAt: optDate,
  ...softDeleted,
});

const calendarEvent = z.object({
  id,
  title: title(),
  description: optStr(20_000),
  startsOn: date,
  endsOn: optDate,
  startTime: z
    .string()
    .regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/, "Not a time (HH:MM).")
    .nullable()
    .optional()
    .transform((v) => v ?? null),
  /** Version 2: a date of its own, or one that belongs to `subjectId` (a deadline). */
  purpose: z.enum(CalendarPurpose).optional().default("EVENT"),
  subjectId: ref,
  ...softDeleted,
});

const connection = z.object({
  id,
  sourceId: id,
  targetId: id,
  kind: z.string().regex(/^[a-z][a-z_]{0,62}$/, "Not a connection kind."),
  label: optStr(500),
  note: optStr(20_000),
  attributes: stringMap.optional().default({}),
  createdAt: stamp,
  updatedAt: stamp,
});

const outline = z.object({
  id,
  bookId: ref,
  seriesId: ref,
  kind: z.enum(StructureKind),
  title: title(),
  templateId: ref,
  relationshipId: ref,
  characterId: ref,
  arcRole: z
    .enum(ArcRole)
    .nullable()
    .optional()
    .transform((v) => v ?? null),
  ...softDeleted,
});

const percent = optInt(0, 100);

const outlineBeat = z.object({
  id,
  outlineId: id,
  templateBeatId: ref,
  title: title(),
  description: optStr(20_000),
  targetPercent: percent,
  position,
  bookId: ref,
  createdAt: stamp,
  updatedAt: stamp,
});

const beatScene = z.object({ beatId: id, sceneId: id, createdAt: stamp });

/** Something that happens in the story world (Story Time, version 5). */
const timelineEvent = z.object({
  id,
  bookId: ref,
  seriesId: ref,
  title: title(),
  description: optStr(20_000),
  label: optStr(200),
  position,
  ...softDeleted,
});

/** A trope (version 6): shared, linked by `uses_trope` connections. */
const trope = z.object({
  id,
  name: title(200),
  description: optStr(20_000),
  ...softDeleted,
});

/** A scene's place in Story Time (version 5). */
const sceneStoryTime = z.object({
  sceneId: id,
  position,
  label: optStr(200),
  createdAt: stamp,
  updatedAt: stamp,
});

/** A character in a scene (Scene Participation, version 4). */
const sceneParticipation = z.object({
  sceneId: id,
  characterId: id,
  presence: z.enum(["PRESENT", "MENTIONED"]).optional().default("PRESENT"),
  isPov: z.boolean().optional().default(false),
  createdAt: stamp,
  updatedAt: stamp,
});

const structureTemplate = z.object({
  id,
  kind: z.enum(StructureKind),
  name: title(),
  description: optStr(20_000),
  source: optStr(500),
  forSeries: z.boolean().optional().default(false),
  createdAt: stamp,
  updatedAt: stamp,
  beats: z
    .array(
      z.object({
        id,
        title: title(),
        description: optStr(20_000),
        targetPercent: percent,
        position,
        bookIndex: optInt(1, 1000),
      }),
    )
    .max(1000),
});

const builtInTemplate = z.object({ id, kind: z.enum(StructureKind), name: str(300) });

const templateKit = z.object({
  id,
  name: title(),
  description: optStr(20_000),
  createdAt: stamp,
  updatedAt: stamp,
  items: z
    .array(
      z.object({
        id,
        itemType: z.enum(KitItemType).optional().default("STRUCTURE"),
        templateId: id,
        position: int(0, 10_000),
      }),
    )
    .max(100),
});

const fieldDefinition = z.object({
  id,
  penNameId: ref,
  seriesId: ref,
  bookId: ref,
  nodeKind: z.enum(StoryNodeKind),
  label: title(80),
  type: z.enum(FieldType).optional().default("TEXT"),
  position,
  createdAt: stamp,
});

const fieldValue = z.object({
  nodeId: id,
  fieldId: id,
  value: str(10_000),
  updatedAt: stamp,
});

const writingSession = z.object({
  id,
  bookId: ref,
  date,
  source: z.enum(WritingSource),
  wordsAdded: int(0, 10_000_000),
  wordsRemoved: int(0, 10_000_000),
  minutes: optInt(0, 100_000),
  note: optStr(2000),
  createdAt: stamp,
  updatedAt: stamp,
});

const contentRevision = z.object({
  id,
  nodeId: id,
  content: doc,
  contentFormat: int(1, 1000).optional().default(1),
  source: z.enum(RevisionSource),
  label: optStr(500),
  createdAt: stamp,
});

/** Earlier values of long-form text fields (Complete archive, version 3). */
const fieldRevision = z.object({
  id,
  nodeId: id,
  field: z.string().min(1).max(200),
  value: str(100_000),
  source: z.enum(RevisionSource),
  createdAt: stamp,
});

export const workspaceBundle = z.object({
  /** Format version of the file (upgraded to the current one after parsing). */
  version: z.number().int().min(1).max(6),
  /** "standard" backups have no version history; "archive" ones do. */
  kind: z.enum(["standard", "archive"]).optional().default("standard"),
  exportedAt: optDate,
  scope: z
    .object({ label: str(500).optional() })
    .optional()
    .transform((v) => ({ label: v?.label ?? null })),
  workspace: z
    .object({ name: str(500).optional() })
    .optional()
    .transform((v) => ({ name: v?.name ?? null })),
  settings: z
    .object({ dailyWordGoal: optInt(1, 100_000) })
    .optional()
    .transform((v) => ({ dailyWordGoal: v?.dailyWordGoal ?? null })),
  penNames: list(bundlePenName, 1000),
  storyNodes: list(z.object({ id, kind: z.enum(StoryNodeKind) })),
  series: list(series),
  books: list(book),
  parts: list(part),
  chapters: list(chapter),
  scenes: list(scene),
  characters: list(character),
  relationships: list(relationship),
  notes: list(note),
  ideas: list(idea),
  tasks: list(task),
  calendarEvents: list(calendarEvent),
  connections: list(connection, 1_000_000),
  outlines: list(outline),
  outlineBeats: list(outlineBeat),
  beatScenes: list(beatScene, 1_000_000),
  sceneParticipations: list(sceneParticipation, 1_000_000),
  timelineEvents: list(timelineEvent),
  tropes: list(trope),
  sceneStoryTimes: list(sceneStoryTime, 1_000_000),
  structureTemplates: list(structureTemplate, 10_000),
  builtInTemplates: list(builtInTemplate, 10_000),
  templateKits: list(templateKit, 10_000),
  fieldDefinitions: list(fieldDefinition, 10_000),
  fieldValues: list(fieldValue, 1_000_000),
  writingSessions: list(writingSession, 1_000_000),
  contentRevisions: list(contentRevision, 1_000_000),
  fieldRevisions: list(fieldRevision, 1_000_000),
});

export type WorkspaceBundle = z.output<typeof workspaceBundle>;
