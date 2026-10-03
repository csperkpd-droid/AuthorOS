import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { NotFoundError } from "@/lib/errors";
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

/** Characters in the workspace, with how many scenes each appears in. */
export async function listCharacters(ctx: AuthorContext) {
  const rows = await db.character.findMany({
    where: { workspaceId: ctx.workspaceId, ...liveCharacter },
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

async function requireSeries(ctx: AuthorContext, seriesId: string | null | undefined) {
  if (!seriesId) return null;
  const series = await db.series.findFirst({
    where: { id: seriesId, workspaceId: ctx.workspaceId, ...liveSeries },
    select: { id: true },
  });
  if (!series) throw new NotFoundError("Series");
  return series.id;
}

export async function createCharacter(ctx: AuthorContext, input: CharacterInput) {
  const data = characterInput.parse(input);
  const seriesId = await requireSeries(ctx, data.seriesId);
  return db.$transaction(async (tx) => {
    const id = await createStoryNode(tx, ctx.workspaceId, "CHARACTER");
    return tx.character.create({
      data: {
        id,
        workspaceId: ctx.workspaceId,
        name: data.name,
        aliases: data.aliases,
        role: data.role,
        summary: data.summary ?? null,
        seriesId,
      },
      select: { id: true },
    });
  });
}

export async function updateCharacter(ctx: AuthorContext, id: string, input: CharacterInput) {
  const data = characterInput.parse(input);
  await getCharacter(ctx, id);
  const seriesId = await requireSeries(ctx, data.seriesId);
  await db.character.update({
    where: { id },
    data: {
      name: data.name,
      aliases: data.aliases,
      role: data.role,
      summary: data.summary ?? null,
      seriesId,
    },
  });
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
