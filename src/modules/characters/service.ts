import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { NotFoundError, RuleError } from "@/lib/errors";
import { getPenNameForNewWork, requireAssignablePenName } from "@/modules/pen-names";
import { createStoryNode, liveCharacter, liveScene, liveSeries } from "@/modules/story-graph";
import type { AuthorContext } from "@/server/context";

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
export async function updateCharacter(ctx: AuthorContext, id: string, input: CharacterInput) {
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
  await db.character.update({
    where: { id },
    data: {
      ...home,
      name: data.name,
      aliases: data.aliases,
      role: data.role,
      summary: data.summary ?? null,
    },
  });
}

async function isLinked(id: string) {
  const [connections, relationships, outlines] = await Promise.all([
    db.connection.count({ where: { OR: [{ sourceId: id }, { targetId: id }] } }),
    db.relationship.count({ where: { OR: [{ characterAId: id }, { characterBId: id }] } }),
    db.outline.count({ where: { characterId: id } }),
  ]);
  return connections + relationships + outlines > 0;
}

/**
 * When a series moves to another pen name, its characters move with it
 * (like its books). Called by the library inside its transaction.
 */
export function moveSeriesCharacters(
  tx: Prisma.TransactionClient,
  seriesId: string,
  penNameId: string,
) {
  return tx.character.updateMany({ where: { seriesId }, data: { penNameId } });
}

/** Sets one profile field; an empty value removes it. */
export async function updateProfileField(
  ctx: AuthorContext,
  id: string,
  field: string,
  value: string,
) {
  const data = profileFieldInput.parse({ field, value });
  const character = await getCharacter(ctx, id);
  const profile = { ...character.profile };
  if (data.value.trim() === "") delete profile[data.field];
  else profile[data.field] = data.value;
  await db.character.update({ where: { id }, data: { profile } });
}

export async function trashCharacter(ctx: AuthorContext, id: string) {
  await getCharacter(ctx, id);
  await db.character.update({ where: { id }, data: { deletedAt: new Date() } });
}
