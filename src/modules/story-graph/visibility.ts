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

/** A relationship is visible while it and every member are. */
export const liveRelationship = {
  deletedAt: null,
  members: { every: { character: { deletedAt: null } } },
} satisfies Prisma.RelationshipWhereInput;

export const liveNote = { deletedAt: null } satisfies Prisma.NoteWhereInput;

export const liveIdea = { deletedAt: null } satisfies Prisma.IdeaWhereInput;

export const liveTrope = { deletedAt: null } satisfies Prisma.TropeWhereInput;

export const liveTask = { deletedAt: null } satisfies Prisma.TaskWhereInput;

/**
 * An event is visible when it isn't trashed and, for a date that belongs to
 * another object (a book's deadline), while that object is visible.
 */
export const liveEvent = {
  deletedAt: null,
  OR: [
    { subjectId: null },
    {
      subject: {
        OR: [
          { book: { is: liveBook } },
          { series: { is: liveSeries } },
          { penName: { isNot: null } },
        ],
      },
    },
  ],
} satisfies Prisma.CalendarEventWhereInput;

/** A structure is visible when its book (or series) and its owner are. */
export const liveOutline = {
  deletedAt: null,
  OR: [{ book: liveBook }, { series: liveSeries }],
  AND: [
    { OR: [{ relationshipId: null }, { relationship: liveRelationship }] },
    { OR: [{ characterId: null }, { character: liveCharacter }] },
  ],
} satisfies Prisma.OutlineWhereInput;

/** A timeline event is visible while it and its book (or series) are. */
export const liveTimelineEvent = {
  deletedAt: null,
  OR: [{ book: liveBook }, { series: liveSeries }],
} satisfies Prisma.TimelineEventWhereInput;
