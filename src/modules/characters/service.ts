import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { assertNotStale, staleError, type EditGuard } from "@/lib/concurrency";
import { NotFoundError, RuleError } from "@/lib/errors";
import { getPenNameForNewWork, requireAssignablePenName } from "@/modules/pen-names";
import { createStoryNode, liveCharacter, liveScene, liveSeries } from "@/modules/story-graph";
import type { AuthorContext } from "@/server/context";
import { recordFieldHistory } from "@/modules/history";
import { assertCan } from "@/server/policy";

import { characterInput, profileFieldInput, type CharacterInput } from "./schemas";

const characterSelect = {
  id: true,
  name: true,
  aliases: true,
  role: true,
  summary: true,
  profile: true,
  updatedAt: true,
  penNameId: true,
  penName: { select: { id: true, name: true } },
  series: { select: { id: true, title: true } },
} as const;

export type CharacterSummary = Omit<
  Prisma.CharacterGetPayload<{ select: typeof characterSelect }>,
  "profile"
> & { profile: Record<string, string> };

const asProfile = (value: Prisma.JsonValue): Record<string, string> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (Object.fromEntries(Object.entries(value).filter(([, v]) => typeof v === "string")) as Record<
        string,
        string
      >)
    : {};

/**
 * Characters with how many scenes each appears in. With `penNameId`, only
 * that identity's characters (identities are private from each other);
 * null = every identity ("All identities").
 */
export async function listCharacters(
  ctx: AuthorContext,
  { penNameId = null }: { penNameId?: string | null } = {},
) {
  const rows = await db.character.findMany({
    where: { workspaceId: ctx.workspaceId, ...liveCharacter, ...(penNameId ? { penNameId } : {}) },
    orderBy: { name: "asc" },
    select: characterSelect,
  });
  const appearances = await db.connection.groupBy({
    by: ["sourceId"],
    where: {
      workspaceId: ctx.workspaceId,
      kind: "appears_in",
      sourceId: { in: rows.map((r) => r.id) },
      // Scenes in the Trash don't count.
      target: { scene: liveScene },
    },
    _count: true,
  });
  const counts = new Map(appearances.map((a) => [a.sourceId, a._count]));
  return rows.map((r) => ({
    ...r,
    profile: asProfile(r.profile),
    sceneCount: counts.get(r.id) ?? 0,
  }));
}

export async function getCharacter(ctx: AuthorContext, id: string): Promise<CharacterSummary> {
  const row = await db.character.findFirst({
    where: { id, workspaceId: ctx.workspaceId, ...liveCharacter },
    select: characterSelect,
  });
  if (!row) throw new NotFoundError("Character");
  return { ...row, profile: asProfile(row.profile) };
}

async function requireSeries(ctx: AuthorContext, seriesId: string) {
  const series = await db.series.findFirst({
    where: { id: seriesId, workspaceId: ctx.workspaceId, ...liveSeries },
    select: { id: true, penNameId: true },
  });
  if (!series) throw new NotFoundError("Series");
  return series;
}

/**
 * Where a character lives: its identity, and optionally a series of that
 * identity. A series decides the identity; otherwise the given pen name, else
 * the one the author is writing as (or the default).
 */
async function resolveHome(
  ctx: AuthorContext,
  { seriesId, penNameId }: { seriesId?: string | null; penNameId?: string },
) {
  if (seriesId) {
    const series = await requireSeries(ctx, seriesId);
    if (penNameId && penNameId !== series.penNameId) {
      throw new RuleError("A series’ characters belong to the series’ pen name.");
    }
    return { seriesId: series.id, penNameId: series.penNameId };
  }
  const pen = penNameId
    ? await requireAssignablePenName(ctx, penNameId)
    : await getPenNameForNewWork(ctx);
  return { seriesId: null, penNameId: pen.id };
}

export async function createCharacter(ctx: AuthorContext, input: CharacterInput) {
  assertCan(ctx, "edit", "storyBible");
  const data = characterInput.parse(input);
  const home = await resolveHome(ctx, { seriesId: data.seriesId, penNameId: data.penNameId });
  return db.$transaction(async (tx) => {
    const id = await createStoryNode(tx, ctx.workspaceId, "CHARACTER");
    return tx.character.create({
      data: {
        id,
        workspaceId: ctx.workspaceId,
        ...home,
        name: data.name,
        aliases: data.aliases,
        role: data.role,
        summary: data.summary ?? null,
      },
      select: { id: true },
    });
  });
}

/**
 * Updates a character. Its series may change within its identity; its
 * identity may only change while nothing links it to other work (scenes,
 * relationships, arcs), so no information crosses identities.
 */
export async function updateCharacter(
  ctx: AuthorContext,
  id: string,
  input: CharacterInput,
  guard: EditGuard = {},
) {
  assertCan(ctx, "edit", "storyBible");
  const data = characterInput.parse(input);
  const current = await getCharacter(ctx, id);
  const home = await resolveHome(ctx, {
    seriesId: data.seriesId,
    penNameId: data.penNameId ?? (data.seriesId ? undefined : current.penNameId),
  });
  if (home.penNameId !== current.penNameId && (await isLinked(id))) {
    throw new RuleError(
      "This character is linked to scenes, relationships or arcs, so it stays with its pen name.",
    );
  }
  // A series' characters appear only in that series' books: a new series
  // can't strand appearances in books outside it.
  if (home.seriesId && home.seriesId !== (current.series?.id ?? null)) {
    const outside = await db.connection.count({
      where: {
        workspaceId: ctx.workspaceId,
        sourceId: id,
        kind: "appears_in",
        target: {
          scene: { book: { OR: [{ seriesId: null }, { seriesId: { not: home.seriesId } }] } },
        },
      },
    });
    if (outside > 0)
      throw new RuleError(
        `${current.name} appears in ${outside === 1 ? "1 scene" : `${outside} scenes`} outside that series. Remove those appearances first, or keep the character’s series.`,
      );
  }
  await db.$transaction(async (tx) => {
    const row = await tx.character.findUniqueOrThrow({
      where: { id },
      select: { summary: true, updatedAt: true },
    });
    assertNotStale(row.updatedAt, guard.expectedUpdatedAt, "character");
    await recordFieldHistory(tx, ctx, id, row, { summary: data.summary ?? null });
    const { count } = await tx.character.updateMany({
      where: { id, updatedAt: row.updatedAt },
      data: {
        ...home,
        name: data.name,
        aliases: data.aliases,
        role: data.role,
        summary: data.summary ?? null,
      },
    });
    if (count === 0) throw staleError("character");
  });
}

async function isLinked(id: string) {
  const [connections, relationships, outlines] = await Promise.all([
    db.connection.count({ where: { OR: [{ sourceId: id }, { targetId: id }] } }),
    db.relationshipMember.count({ where: { characterId: id } }),
    db.outline.count({ where: { characterId: id } }),
  ]);
  return connections + relationships + outlines > 0;
}

/** Sets one profile field; an empty value removes it. */
export async function updateProfileField(
  ctx: AuthorContext,
  id: string,
  field: string,
  value: string,
  /** The value the author started from: refused if it changed since (another tab). */
  guard: { expectedValue?: string | null } = {},
) {
  assertCan(ctx, "edit", "storyBible");
  const data = profileFieldInput.parse({ field, value });
  await getCharacter(ctx, id);
  await db.$transaction(async (tx) => {
    // Lock the row: profile fields are edited one at a time, often quickly.
    await tx.$queryRaw`SELECT 1 FROM "characters" WHERE "id" = ${id}::uuid FOR UPDATE`;
    const row = await tx.character.findUniqueOrThrow({ where: { id }, select: { profile: true } });
    const profile = asProfile(row.profile);
    const previous = profile[data.field] ?? "";
    if (guard.expectedValue !== undefined && (guard.expectedValue ?? "") !== previous)
      throw staleError("profile field");
    await recordFieldHistory(
      tx,
      ctx,
      id,
      { [`profile.${data.field}`]: previous },
      { [`profile.${data.field}`]: data.value },
    );
    if (data.value.trim() === "") delete profile[data.field];
    else profile[data.field] = data.value;
    await tx.character.update({ where: { id }, data: { profile } });
  });
}

export async function trashCharacter(ctx: AuthorContext, id: string) {
  assertCan(ctx, "edit", "storyBible");
  await getCharacter(ctx, id);
  await db.character.update({ where: { id }, data: { deletedAt: new Date() } });
}
