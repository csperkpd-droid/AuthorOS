import type { Prisma } from "@/generated/prisma/client";

/**
 * When a story object is visible: neither it nor anything containing it is
 * in the Trash. One definition per kind, shared by the library, the Trash and
 * graph resolution.
 */
export const liveSeries = { deletedAt: null } satisfies Prisma.SeriesWhereInput;

export const liveBook = {
  deletedAt: null,
  OR: [{ seriesId: null }, { series: { deletedAt: null } }],
} satisfies Prisma.BookWhereInput;

export const livePart = { deletedAt: null, book: liveBook } satisfies Prisma.PartWhereInput;

export const liveChapter = {
  deletedAt: null,
  book: liveBook,
  OR: [{ partId: null }, { part: { deletedAt: null } }],
} satisfies Prisma.ChapterWhereInput;

export const liveScene = {
  deletedAt: null,
  book: liveBook,
  chapter: { deletedAt: null, OR: [{ partId: null }, { part: { deletedAt: null } }] },
} satisfies Prisma.SceneWhereInput;

export const liveCharacter = { deletedAt: null } satisfies Prisma.CharacterWhereInput;

export const liveRelationship = {
  deletedAt: null,
  characterA: { deletedAt: null },
  characterB: { deletedAt: null },
} satisfies Prisma.RelationshipWhereInput;

export const liveNote = { deletedAt: null } satisfies Prisma.NoteWhereInput;

export const liveIdea = { deletedAt: null } satisfies Prisma.IdeaWhereInput;

export const liveTask = { deletedAt: null } satisfies Prisma.TaskWhereInput;

export const liveEvent = { deletedAt: null } satisfies Prisma.CalendarEventWhereInput;

/** A structure is visible when its book (or series) and its owner are. */
export const liveOutline = {
  deletedAt: null,
  OR: [{ book: liveBook }, { series: liveSeries }],
  AND: [
    { OR: [{ relationshipId: null }, { relationship: liveRelationship }] },
    { OR: [{ characterId: null }, { character: liveCharacter }] },
  ],
} satisfies Prisma.OutlineWhereInput;
