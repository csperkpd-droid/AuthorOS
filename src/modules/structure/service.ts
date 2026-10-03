import "server-only";

import { generateNKeysBetween } from "fractional-indexing";

import { Prisma, type StructureKind } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { ConflictError, NotFoundError, RuleError } from "@/lib/errors";
import { planInsertAfter, positionAtEnd, sortByPosition } from "@/lib/ordering";
import { getCharacter, listCharacters } from "@/modules/characters";
import { getBook, listLibrary } from "@/modules/library";
import { getBookTree } from "@/modules/manuscript";
import { getRelationship, listRelationships } from "@/modules/relationships";
import { createStoryNode, liveOutline, liveScene } from "@/modules/story-graph";
import type { AuthorContext } from "@/server/context";

import { STRUCTURE_KIND_LABELS } from "./labels";
import {
  beatInput,
  newOutlineInput,
  outlineTitle,
  type BeatInput,
  type NewOutlineInput,
} from "./schemas";

/**
 * Story structures. An outline is a structure applied to a book (plot,
 * romance arc, character arc, subplot, custom); its beats are assigned to the
 * book's real scenes. Assignments are structural (beat_scenes), many-to-many:
 * one beat may span scenes, one scene may carry beats of many structures, and
 * scenes are never copied.
 */

// ─── Templates ──────────────────────────────────────────────────────────────

/** Built-in templates plus this workspace's own, optionally of one kind. */
export async function listTemplates(ctx: AuthorContext, { kind }: { kind?: StructureKind } = {}) {
  const rows = await db.structureTemplate.findMany({
    where: {
      OR: [{ workspaceId: null }, { workspaceId: ctx.workspaceId }],
      ...(kind ? { kind } : {}),
    },
    orderBy: [{ kind: "asc" }, { name: "asc" }],
    select: {
      id: true,
      kind: true,
      name: true,
      description: true,
      source: true,
      workspaceId: true,
      _count: { select: { beats: true } },
    },
  });
  return rows.map(({ _count, workspaceId, ...t }) => ({
    ...t,
    builtIn: workspaceId === null,
    beatCount: _count.beats,
  }));
}

// ─── Outlines ───────────────────────────────────────────────────────────────

const outlineRefs = {
  book: { select: { id: true, title: true, penNameId: true } },
  relationship: {
    select: {
      id: true,
      characterA: { select: { name: true } },
      characterB: { select: { name: true } },
    },
  },
  character: { select: { id: true, name: true } },
  template: { select: { id: true, name: true, source: true } },
} as const;

async function requireOutline(ctx: AuthorContext, id: string) {
  const outline = await db.outline.findFirst({
    where: { id, workspaceId: ctx.workspaceId, ...liveOutline },
    select: { id: true, bookId: true, kind: true, title: true, ...outlineRefs },
  });
  if (!outline) throw new NotFoundError("Structure");
  return outline;
}

/**
 * Applies a structure to a book. Romance arcs belong to a relationship and
 * character arcs to a character, of the book's identity (and series). With a
 * template, its beats are copied: the outline's beats are then the author's.
 */
export async function createOutline(ctx: AuthorContext, input: NewOutlineInput) {
  const data = newOutlineInput.parse(input);
  const book = await getBook(ctx, data.bookId);

  let relationshipId: string | null = null;
  let characterId: string | null = null;
  let ownerName: string | null = null;
  if (data.kind === "ROMANCE") {
    if (!data.relationshipId)
      throw new RuleError("Choose the relationship this romance arc follows.");
    const rel = await getRelationship(ctx, data.relationshipId);
    const [a] = await db.character.findMany({
      where: { id: rel.characterA.id },
      select: { penNameId: true, seriesId: true },
    });
    assertSameScope(a, book);
    relationshipId = rel.id;
    ownerName = `${rel.characterA.name} & ${rel.characterB.name}`;
  } else if (data.kind === "CHARACTER_ARC") {
    if (!data.characterId) throw new RuleError("Choose the character whose arc this is.");
    const character = await getCharacter(ctx, data.characterId);
    assertSameScope(
      { penNameId: character.penNameId, seriesId: character.series?.id ?? null },
      book,
    );
    characterId = character.id;
    ownerName = character.name;
  }

  const template = data.templateId
    ? await db.structureTemplate.findFirst({
        where: {
          id: data.templateId,
          OR: [{ workspaceId: null }, { workspaceId: ctx.workspaceId }],
        },
        select: {
          id: true,
          kind: true,
          name: true,
          beats: {
            select: {
              id: true,
              title: true,
              description: true,
              targetPercent: true,
              position: true,
            },
          },
        },
      })
    : null;
  if (data.templateId && !template) throw new NotFoundError("Template");
  if (
    template &&
    template.kind !== data.kind &&
    !(data.kind === "SUBPLOT" || data.kind === "CUSTOM")
  ) {
    throw new RuleError("That template is for a different kind of structure.");
  }

  const title =
    data.title?.trim() ||
    [ownerName, template?.name ?? STRUCTURE_KIND_LABELS[data.kind].one].filter(Boolean).join(": ");

  const beats = template ? sortByPosition(template.beats) : [];
  const keys = beats.length ? generateNKeysBetween(null, null, beats.length) : [];

  return db.$transaction(async (tx) => {
    const id = await createStoryNode(tx, ctx.workspaceId, "OUTLINE");
    await tx.outline.create({
      data: {
        id,
        workspaceId: ctx.workspaceId,
        bookId: book.id,
        kind: data.kind,
        title: outlineTitle.parse(title),
        templateId: template?.id ?? null,
        relationshipId,
        characterId,
      },
    });
    if (beats.length) {
      await tx.outlineBeat.createMany({
        data: beats.map((b, i) => ({
          workspaceId: ctx.workspaceId,
          outlineId: id,
          templateBeatId: b.id,
          title: b.title,
          description: b.description,
          targetPercent: b.targetPercent,
          position: keys[i],
        })),
      });
    }
    return { id };
  });
}

function assertSameScope(
  owner: { penNameId: string; seriesId: string | null },
  book: { penName: { id: string }; seriesId: string | null },
) {
  if (owner.penNameId !== book.penName.id) {
    throw new RuleError("That belongs to a different pen name than this book.");
  }
  if (owner.seriesId && owner.seriesId !== book.seriesId) {
    throw new RuleError("That character belongs to a different series than this book.");
  }
}

/** Structures with progress (how many beats are placed in scenes). */
export async function listOutlines(
  ctx: AuthorContext,
  filter: {
    bookId?: string;
    relationshipId?: string;
    characterId?: string;
    penNameId?: string | null;
  } = {},
) {
  const rows = await db.outline.findMany({
    where: {
      workspaceId: ctx.workspaceId,
      ...liveOutline,
      ...(filter.bookId ? { bookId: filter.bookId } : {}),
      ...(filter.relationshipId ? { relationshipId: filter.relationshipId } : {}),
      ...(filter.characterId ? { characterId: filter.characterId } : {}),
      ...(filter.penNameId ? { book: { penNameId: filter.penNameId } } : {}),
    },
    orderBy: [{ book: { title: "asc" } }, { createdAt: "asc" }],
    select: {
      id: true,
      kind: true,
      title: true,
      ...outlineRefs,
      beats: { select: { _count: { select: { scenes: { where: { scene: liveScene } } } } } },
    },
  });
  return rows.map(({ beats, ...o }) => ({
    ...o,
    beatCount: beats.length,
    placedCount: beats.filter((b) => b._count.scenes > 0).length,
  }));
}

/**
 * An outline with its beats in order, each with the scenes it is placed in
 * (in reading order, with where each falls in the book) and the book's scenes
 * for assigning.
 */
export async function getOutline(ctx: AuthorContext, id: string) {
  const outline = await requireOutline(ctx, id);
  const [beats, tree] = await Promise.all([
    db.outlineBeat.findMany({
      where: { outlineId: id },
      select: {
        id: true,
        title: true,
        description: true,
        targetPercent: true,
        position: true,
        scenes: { where: { scene: liveScene }, select: { sceneId: true } },
      },
    }),
    getBookTree(ctx, outline.bookId),
  ]);

  const order = new Map(tree.sceneOrder.map((s, i) => [s.id, i]));
  const total = tree.sceneOrder.length;
  // Where a scene falls in the book: the middle of its slot, as a percentage.
  const percentOf = (sceneId: string) => {
    const i = order.get(sceneId);
    return i === undefined || total === 0 ? null : Math.round(((i + 0.5) / total) * 100);
  };

  return {
    ...outline,
    beats: sortByPosition(beats).map(({ scenes, ...b }) => ({
      ...b,
      scenes: scenes
        .map((s) => s.sceneId)
        .filter((sceneId) => order.has(sceneId))
        .sort((x, y) => order.get(x)! - order.get(y)!)
        .map((sceneId) => {
          const scene = tree.sceneOrder[order.get(sceneId)!];
          return {
            id: sceneId,
            title: scene.title,
            chapterTitle: scene.chapterTitle,
            percent: percentOf(sceneId),
          };
        }),
    })),
    bookScenes: tree.sceneOrder,
  };
}

export async function renameOutline(ctx: AuthorContext, id: string, title: string) {
  await requireOutline(ctx, id);
  await db.outline.update({ where: { id }, data: { title: outlineTitle.parse(title) } });
}

export async function trashOutline(ctx: AuthorContext, id: string) {
  await requireOutline(ctx, id);
  await db.outline.update({ where: { id }, data: { deletedAt: new Date() } });
}

// ─── Beats ──────────────────────────────────────────────────────────────────

async function requireBeat(ctx: AuthorContext, beatId: string) {
  const beat = await db.outlineBeat.findFirst({
    where: { id: beatId, workspaceId: ctx.workspaceId },
    select: { id: true, outlineId: true },
  });
  if (!beat) throw new NotFoundError("Beat");
  const outline = await requireOutline(ctx, beat.outlineId);
  return { ...beat, outline };
}

const beatSiblings = (outlineId: string, exclude?: string) =>
  db.outlineBeat.findMany({
    where: { outlineId, ...(exclude ? { id: { not: exclude } } : {}) },
    select: { id: true, position: true },
  });

export async function addBeat(ctx: AuthorContext, outlineId: string, input: BeatInput) {
  const data = beatInput.parse(input);
  await requireOutline(ctx, outlineId);
  return db.$transaction(async (tx) => {
    // Serialize appends to one outline.
    await tx.$queryRaw`SELECT 1 FROM "outlines" WHERE "id" = ${outlineId}::uuid FOR UPDATE`;
    const siblings = await tx.outlineBeat.findMany({
      where: { outlineId },
      select: { id: true, position: true },
    });
    return tx.outlineBeat.create({
      data: {
        workspaceId: ctx.workspaceId,
        outlineId,
        title: data.title,
        description: data.description ?? null,
        targetPercent: data.targetPercent,
        position: positionAtEnd(siblings),
      },
      select: { id: true },
    });
  });
}

export async function updateBeat(ctx: AuthorContext, beatId: string, input: BeatInput) {
  const data = beatInput.parse(input);
  await requireBeat(ctx, beatId);
  await db.outlineBeat.update({
    where: { id: beatId },
    data: {
      title: data.title,
      description: data.description ?? null,
      targetPercent: data.targetPercent,
    },
  });
}

/** Reorders a beat: place it after `afterBeatId` (null = first). */
export async function moveBeat(ctx: AuthorContext, beatId: string, afterBeatId: string | null) {
  const beat = await requireBeat(ctx, beatId);
  const plan = planInsertAfter(await beatSiblings(beat.outlineId, beatId), afterBeatId);
  await db.$transaction([
    ...plan.rebalanced.map((r) =>
      db.outlineBeat.update({ where: { id: r.id }, data: { position: r.position } }),
    ),
    db.outlineBeat.update({ where: { id: beatId }, data: { position: plan.position } }),
  ]);
}

/** Removes a beat from the outline (its scene placements go with it; scenes are untouched). */
export async function deleteBeat(ctx: AuthorContext, beatId: string) {
  await requireBeat(ctx, beatId);
  await db.outlineBeat.delete({ where: { id: beatId } });
}

// ─── Beat → scene placements ────────────────────────────────────────────────

/** Records that a beat happens in a scene of the outline's book. */
export async function assignScene(ctx: AuthorContext, beatId: string, sceneId: string) {
  const beat = await requireBeat(ctx, beatId);
  const scene = await db.scene.findFirst({
    where: { id: sceneId, workspaceId: ctx.workspaceId, ...liveScene },
    select: { bookId: true },
  });
  if (!scene) throw new NotFoundError("Scene");
  if (scene.bookId !== beat.outline.bookId) {
    throw new RuleError("Beats can only be placed in scenes of this structure’s book.");
  }
  try {
    await db.beatScene.create({ data: { workspaceId: ctx.workspaceId, beatId, sceneId } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new ConflictError("This beat is already placed in that scene.");
    }
    throw error;
  }
}

export async function unassignScene(ctx: AuthorContext, beatId: string, sceneId: string) {
  await requireBeat(ctx, beatId);
  await db.beatScene.deleteMany({ where: { beatId, sceneId, workspaceId: ctx.workspaceId } });
}

/** Every beat, across all structures, that happens in a scene. */
export async function beatsForScene(ctx: AuthorContext, sceneId: string) {
  const rows = await db.beatScene.findMany({
    where: { sceneId, workspaceId: ctx.workspaceId, beat: { outline: liveOutline } },
    select: {
      beat: {
        select: {
          id: true,
          title: true,
          outline: { select: { id: true, title: true, kind: true } },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((r) => ({
    beatId: r.beat.id,
    beatTitle: r.beat.title,
    outlineId: r.beat.outline.id,
    outlineTitle: r.beat.outline.title,
    kind: r.beat.outline.kind,
  }));
}

/**
 * What the "New structure" dialog offers: books, relationships and characters
 * of one identity (null = all), and the templates.
 */
export async function newStructureOptions(
  ctx: AuthorContext,
  { penNameId }: { penNameId: string | null },
) {
  const [library, relationships, characters, templates] = await Promise.all([
    listLibrary(ctx, { penNameId }),
    listRelationships(ctx, { penNameId }),
    listCharacters(ctx, { penNameId }),
    listTemplates(ctx),
  ]);
  return {
    books: [
      ...library.series.flatMap((s) =>
        s.books.map((b) => ({ id: b.id, label: `${b.title} (${s.title})` })),
      ),
      ...library.standalone.map((b) => ({ id: b.id, label: b.title })),
    ],
    relationships: relationships.map((r) => ({
      id: r.id,
      label: `${r.characterA.name} & ${r.characterB.name}`,
    })),
    characters: characters.map((c) => ({ id: c.id, label: c.name })),
    templates,
  };
}
