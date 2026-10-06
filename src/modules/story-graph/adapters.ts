import "server-only";

import type { Prisma, StoryNodeKind } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import type { AuthorContext } from "@/server/context";

import { relationshipTitle } from "./labels";
import {
  liveBook,
  liveChapter,
  liveCharacter,
  liveEvent,
  liveIdea,
  liveNote,
  liveOutline,
  livePart,
  liveRelationship,
  liveScene,
  liveSeries,
  liveTask,
  liveTimelineEvent,
} from "./visibility";

/**
 * Server-side half of the Story Object Registry (`./kinds.ts`): how each
 * kind is read and, for kinds that use the Trash, trashed and restored.
 * One adapter per kind; `satisfies Record<StoryNodeKind, …>` makes a missing
 * kind a type error, so no feature keeps its own switch over kinds.
 */

/** Enough about any story object to show and link to it, and to check scope. */
export type NodeSummary = {
  id: string;
  kind: StoryNodeKind;
  title: string;
  /** Where it lives or what it is, e.g. "The Long Night › Chapter 3". */
  context: string | null;
  href: string;
  /**
   * The author identity this object belongs to. Null = shared across the
   * workspace's identities (notes, ideas, tasks, events).
   */
  penNameId: string | null;
  /** The series it belongs to, if any. */
  seriesId: string | null;
};

export type Lookup = { ids?: string[]; query?: string; take?: number; penNameId?: string };

/** A trashed item as the Trash lists it. */
export type TrashRow = { id: string; title: string; context: string | null; deletedAt: Date };

type TrashAdapter = {
  /** Items listed in the Trash: deleted, while everything containing them is not. */
  list(ctx: AuthorContext): Promise<TrashRow[]>;
  /** Whether `id` is currently listed in this workspace's Trash. */
  isListed(ctx: AuthorContext, id: string): Promise<boolean>;
  restore(id: string): Promise<void>;
};

export type KindAdapter = {
  /** Visible objects in the workspace (optionally by ids, title query, identity). */
  load(ctx: AuthorContext, lookup: Lookup): Promise<NodeSummary[]>;
  /** Null for kinds that are archived instead (pen names). */
  trash: TrashAdapter | null;
};

const contains = (query?: string) =>
  query ? { contains: query, mode: "insensitive" as const } : undefined;
const trail = (...parts: (string | null | undefined)[]) =>
  parts.filter(Boolean).join(" › ") || null;
const bookScope = { select: { title: true, penNameId: true, seriesId: true } } as const;
const page = (take?: number) => ({ take, orderBy: { updatedAt: "desc" as const } });
const scope = (ctx: AuthorContext, ids?: string[]) => ({
  workspaceId: ctx.workspaceId,
  ...(ids ? { id: { in: ids } } : {}),
});

// ─── Trash: what is listed per kind ─────────────────────────────────────────

const deleted = { deletedAt: { not: null } } as const;
const livePartOf = {
  OR: [{ partId: null }, { part: { deletedAt: null } }],
} satisfies Prisma.ChapterWhereInput;
const trashed = (ctx: AuthorContext) => ({ workspaceId: ctx.workspaceId, ...deleted });
const trashedAt = (r: { deletedAt: Date | null }) => r.deletedAt!;
const restore = { data: { deletedAt: null } } as const;

export const KIND_ADAPTERS = {
  PEN_NAME: {
    async load(ctx, { ids, query, take, penNameId }) {
      const rows = await db.penName.findMany({
        where: {
          ...scope(ctx, ids),
          ...(penNameId ? { id: penNameId } : {}),
          name: contains(query),
        },
        select: { id: true, name: true, archivedAt: true },
        ...page(take),
      });
      return rows.map((r) => ({
        id: r.id,
        kind: "PEN_NAME" as const,
        title: r.name,
        context: r.archivedAt ? "Archived pen name" : "Pen name",
        href: `/identities#pen-${r.id}`,
        penNameId: r.id,
        seriesId: null,
      }));
    },
    trash: null,
  },
  SERIES: {
    async load(ctx, { ids, query, take, penNameId }) {
      const rows = await db.series.findMany({
        where: {
          ...scope(ctx, ids),
          ...liveSeries,
          ...(penNameId ? { penNameId } : {}),
          title: contains(query),
        },
        select: { id: true, title: true, penNameId: true, penName: { select: { name: true } } },
        ...page(take),
      });
      return rows.map((r) => ({
        id: r.id,
        kind: "SERIES" as const,
        title: r.title,
        context: r.penName.name,
        href: `/library/series/${r.id}`,
        penNameId: r.penNameId,
        seriesId: r.id,
      }));
    },
    trash: {
      async list(ctx) {
        const rows = await db.series.findMany({
          where: trashed(ctx),
          select: { id: true, deletedAt: true, title: true, penName: { select: { name: true } } },
        });
        return rows.map((r) => ({
          id: r.id,
          title: r.title,
          context: r.penName.name,
          deletedAt: trashedAt(r),
        }));
      },
      isListed: async (ctx, id) =>
        Boolean(
          await db.series.findFirst({ where: { ...trashed(ctx), id }, select: { id: true } }),
        ),
      restore: async (id) => void (await db.series.update({ where: { id }, ...restore })),
    },
  },
  BOOK: {
    async load(ctx, { ids, query, take, penNameId }) {
      const rows = await db.book.findMany({
        where: {
          ...scope(ctx, ids),
          ...liveBook,
          ...(penNameId ? { penNameId } : {}),
          title: contains(query),
        },
        select: {
          id: true,
          title: true,
          penNameId: true,
          seriesId: true,
          series: { select: { title: true } },
          penName: { select: { name: true } },
        },
        ...page(take),
      });
      return rows.map((r) => ({
        id: r.id,
        kind: "BOOK" as const,
        title: r.title,
        context: r.series?.title ?? r.penName.name,
        href: `/books/${r.id}`,
        penNameId: r.penNameId,
        seriesId: r.seriesId,
      }));
    },
    trash: (() => {
      const where = (ctx: AuthorContext) =>
        ({
          ...trashed(ctx),
          OR: [{ seriesId: null }, { series: { deletedAt: null } }],
        }) satisfies Prisma.BookWhereInput;
      return {
        async list(ctx) {
          const rows = await db.book.findMany({
            where: where(ctx),
            select: {
              id: true,
              deletedAt: true,
              title: true,
              series: { select: { title: true } },
              penName: { select: { name: true } },
            },
          });
          return rows.map((r) => ({
            id: r.id,
            title: r.title,
            context: r.series?.title ?? r.penName.name,
            deletedAt: trashedAt(r),
          }));
        },
        isListed: async (ctx, id) =>
          Boolean(await db.book.findFirst({ where: { ...where(ctx), id }, select: { id: true } })),
        restore: async (id) => void (await db.book.update({ where: { id }, ...restore })),
      } satisfies TrashAdapter;
    })(),
  },
  PART: {
    async load(ctx, { ids, query, take, penNameId }) {
      const rows = await db.part.findMany({
        where: {
          ...scope(ctx, ids),
          ...livePart,
          ...(penNameId ? { book: { penNameId } } : {}),
          title: contains(query),
        },
        select: { id: true, title: true, bookId: true, book: bookScope },
        ...page(take),
      });
      return rows.map((r) => ({
        id: r.id,
        kind: "PART" as const,
        title: r.title,
        context: r.book.title,
        href: `/books/${r.bookId}`,
        penNameId: r.book.penNameId,
        seriesId: r.book.seriesId,
      }));
    },
    trash: (() => {
      const where = (ctx: AuthorContext) =>
        ({ ...trashed(ctx), book: liveBook }) satisfies Prisma.PartWhereInput;
      return {
        async list(ctx) {
          const rows = await db.part.findMany({
            where: where(ctx),
            select: { id: true, deletedAt: true, title: true, book: { select: { title: true } } },
          });
          return rows.map((r) => ({
            id: r.id,
            title: r.title,
            context: r.book.title,
            deletedAt: trashedAt(r),
          }));
        },
        isListed: async (ctx, id) =>
          Boolean(await db.part.findFirst({ where: { ...where(ctx), id }, select: { id: true } })),
        restore: async (id) => void (await db.part.update({ where: { id }, ...restore })),
      } satisfies TrashAdapter;
    })(),
  },
  CHAPTER: {
    async load(ctx, { ids, query, take, penNameId }) {
      const rows = await db.chapter.findMany({
        where: {
          ...scope(ctx, ids),
          ...liveChapter,
          ...(penNameId ? { book: { penNameId } } : {}),
          title: contains(query),
        },
        select: {
          id: true,
          title: true,
          bookId: true,
          book: bookScope,
          part: { select: { title: true } },
        },
        ...page(take),
      });
      return rows.map((r) => ({
        id: r.id,
        kind: "CHAPTER" as const,
        title: r.title,
        context: trail(r.book.title, r.part?.title),
        href: `/books/${r.bookId}`,
        penNameId: r.book.penNameId,
        seriesId: r.book.seriesId,
      }));
    },
    trash: (() => {
      const where = (ctx: AuthorContext) =>
        ({ ...trashed(ctx), book: liveBook, ...livePartOf }) satisfies Prisma.ChapterWhereInput;
      return {
        async list(ctx) {
          const rows = await db.chapter.findMany({
            where: where(ctx),
            select: {
              id: true,
              deletedAt: true,
              title: true,
              book: { select: { title: true } },
              part: { select: { title: true } },
            },
          });
          return rows.map((r) => ({
            id: r.id,
            title: r.title,
            context: trail(r.book.title, r.part?.title),
            deletedAt: trashedAt(r),
          }));
        },
        isListed: async (ctx, id) =>
          Boolean(
            await db.chapter.findFirst({ where: { ...where(ctx), id }, select: { id: true } }),
          ),
        restore: async (id) => void (await db.chapter.update({ where: { id }, ...restore })),
      } satisfies TrashAdapter;
    })(),
  },
  SCENE: {
    async load(ctx, { ids, query, take, penNameId }) {
      const rows = await db.scene.findMany({
        where: {
          ...scope(ctx, ids),
          ...liveScene,
          ...(penNameId ? { book: { penNameId } } : {}),
          title: contains(query),
        },
        select: {
          id: true,
          title: true,
          bookId: true,
          book: bookScope,
          chapter: { select: { title: true } },
        },
        ...page(take),
      });
      return rows.map((r) => ({
        id: r.id,
        kind: "SCENE" as const,
        title: r.title,
        context: trail(r.book.title, r.chapter.title),
        href: `/books/${r.bookId}/scenes/${r.id}`,
        penNameId: r.book.penNameId,
        seriesId: r.book.seriesId,
      }));
    },
    trash: (() => {
      const where = (ctx: AuthorContext) =>
        ({
          ...trashed(ctx),
          book: liveBook,
          chapter: { deletedAt: null, ...livePartOf },
        }) satisfies Prisma.SceneWhereInput;
      return {
        async list(ctx) {
          const rows = await db.scene.findMany({
            where: where(ctx),
            select: {
              id: true,
              deletedAt: true,
              title: true,
              book: { select: { title: true } },
              chapter: { select: { title: true } },
            },
          });
          return rows.map((r) => ({
            id: r.id,
            title: r.title,
            context: trail(r.book.title, r.chapter.title),
            deletedAt: trashedAt(r),
          }));
        },
        isListed: async (ctx, id) =>
          Boolean(await db.scene.findFirst({ where: { ...where(ctx), id }, select: { id: true } })),
        restore: async (id) => void (await db.scene.update({ where: { id }, ...restore })),
      } satisfies TrashAdapter;
    })(),
  },
  CHARACTER: {
    async load(ctx, { ids, query, take, penNameId }) {
      const rows = await db.character.findMany({
        where: {
          ...scope(ctx, ids),
          ...liveCharacter,
          ...(penNameId ? { penNameId } : {}),
          ...(query ? { OR: [{ name: contains(query) }, { aliases: { has: query } }] } : {}),
        },
        select: {
          id: true,
          name: true,
          penNameId: true,
          seriesId: true,
          series: { select: { title: true } },
        },
        ...page(take),
      });
      return rows.map((r) => ({
        id: r.id,
        kind: "CHARACTER" as const,
        title: r.name,
        context: r.series?.title ?? null,
        href: `/characters/${r.id}`,
        penNameId: r.penNameId,
        seriesId: r.seriesId,
      }));
    },
    trash: {
      async list(ctx) {
        const rows = await db.character.findMany({
          where: trashed(ctx),
          select: { id: true, deletedAt: true, name: true },
        });
        return rows.map((r) => ({
          id: r.id,
          title: r.name,
          context: null,
          deletedAt: trashedAt(r),
        }));
      },
      isListed: async (ctx, id) =>
        Boolean(
          await db.character.findFirst({ where: { ...trashed(ctx), id }, select: { id: true } }),
        ),
      restore: async (id) => void (await db.character.update({ where: { id }, ...restore })),
    },
  },
  RELATIONSHIP: {
    async load(ctx, { ids, query, take, penNameId }) {
      const rows = await db.relationship.findMany({
        where: {
          ...scope(ctx, ids),
          ...liveRelationship,
          AND: [
            ...(penNameId ? [{ members: { some: { character: { penNameId } } } }] : []),
            ...(query
              ? [
                  {
                    OR: [
                      { type: contains(query) },
                      { members: { some: { character: { name: contains(query) } } } },
                    ],
                  },
                ]
              : []),
          ],
        },
        select: {
          id: true,
          type: true,
          members: {
            orderBy: { position: "asc" },
            select: { character: { select: { name: true, penNameId: true, seriesId: true } } },
          },
        },
        ...page(take),
      });
      return rows.map((r) => {
        const members = r.members.map((m) => m.character);
        const series = new Set(members.map((m) => m.seriesId));
        return {
          id: r.id,
          kind: "RELATIONSHIP" as const,
          title: relationshipTitle(members.map((m) => m.name)),
          context: r.type,
          href: `/relationships/${r.id}`,
          // Members share one pen name; a series only if they all share it.
          penNameId: members[0]?.penNameId ?? null,
          seriesId: series.size === 1 ? [...series][0] : null,
        };
      });
    },
    trash: (() => {
      // Listed on its own only while all its members are live; otherwise it
      // returns with the trashed character.
      const where = (ctx: AuthorContext) =>
        ({
          ...trashed(ctx),
          members: { every: { character: liveCharacter } },
        }) satisfies Prisma.RelationshipWhereInput;
      return {
        async list(ctx) {
          const rows = await db.relationship.findMany({
            where: where(ctx),
            select: {
              id: true,
              deletedAt: true,
              type: true,
              members: {
                orderBy: { position: "asc" },
                select: { character: { select: { name: true } } },
              },
            },
          });
          return rows.map((r) => ({
            id: r.id,
            title: relationshipTitle(r.members.map((m) => m.character.name)),
            context: r.type,
            deletedAt: trashedAt(r),
          }));
        },
        isListed: async (ctx, id) =>
          Boolean(
            await db.relationship.findFirst({ where: { ...where(ctx), id }, select: { id: true } }),
          ),
        restore: async (id) => void (await db.relationship.update({ where: { id }, ...restore })),
      } satisfies TrashAdapter;
    })(),
  },
  NOTE: {
    async load(ctx, { ids, query, take }) {
      const rows = await db.note.findMany({
        where: { ...scope(ctx, ids), ...liveNote, title: contains(query) },
        select: { id: true, title: true },
        ...page(take),
      });
      return rows.map((r) => ({
        id: r.id,
        kind: "NOTE" as const,
        title: r.title,
        context: null,
        href: `/notes/${r.id}`,
        penNameId: null,
        seriesId: null,
      }));
    },
    trash: {
      async list(ctx) {
        const rows = await db.note.findMany({
          where: trashed(ctx),
          select: { id: true, deletedAt: true, title: true },
        });
        return rows.map((r) => ({ ...r, context: null, deletedAt: trashedAt(r) }));
      },
      isListed: async (ctx, id) =>
        Boolean(await db.note.findFirst({ where: { ...trashed(ctx), id }, select: { id: true } })),
      restore: async (id) => void (await db.note.update({ where: { id }, ...restore })),
    },
  },
  IDEA: {
    async load(ctx, { ids, query, take }) {
      const rows = await db.idea.findMany({
        where: { ...scope(ctx, ids), ...liveIdea, title: contains(query) },
        select: { id: true, title: true },
        ...page(take),
      });
      return rows.map((r) => ({
        id: r.id,
        kind: "IDEA" as const,
        title: r.title,
        context: null,
        href: `/ideas/${r.id}`,
        penNameId: null,
        seriesId: null,
      }));
    },
    trash: {
      async list(ctx) {
        const rows = await db.idea.findMany({
          where: trashed(ctx),
          select: { id: true, deletedAt: true, title: true },
        });
        return rows.map((r) => ({ ...r, context: null, deletedAt: trashedAt(r) }));
      },
      isListed: async (ctx, id) =>
        Boolean(await db.idea.findFirst({ where: { ...trashed(ctx), id }, select: { id: true } })),
      restore: async (id) => void (await db.idea.update({ where: { id }, ...restore })),
    },
  },
  OUTLINE: {
    async load(ctx, { ids, query, take, penNameId }) {
      const rows = await db.outline.findMany({
        where: {
          ...scope(ctx, ids),
          ...liveOutline,
          ...(penNameId
            ? { AND: [{ OR: [{ book: { penNameId } }, { series: { penNameId } }] }] }
            : {}),
          title: contains(query),
        },
        select: {
          id: true,
          title: true,
          seriesId: true,
          book: bookScope,
          series: { select: { title: true, penNameId: true } },
        },
        ...page(take),
      });
      // A structure belongs to a book or to a whole series.
      return rows.map((r) => ({
        id: r.id,
        kind: "OUTLINE" as const,
        title: r.title,
        context: r.book?.title ?? r.series?.title ?? null,
        href: `/structure/${r.id}`,
        penNameId: r.book?.penNameId ?? r.series!.penNameId,
        seriesId: r.book ? r.book.seriesId : r.seriesId,
      }));
    },
    trash: (() => {
      // Listed on its own only while its book (or series) and owner are live.
      const where = (ctx: AuthorContext) =>
        ({
          ...trashed(ctx),
          AND: [
            { OR: [{ book: liveBook }, { series: liveSeries }] },
            { OR: [{ relationshipId: null }, { relationship: liveRelationship }] },
            { OR: [{ characterId: null }, { character: liveCharacter }] },
          ],
        }) satisfies Prisma.OutlineWhereInput;
      return {
        async list(ctx) {
          const rows = await db.outline.findMany({
            where: where(ctx),
            select: {
              id: true,
              deletedAt: true,
              title: true,
              book: { select: { title: true } },
              series: { select: { title: true } },
            },
          });
          return rows.map((r) => ({
            id: r.id,
            title: r.title,
            context: r.book?.title ?? r.series?.title ?? null,
            deletedAt: trashedAt(r),
          }));
        },
        isListed: async (ctx, id) =>
          Boolean(
            await db.outline.findFirst({ where: { ...where(ctx), id }, select: { id: true } }),
          ),
        restore: async (id) => void (await db.outline.update({ where: { id }, ...restore })),
      } satisfies TrashAdapter;
    })(),
  },
  TASK: {
    async load(ctx, { ids, query, take }) {
      const rows = await db.task.findMany({
        where: { ...scope(ctx, ids), ...liveTask, title: contains(query) },
        select: { id: true, title: true, status: true },
        ...page(take),
      });
      return rows.map((r) => ({
        id: r.id,
        kind: "TASK" as const,
        title: r.title,
        context: r.status === "DONE" ? "Done" : null,
        href: `/tasks/${r.id}`,
        penNameId: null,
        seriesId: null,
      }));
    },
    trash: {
      async list(ctx) {
        const rows = await db.task.findMany({
          where: trashed(ctx),
          select: { id: true, deletedAt: true, title: true },
        });
        return rows.map((r) => ({ ...r, context: null, deletedAt: trashedAt(r) }));
      },
      isListed: async (ctx, id) =>
        Boolean(await db.task.findFirst({ where: { ...trashed(ctx), id }, select: { id: true } })),
      restore: async (id) => void (await db.task.update({ where: { id }, ...restore })),
    },
  },
  EVENT: {
    async load(ctx, { ids, query, take }) {
      const rows = await db.calendarEvent.findMany({
        where: { ...scope(ctx, ids), ...liveEvent, title: contains(query) },
        select: {
          id: true,
          title: true,
          startsOn: true,
          purpose: true,
          subjectId: true,
        },
        ...page(take),
      });
      return rows.map((r) => ({
        id: r.id,
        kind: "EVENT" as const,
        title: r.title,
        context:
          (r.purpose === "DEADLINE" ? "Deadline, " : "") + r.startsOn.toISOString().slice(0, 10),
        href: `/calendar/events/${r.id}`,
        penNameId: null,
        seriesId: null,
      }));
    },
    trash: (() => {
      // Deadlines go with their subject; only events of their own are listed.
      const where = (ctx: AuthorContext) =>
        ({ ...trashed(ctx), purpose: "EVENT" }) satisfies Prisma.CalendarEventWhereInput;
      return {
        async list(ctx) {
          const rows = await db.calendarEvent.findMany({
            where: where(ctx),
            select: { id: true, deletedAt: true, title: true },
          });
          return rows.map((r) => ({ ...r, context: null, deletedAt: trashedAt(r) }));
        },
        isListed: async (ctx, id) =>
          Boolean(
            await db.calendarEvent.findFirst({
              where: { ...where(ctx), id },
              select: { id: true },
            }),
          ),
        restore: async (id) => void (await db.calendarEvent.update({ where: { id }, ...restore })),
      } satisfies TrashAdapter;
    })(),
  },
  TIMELINE_EVENT: {
    async load(ctx, { ids, query, take, penNameId }) {
      const rows = await db.timelineEvent.findMany({
        where: {
          ...scope(ctx, ids),
          ...liveTimelineEvent,
          ...(penNameId
            ? { AND: [{ OR: [{ book: { penNameId } }, { series: { penNameId } }] }] }
            : {}),
          title: contains(query),
        },
        select: {
          id: true,
          title: true,
          label: true,
          seriesId: true,
          book: bookScope,
          series: { select: { title: true, penNameId: true } },
        },
        ...page(take),
      });
      // An event belongs to a book's or a whole series' timeline.
      return rows.map((r) => ({
        id: r.id,
        kind: "TIMELINE_EVENT" as const,
        title: r.title,
        context: trail(r.book?.title ?? r.series?.title, r.label),
        href: `/timeline/events/${r.id}`,
        penNameId: r.book?.penNameId ?? r.series!.penNameId,
        seriesId: r.book ? r.book.seriesId : r.seriesId,
      }));
    },
    trash: (() => {
      // Listed on its own only while its book (or series) is live.
      const where = (ctx: AuthorContext) =>
        ({
          ...trashed(ctx),
          OR: [{ book: liveBook }, { series: liveSeries }],
        }) satisfies Prisma.TimelineEventWhereInput;
      return {
        async list(ctx) {
          const rows = await db.timelineEvent.findMany({
            where: where(ctx),
            select: {
              id: true,
              deletedAt: true,
              title: true,
              book: { select: { title: true } },
              series: { select: { title: true } },
            },
          });
          return rows.map((r) => ({
            id: r.id,
            title: r.title,
            context: r.book?.title ?? r.series?.title ?? null,
            deletedAt: trashedAt(r),
          }));
        },
        isListed: async (ctx, id) =>
          Boolean(
            await db.timelineEvent.findFirst({
              where: { ...where(ctx), id },
              select: { id: true },
            }),
          ),
        restore: async (id) => void (await db.timelineEvent.update({ where: { id }, ...restore })),
      } satisfies TrashAdapter;
    })(),
  },
} satisfies Record<StoryNodeKind, KindAdapter>;

export function adapterFor(kind: StoryNodeKind): KindAdapter {
  return KIND_ADAPTERS[kind];
}
