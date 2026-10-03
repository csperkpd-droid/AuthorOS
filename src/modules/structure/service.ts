import "server-only";

import { generateNKeysBetween } from "fractional-indexing";

import { Prisma, type ArcRole, type StructureKind } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { ConflictError, NotFoundError, RuleError } from "@/lib/errors";
import { planInsertAfter, positionAtEnd, sortByPosition } from "@/lib/ordering";
import { getCharacter, listCharacters } from "@/modules/characters";
import { getBook, getSeries, listLibrary } from "@/modules/library";
import { getBookTree } from "@/modules/manuscript";
import { getRelationship, listRelationships, relationshipTitle } from "@/modules/relationships";
import { assertReviewed, buildReport } from "@/modules/impact";
import { createStoryNode, liveOutline, liveScene } from "@/modules/story-graph";
import type { AuthorContext } from "@/server/context";
import { assertCan } from "@/server/policy";

import { STRUCTURE_KIND_LABELS } from "./labels";
import {
  beatInput,
  newOutlineInput,
  outlineTitle,
  templateInput,
  type BeatInput,
  type NewOutlineInput,
  type TemplateInput,
} from "./schemas";

/**
 * Story structures. An outline is a structure applied to one book or to a
 * whole series (plot, romance arc, character arc, subplot, custom); its beats
 * are assigned to real scenes (of that book, or of any book in the series).
 * Assignments are structural (beat_scenes), many-to-many: one beat may span
 * scenes (and books), one scene may carry beats of many structures, and
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
      forSeries: true,
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

async function requireOwnTemplate(ctx: AuthorContext, id: string) {
  const template = await db.structureTemplate.findFirst({
    where: { id, workspaceId: ctx.workspaceId },
    select: { id: true },
  });
  if (!template) throw new NotFoundError("Template");
  return template;
}

/**
 * Saves a structure's beats as a reusable template. The template is a copy:
 * later edits to either never affect the other. Beats of a series structure
 * keep which book (1st, 2nd…) they were planned for.
 */
export async function saveAsTemplate(ctx: AuthorContext, outlineId: string, input: TemplateInput) {
  assertCan(ctx, "edit", "structure");
  const prepared = await prepareTemplate(ctx, outlineId, input);
  return db.$transaction((tx) => prepared.insert(tx));
}

/** Reads a structure's beats and returns how to insert them as a template. */
export async function prepareTemplate(ctx: AuthorContext, outlineId: string, input: TemplateInput) {
  const data = templateInput.parse(input);
  const outline = await requireOutline(ctx, outlineId);
  const [beats, seriesBooks] = await Promise.all([
    db.outlineBeat.findMany({
      where: { outlineId },
      select: {
        id: true,
        title: true,
        description: true,
        targetPercent: true,
        position: true,
        bookId: true,
      },
    }),
    outline.seriesId ? seriesBookIds(ctx, outline.seriesId) : Promise.resolve([]),
  ]);
  const ordered = sortByPosition(beats);
  const keys = ordered.length ? generateNKeysBetween(null, null, ordered.length) : [];

  const insert = async (tx: Prisma.TransactionClient) => {
    const template = await tx.structureTemplate.create({
      data: {
        workspaceId: ctx.workspaceId,
        kind: outline.kind,
        name: data.name,
        description: data.description ?? null,
        forSeries: outline.seriesId !== null,
      },
      select: { id: true },
    });
    if (ordered.length) {
      await tx.templateBeat.createMany({
        data: ordered.map((b, i) => {
          const index = b.bookId ? seriesBooks.indexOf(b.bookId) : -1;
          return {
            templateId: template.id,
            title: b.title,
            description: b.description,
            targetPercent: b.targetPercent,
            position: keys[i],
            bookIndex: index >= 0 ? index + 1 : null,
          };
        }),
      });
    }
    return template;
  };
  return { insert };
}

export async function renameTemplate(ctx: AuthorContext, id: string, input: TemplateInput) {
  assertCan(ctx, "edit", "structure");
  const data = templateInput.parse(input);
  await requireOwnTemplate(ctx, id);
  await db.structureTemplate.update({
    where: { id },
    data: { name: data.name, description: data.description ?? null },
  });
}

/**
 * "What will this affect?" for deleting a template: structures made from it
 * keep all their beats (they were copies), and kits that include it lose it.
 */
export async function previewDeleteTemplate(ctx: AuthorContext, id: string) {
  await requireOwnTemplate(ctx, id);
  const template = await db.structureTemplate.findUniqueOrThrow({
    where: { id },
    select: { name: true },
  });
  const [made, kits] = await Promise.all([
    db.outline.findMany({
      where: { workspaceId: ctx.workspaceId, templateId: id },
      select: { id: true, title: true, deletedAt: true },
    }),
    db.templateKit.findMany({
      where: { workspaceId: ctx.workspaceId, items: { some: { templateId: id } } },
      select: { id: true, name: true },
    }),
  ]);
  return buildReport({
    title: `Delete the template “${template.name}”?`,
    description:
      "Structures made from this template are independent copies: they keep all their beats and scene placements.",
    groups: [
      {
        key: "KITS",
        label: "Template kits that include it",
        noun: { one: "kit", many: "kits" },
        effect: "Removed from the kit",
        items: kits.map((k) => ({ id: k.id, title: k.name, href: "/structure/templates" })),
      },
      {
        key: "MADE",
        label: "Structures made from it",
        noun: { one: "structure", many: "structures" },
        effect: "Unchanged; they keep their beats",
        affected: false,
        items: made.map((o) => ({
          id: o.id,
          title: o.title,
          href: `/structure/${o.id}`,
          ...(o.deletedAt ? { note: "in the Trash" } : {}),
        })),
      },
    ],
  });
}

/**
 * Deletes one of the author's templates. Structures made from it keep their
 * beats (they were copies); only the "made from" reference is cleared.
 */
export async function deleteTemplate(ctx: AuthorContext, id: string, token?: string) {
  assertCan(ctx, "manage", "structure");
  await requireOwnTemplate(ctx, id);
  if (token !== undefined && (await previewDeleteTemplate(ctx, id)).token !== token) {
    throw new ConflictError("Where this template is used changed. Review again.");
  }
  await db.structureTemplate.delete({ where: { id } });
}

// ─── Outlines ───────────────────────────────────────────────────────────────

const outlineRefs = {
  book: { select: { id: true, title: true, penNameId: true, seriesId: true } },
  series: { select: { id: true, title: true, penNameId: true } },
  relationship: {
    select: {
      id: true,
      members: { orderBy: { position: "asc" }, select: { character: { select: { name: true } } } },
    },
  },
  character: { select: { id: true, name: true } },
  template: { select: { id: true, name: true, source: true } },
} as const;

async function requireOutline(ctx: AuthorContext, id: string) {
  const outline = await db.outline.findFirst({
    where: { id, workspaceId: ctx.workspaceId, ...liveOutline },
    select: {
      id: true,
      bookId: true,
      seriesId: true,
      kind: true,
      title: true,
      arcRole: true,
      ...outlineRefs,
    },
  });
  if (!outline) throw new NotFoundError("Structure");
  return outline;
}

/** A structure's owning relationship as { id, title }. */
function relationshipRef(
  r: { id: string; members: { character: { name: string } }[] } | null,
): { id: string; title: string } | null {
  return r ? { id: r.id, title: relationshipTitle(r.members.map((m) => m.character.name)) } : null;
}

/** Ids of a series' visible books, in reading order. */
async function seriesBookIds(ctx: AuthorContext, seriesId: string) {
  return (await getSeries(ctx, seriesId)).books.map((b) => b.id);
}

type Scope = { penNameId: string; seriesId: string | null; title: string };

/** The identity (and series) a new structure lives in: its book's, or its series'. */
async function resolveScope(
  ctx: AuthorContext,
  { bookId, seriesId }: { bookId: string | null; seriesId: string | null },
): Promise<Scope> {
  if (bookId) {
    const book = await getBook(ctx, bookId);
    return { penNameId: book.penName.id, seriesId: book.seriesId, title: book.title };
  }
  const series = await getSeries(ctx, seriesId!);
  return { penNameId: series.penName.id, seriesId: series.id, title: series.title };
}

function assertSameScope(owner: { penNameId: string; seriesId: string | null }, scope: Scope) {
  if (owner.penNameId !== scope.penNameId) {
    throw new RuleError("That belongs to a different pen name than this structure’s work.");
  }
  if (owner.seriesId && owner.seriesId !== scope.seriesId) {
    throw new RuleError("That character belongs to a different series.");
  }
}

/**
 * Applies a structure to a book or a whole series. Romance arcs belong to a
 * relationship and character arcs to a character, of the same identity (and
 * series). With a template, its beats are copied: the new structure's beats
 * are the author's own, and the template never changes. A series template's
 * beats are planned for the matching books of the series.
 */
export async function createOutline(ctx: AuthorContext, input: NewOutlineInput) {
  assertCan(ctx, "edit", "structure");
  const prepared = await prepareOutline(ctx, input);
  return db.$transaction((tx) => prepared.insert(tx));
}

/**
 * Validates a new structure (scope, owner, template) and returns how to
 * insert it in a caller's transaction, so several structures (a template
 * kit) can be created together or not at all.
 */
export async function prepareOutline(ctx: AuthorContext, input: NewOutlineInput) {
  const data = newOutlineInput.parse(input);
  const scope = await resolveScope(ctx, data);

  let relationshipId: string | null = null;
  let characterId: string | null = null;
  let ownerName: string | null = null;
  if (data.kind === "ROMANCE") {
    if (!data.relationshipId)
      throw new RuleError("Choose the relationship this romance arc follows.");
    const rel = await getRelationship(ctx, data.relationshipId);
    // Every member must belong to the structure's identity (and series).
    for (const member of rel.members) assertSameScope(member, scope);
    relationshipId = rel.id;
    ownerName = rel.title;
  } else if (data.kind === "CHARACTER_ARC") {
    if (!data.characterId) throw new RuleError("Choose the character whose arc this is.");
    const character = await getCharacter(ctx, data.characterId);
    assertSameScope(
      { penNameId: character.penNameId, seriesId: character.series?.id ?? null },
      scope,
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
              bookIndex: true,
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
  const books = data.seriesId ? await seriesBookIds(ctx, data.seriesId) : [];

  const insert = async (tx: Prisma.TransactionClient) => {
    const id = await createStoryNode(tx, ctx.workspaceId, "OUTLINE");
    await tx.outline.create({
      data: {
        id,
        workspaceId: ctx.workspaceId,
        bookId: data.bookId,
        seriesId: data.seriesId,
        kind: data.kind,
        title: outlineTitle.parse(title),
        templateId: template?.id ?? null,
        relationshipId,
        characterId,
        arcRole: data.kind === "ROMANCE" ? (data.arcRole ?? "MAIN") : null,
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
          bookId: b.bookIndex ? (books[b.bookIndex - 1] ?? null) : null,
        })),
      });
    }
    return { id };
  };
  return { insert };
}

/** Structures with progress (how many beats are placed in scenes). */
export async function listOutlines(
  ctx: AuthorContext,
  filter: {
    /** A book's structures, plus those of its series (which span it). */
    bookId?: string;
    seriesId?: string;
    relationshipId?: string;
    characterId?: string;
    penNameId?: string | null;
  } = {},
) {
  const scoped: Prisma.OutlineWhereInput[] = [];
  if (filter.bookId) {
    const book = await getBook(ctx, filter.bookId);
    scoped.push({
      OR: [{ bookId: book.id }, ...(book.seriesId ? [{ seriesId: book.seriesId }] : [])],
    });
  }
  if (filter.seriesId) {
    scoped.push({ OR: [{ seriesId: filter.seriesId }, { book: { seriesId: filter.seriesId } }] });
  }
  if (filter.penNameId) {
    scoped.push({
      OR: [{ book: { penNameId: filter.penNameId } }, { series: { penNameId: filter.penNameId } }],
    });
  }
  const rows = await db.outline.findMany({
    where: {
      workspaceId: ctx.workspaceId,
      ...liveOutline,
      ...(filter.relationshipId ? { relationshipId: filter.relationshipId } : {}),
      ...(filter.characterId ? { characterId: filter.characterId } : {}),
      AND: [...liveOutline.AND, ...scoped],
    },
    orderBy: [{ createdAt: "asc" }],
    select: {
      id: true,
      kind: true,
      title: true,
      arcRole: true,
      ...outlineRefs,
      beats: { select: { _count: { select: { scenes: { where: { scene: liveScene } } } } } },
    },
  });
  return rows.map(({ beats, relationship, ...o }) => ({
    ...o,
    relationship: relationshipRef(relationship),
    beatCount: beats.length,
    placedCount: beats.filter((b) => b._count.scenes > 0).length,
  }));
}

type SceneRef = {
  id: string;
  title: string;
  chapterTitle: string;
  bookId: string;
  bookTitle: string;
  /** 1-based place of the book in the series (1 for a single book). */
  bookNumber: number;
  /** Where the scene falls in its book, as a percentage. */
  percent: number;
};

/**
 * An outline with its beats in order, each with the scenes it is placed in
 * (in reading order, with where each falls in its book) and the scenes that
 * can be assigned: the book's, or every book's in a series structure.
 */
export async function getOutline(ctx: AuthorContext, id: string) {
  const outline = await requireOutline(ctx, id);
  const bookIds = outline.bookId ? [outline.bookId] : await seriesBookIds(ctx, outline.seriesId!);
  const [beats, trees, books] = await Promise.all([
    db.outlineBeat.findMany({
      where: { outlineId: id },
      select: {
        id: true,
        title: true,
        description: true,
        targetPercent: true,
        position: true,
        bookId: true,
        scenes: { where: { scene: liveScene }, select: { sceneId: true } },
      },
    }),
    Promise.all(bookIds.map((b) => getBookTree(ctx, b))),
    db.book.findMany({ where: { id: { in: bookIds } }, select: { id: true, title: true } }),
  ]);

  const titles = new Map(books.map((b) => [b.id, b.title]));
  // Every scene of the structure's book(s), in reading order across books.
  const sceneOrder: SceneRef[] = trees.flatMap((tree, bookIndex) =>
    tree.sceneOrder.map((s, i) => ({
      ...s,
      bookId: bookIds[bookIndex],
      bookTitle: titles.get(bookIds[bookIndex]) ?? "",
      bookNumber: bookIndex + 1,
      // The middle of the scene's slot in its book.
      percent: Math.round(((i + 0.5) / tree.sceneOrder.length) * 100),
    })),
  );
  const order = new Map(sceneOrder.map((s, i) => [s.id, i]));

  return {
    ...outline,
    relationship: relationshipRef(outline.relationship),
    books: bookIds.map((b, i) => ({ id: b, title: titles.get(b) ?? "", number: i + 1 })),
    beats: sortByPosition(beats).map(({ scenes, ...b }) => ({
      ...b,
      scenes: scenes
        .map((s) => s.sceneId)
        .filter((sceneId) => order.has(sceneId))
        .sort((x, y) => order.get(x)! - order.get(y)!)
        .map((sceneId) => sceneOrder[order.get(sceneId)!]),
    })),
    bookScenes: sceneOrder,
  };
}

export async function renameOutline(ctx: AuthorContext, id: string, title: string) {
  assertCan(ctx, "edit", "structure");
  await requireOutline(ctx, id);
  await db.outline.update({ where: { id }, data: { title: outlineTitle.parse(title) } });
}

/** Main or secondary couple (romance arcs only). */
export async function setArcRole(ctx: AuthorContext, id: string, arcRole: ArcRole) {
  assertCan(ctx, "edit", "structure");
  const outline = await requireOutline(ctx, id);
  if (outline.kind !== "ROMANCE") throw new RuleError("Only romance arcs have a couple role.");
  await db.outline.update({ where: { id }, data: { arcRole } });
}

export async function trashOutline(ctx: AuthorContext, id: string) {
  assertCan(ctx, "edit", "structure");
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

/** The planned book of a beat must be a book of the series structure. */
async function plannedBook(
  ctx: AuthorContext,
  outline: { seriesId: string | null },
  bookId: string | null | undefined,
) {
  if (!bookId) return null;
  if (!outline.seriesId) throw new RuleError("Only series structures plan beats per book.");
  if (!(await seriesBookIds(ctx, outline.seriesId)).includes(bookId)) {
    throw new RuleError("That book isn’t part of this series.");
  }
  return bookId;
}

export async function addBeat(ctx: AuthorContext, outlineId: string, input: BeatInput) {
  assertCan(ctx, "edit", "structure");
  const data = beatInput.parse(input);
  const outline = await requireOutline(ctx, outlineId);
  const bookId = await plannedBook(ctx, outline, data.bookId);
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
        bookId,
        position: positionAtEnd(siblings),
      },
      select: { id: true },
    });
  });
}

export async function updateBeat(ctx: AuthorContext, beatId: string, input: BeatInput) {
  assertCan(ctx, "edit", "structure");
  const data = beatInput.parse(input);
  const beat = await requireBeat(ctx, beatId);
  const bookId =
    data.bookId === undefined ? undefined : await plannedBook(ctx, beat.outline, data.bookId);
  await db.outlineBeat.update({
    where: { id: beatId },
    data: {
      title: data.title,
      description: data.description ?? null,
      targetPercent: data.targetPercent,
      ...(bookId !== undefined && { bookId }),
    },
  });
}

/** Reorders a beat: place it after `afterBeatId` (null = first). */
export async function moveBeat(ctx: AuthorContext, beatId: string, afterBeatId: string | null) {
  assertCan(ctx, "edit", "structure");
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
/** "What will this affect?" for removing a beat: its scene placements go; the scenes stay. */
export async function previewDeleteBeat(ctx: AuthorContext, beatId: string) {
  const beat = await requireBeat(ctx, beatId);
  const [row, placements] = await Promise.all([
    db.outlineBeat.findUniqueOrThrow({ where: { id: beatId }, select: { title: true } }),
    db.beatScene.findMany({
      where: { workspaceId: ctx.workspaceId, beatId },
      select: { scene: { select: { id: true, title: true, bookId: true } } },
    }),
  ]);
  return buildReport({
    title: `Remove the beat “${row.title}”?`,
    description: `The beat is removed from “${beat.outline.title}”. Scenes are never deleted.`,
    groups: [
      {
        key: "PLACEMENTS",
        label: "Scenes placed on this beat",
        noun: { one: "beat placement", many: "beat placements" },
        effect: "Removed; the scenes stay",
        items: placements.map((p) => ({
          id: p.scene.id,
          title: p.scene.title,
          href: `/books/${p.scene.bookId}/scenes/${p.scene.id}`,
        })),
      },
    ],
    extra: [beatId],
  });
}

export async function deleteBeat(ctx: AuthorContext, beatId: string, token?: string) {
  assertCan(ctx, "edit", "structure");
  assertReviewed(await previewDeleteBeat(ctx, beatId), token);
  await db.outlineBeat.delete({ where: { id: beatId } });
}

// ─── Beat → scene placements ────────────────────────────────────────────────

/**
 * Records that a beat happens in a scene: a scene of the structure's book, or
 * of any book in its series.
 */
export async function assignScene(ctx: AuthorContext, beatId: string, sceneId: string) {
  assertCan(ctx, "edit", "structure");
  const beat = await requireBeat(ctx, beatId);
  const scene = await db.scene.findFirst({
    where: { id: sceneId, workspaceId: ctx.workspaceId, ...liveScene },
    select: { bookId: true, book: { select: { seriesId: true } } },
  });
  if (!scene) throw new NotFoundError("Scene");
  const fits = beat.outline.seriesId
    ? scene.book.seriesId === beat.outline.seriesId
    : scene.bookId === beat.outline.bookId;
  if (!fits) {
    throw new RuleError(
      beat.outline.seriesId
        ? "Beats can only be placed in scenes of this series’ books."
        : "Beats can only be placed in scenes of this structure’s book.",
    );
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
  assertCan(ctx, "edit", "structure");
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
          outline: { select: { id: true, title: true, kind: true, seriesId: true } },
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
    seriesWide: r.beat.outline.seriesId !== null,
  }));
}

// ─── Series Romance Center ──────────────────────────────────────────────────

export type RomanceCell = {
  beatId: string;
  title: string;
  outlineId: string;
  /** Placed in at least one scene of this book. */
  placed: boolean;
};

/**
 * Every romance arc in a series, grouped by relationship, as a progression
 * across the series' books: series-wide arcs (beats grouped by planned book,
 * or by where they are placed) and arcs of single books alike. Any number of
 * relationships (main and secondary couples, triangles…) is supported.
 */
export async function seriesRomance(ctx: AuthorContext, seriesId: string) {
  const series = await getSeries(ctx, seriesId);
  const bookIds = series.books.map((b) => b.id);
  const arcs = await db.outline.findMany({
    where: {
      workspaceId: ctx.workspaceId,
      kind: "ROMANCE",
      ...liveOutline,
      AND: [...liveOutline.AND, { OR: [{ seriesId }, { bookId: { in: bookIds } }] }],
    },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      title: true,
      bookId: true,
      seriesId: true,
      arcRole: true,
      relationship: {
        select: {
          id: true,
          type: true,
          members: {
            orderBy: { position: "asc" },
            select: { role: true, character: { select: { id: true, name: true } } },
          },
        },
      },
      beats: {
        select: {
          id: true,
          title: true,
          position: true,
          bookId: true,
          scenes: { where: { scene: liveScene }, select: { scene: { select: { bookId: true } } } },
        },
      },
    },
  });

  const byRelationship = new Map<
    string,
    {
      relationship: NonNullable<(typeof arcs)[number]["relationship"]>;
      arcRole: ArcRole;
      arcs: { id: string; title: string; seriesWide: boolean; bookId: string | null }[];
      /** Beats per book id, in arc then beat order. */
      books: Map<string, RomanceCell[]>;
      unplanned: RomanceCell[];
    }
  >();

  for (const arc of arcs) {
    const rel = arc.relationship!;
    const entry = byRelationship.get(rel.id) ?? {
      relationship: rel,
      arcRole: arc.arcRole ?? "MAIN",
      arcs: [],
      books: new Map(bookIds.map((b) => [b, [] as RomanceCell[]])),
      unplanned: [],
    };
    if (arc.arcRole === "MAIN") entry.arcRole = "MAIN";
    entry.arcs.push({
      id: arc.id,
      title: arc.title,
      seriesWide: arc.seriesId !== null,
      bookId: arc.bookId,
    });
    for (const beat of sortByPosition(arc.beats)) {
      const placedIn = new Set(beat.scenes.map((s) => s.scene.bookId));
      // A beat shows under every book it is placed in; otherwise under its
      // planned book (or, for a single-book arc, that book).
      const targets = placedIn.size
        ? [...placedIn]
        : [beat.bookId ?? arc.bookId].filter((b): b is string => Boolean(b));
      const cell = { beatId: beat.id, title: beat.title, outlineId: arc.id };
      if (targets.length === 0) entry.unplanned.push({ ...cell, placed: false });
      for (const b of targets) entry.books.get(b)?.push({ ...cell, placed: placedIn.has(b) });
    }
    byRelationship.set(rel.id, entry);
  }

  const relationships = [...byRelationship.values()]
    .sort((a, b) => (a.arcRole === b.arcRole ? 0 : a.arcRole === "MAIN" ? -1 : 1))
    .map((r) => {
      const members = r.relationship.members.map((m) => ({ ...m.character, role: m.role }));
      return {
        ...r,
        relationship: {
          id: r.relationship.id,
          type: r.relationship.type,
          members,
          title: relationshipTitle(members.map((m) => m.name)),
        },
        books: series.books.map((b) => ({ bookId: b.id, beats: r.books.get(b.id) ?? [] })),
      };
    });

  return {
    series: { id: series.id, title: series.title, penNameId: series.penName.id },
    books: series.books.map((b, i) => ({ id: b.id, title: b.title, number: i + 1 })),
    relationships,
  };
}

// ─── Pickers ────────────────────────────────────────────────────────────────

/**
 * What the "New structure" dialog offers: books, series, relationships and
 * characters of one identity (null = all), and the templates.
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
    series: library.series
      .filter((s) => s.books.length > 0)
      .map((s) => ({ id: s.id, label: s.title })),
    relationships: relationships.map((r) => ({
      id: r.id,
      label: r.title,
    })),
    characters: characters.map((c) => ({ id: c.id, label: c.name })),
    templates,
  };
}
