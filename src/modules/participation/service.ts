import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { ConflictError, NotFoundError, RuleError } from "@/lib/errors";
import { createCharacter } from "@/modules/characters";
import { recordParticipationChange, type ParticipationSnapshot } from "@/modules/history";
import { resolveNode, resolveNodes, sameIdentity, type NodeSummary } from "@/modules/story-graph";
import type { AuthorContext } from "@/server/context";
import { assertCan, assertCanView } from "@/server/policy";

import { secondPovMessage } from "./labels";
import {
  participantChange,
  participantInput,
  povChange,
  type ParticipantChange,
  type ParticipantInput,
  type ParticipationRole,
  type PovChange,
  type ScenePresence,
} from "./schemas";

/**
 * Scene Participation (decision 106, M11): a character's relationship to a
 * scene. Each character in a scene is Present or Mentioned; one of them may
 * also be the scene's point of view (POV + Present is the usual case).
 *
 * Rules, enforced here and by the database:
 * - At most one point of view per scene. Asking for a second one is
 *   refused; nobody's point of view is replaced or removed as a side
 *   effect. Giving it to someone else is its own action (`setPointOfView`).
 * - Participation is the author's statement. It is never inferred from the
 *   manuscript text, and changing it never touches the text.
 * - Characters and scenes keep their identity rules: same pen name, and a
 *   series' characters only in that series' books.
 * - Changing it needs edit rights on the manuscript; reading it goes through
 *   the Story Graph, so characters in the Trash or not viewable are not
 *   shown (and come back when restored).
 * - Every change is kept in the scene's Story History.
 */

export type Participant = {
  character: NodeSummary;
  presence: ScenePresence;
  pov: boolean;
};

export type CharacterScene = {
  scene: NodeSummary;
  presence: ScenePresence;
  pov: boolean;
};

type Tx = Prisma.TransactionClient;

const snapshot = (
  row: { presence: ScenePresence; isPov: boolean } | null,
): ParticipationSnapshot => (row ? { presence: row.presence, pov: row.isPov } : null);

/** POV first, then present, then mentioned; by name within each. */
function byPart(a: Participant, b: Participant) {
  const rank = (p: Participant) => (p.pov ? 0 : p.presence === "PRESENT" ? 1 : 2);
  return rank(a) - rank(b) || a.character.title.localeCompare(b.character.title);
}

async function requireScene(ctx: AuthorContext, sceneId: string) {
  const scene = await resolveNode(ctx, sceneId);
  if (!scene || scene.kind !== "SCENE") throw new NotFoundError("Scene");
  return scene;
}

async function requireCharacter(ctx: AuthorContext, characterId: string) {
  const character = await resolveNode(ctx, characterId);
  if (!character || character.kind !== "CHARACTER") throw new NotFoundError("Character");
  return character;
}

/** The current point-of-view character's name, if the reader may see them. */
async function povHolder(ctx: AuthorContext, client: Tx | typeof db, sceneId: string) {
  const row = await client.sceneParticipation.findFirst({
    where: { workspaceId: ctx.workspaceId, sceneId, isPov: true },
    select: { characterId: true },
  });
  if (!row) return null;
  const node = (await resolveNodes(ctx, [row.characterId])).get(row.characterId);
  return { id: row.characterId, name: node?.title ?? null };
}

function secondPovError(holder: { name: string | null }) {
  return new RuleError(secondPovMessage(holder.name));
}

/** Unique violations become the author-facing rule (two people at once). */
function isUniqueViolation(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

// ─── Reads ──────────────────────────────────────────────────────────────────

/** Who is in a scene, POV first. Characters the reader can't view are left out. */
export async function listParticipants(
  ctx: AuthorContext,
  sceneId: string,
): Promise<Participant[]> {
  assertCanView(ctx, "manuscript", { kind: "SCENE", id: sceneId });
  await requireScene(ctx, sceneId);
  const rows = await db.sceneParticipation.findMany({
    where: { workspaceId: ctx.workspaceId, sceneId },
    select: { characterId: true, presence: true, isPov: true },
  });
  const characters = await resolveNodes(
    ctx,
    rows.map((r) => r.characterId),
  );
  return rows
    .flatMap((r) => {
      const character = characters.get(r.characterId);
      return character ? [{ character, presence: r.presence, pov: r.isPov }] : [];
    })
    .sort(byPart);
}

const ROLE_FILTER: Record<ParticipationRole, Prisma.SceneParticipationWhereInput> = {
  all: {},
  pov: { isPov: true },
  present: { presence: "PRESENT" },
  mentioned: { presence: "MENTIONED" },
};

/**
 * The scenes a character is in, in manuscript order (book, chapter, scene
 * positions), optionally only where they are the point of view, present or
 * mentioned. Scenes the reader can't view (Trash, other access) are left out.
 */
export async function listCharacterScenes(
  ctx: AuthorContext,
  characterId: string,
  { role = "all", sceneIds }: { role?: ParticipationRole; sceneIds?: string[] } = {},
): Promise<CharacterScene[]> {
  assertCanView(ctx, "storyBible", { kind: "CHARACTER", id: characterId });
  await requireCharacter(ctx, characterId);
  const rows = await db.sceneParticipation.findMany({
    where: {
      workspaceId: ctx.workspaceId,
      characterId,
      ...ROLE_FILTER[role],
      ...(sceneIds ? { sceneId: { in: sceneIds } } : {}),
    },
    orderBy: [
      { scene: { book: { title: "asc" } } },
      { scene: { chapter: { position: "asc" } } },
      { scene: { position: "asc" } },
    ],
    select: { sceneId: true, presence: true, isPov: true },
  });
  const scenes = await resolveNodes(
    ctx,
    rows.map((r) => r.sceneId),
  );
  return rows.flatMap((r) => {
    const scene = scenes.get(r.sceneId);
    return scene ? [{ scene, presence: r.presence, pov: r.isPov }] : [];
  });
}

// ─── Changes ────────────────────────────────────────────────────────────────

/** Adds a character to a scene: present or mentioned, and optionally its point of view. */
export async function addParticipant(ctx: AuthorContext, sceneId: string, input: ParticipantInput) {
  assertCan(ctx, "edit", "manuscript");
  const data = participantInput.parse(input);
  const [scene, character] = await Promise.all([
    requireScene(ctx, sceneId),
    requireCharacter(ctx, data.characterId),
  ]);
  if (!sameIdentity(scene, character))
    throw new RuleError(
      `${character.title} belongs to another pen name, so they can’t be in this scene.`,
    );
  if (character.seriesId && character.seriesId !== scene.seriesId)
    throw new RuleError(
      `${character.title} belongs to a series, so they can only be in that series’ books.`,
    );

  try {
    await db.$transaction(async (tx) => {
      const existing = await tx.sceneParticipation.findUnique({
        where: { sceneId_characterId: { sceneId, characterId: character.id } },
        select: { presence: true, isPov: true },
      });
      if (existing) throw new ConflictError(`${character.title} is already in this scene.`);
      if (data.pov) {
        const holder = await povHolder(ctx, tx, sceneId);
        if (holder) throw secondPovError(holder);
      }
      await tx.sceneParticipation.create({
        data: {
          workspaceId: ctx.workspaceId,
          sceneId,
          characterId: character.id,
          presence: data.presence,
          isPov: data.pov,
          createdById: ctx.userId,
        },
      });
      await recordParticipationChange(tx, ctx, sceneId, character.id, null, {
        presence: data.presence,
        pov: data.pov,
      });
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const holder = data.pov ? await povHolder(ctx, db, sceneId) : null;
    throw holder && holder.id !== character.id
      ? secondPovError(holder)
      : new ConflictError(`${character.title} is already in this scene.`);
  }
}

/**
 * Creates a character from a name and adds them to a scene (they join the
 * scene's pen name and series). The point-of-view rule is checked before
 * anyone is created, so a refusal leaves no new character behind.
 */
export async function addNewCharacterToScene(
  ctx: AuthorContext,
  sceneId: string,
  { name, presence, pov = false }: { name: string; presence?: ScenePresence; pov?: boolean },
) {
  assertCan(ctx, "edit", "manuscript");
  const scene = await requireScene(ctx, sceneId);
  if (pov) {
    const holder = await povHolder(ctx, db, sceneId);
    if (holder) throw secondPovError(holder);
  }
  const home = scene.seriesId
    ? { seriesId: scene.seriesId }
    : { penNameId: scene.penNameId ?? undefined };
  const { id } = await createCharacter(ctx, { name, ...home });
  await addParticipant(ctx, sceneId, { characterId: id, presence, pov });
  return { id };
}

async function requireParticipation(
  ctx: AuthorContext,
  client: Tx | typeof db,
  sceneId: string,
  characterId: string,
) {
  const row = await client.sceneParticipation.findFirst({
    where: { workspaceId: ctx.workspaceId, sceneId, characterId },
    select: { presence: true, isPov: true },
  });
  if (!row) throw new NotFoundError("Character in this scene");
  return row;
}

/**
 * Changes a character's part in a scene: present or mentioned, and taking
 * or giving up the point of view. Taking it when someone else has it is
 * refused (use `setPointOfView` to change it).
 */
export async function updateParticipant(
  ctx: AuthorContext,
  sceneId: string,
  characterId: string,
  change: ParticipantChange,
) {
  assertCan(ctx, "edit", "manuscript");
  const data = participantChange.parse(change);
  await requireScene(ctx, sceneId);
  const character = await requireCharacter(ctx, characterId);
  try {
    await db.$transaction(async (tx) => {
      const before = await requireParticipation(ctx, tx, sceneId, characterId);
      const after = {
        presence: data.presence ?? before.presence,
        isPov: data.pov ?? before.isPov,
      };
      if (after.isPov && !before.isPov) {
        const holder = await povHolder(ctx, tx, sceneId);
        if (holder) throw secondPovError(holder);
      }
      await tx.sceneParticipation.update({
        where: { sceneId_characterId: { sceneId, characterId } },
        data: after,
      });
      await recordParticipationChange(
        tx,
        ctx,
        sceneId,
        characterId,
        snapshot(before),
        snapshot(after),
      );
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const holder = await povHolder(ctx, db, sceneId);
    throw holder && holder.id !== character.id
      ? secondPovError(holder)
      : new ConflictError("This scene changed meanwhile. Please try again.");
  }
}

/**
 * Gives the scene's point of view to a character, as an explicit choice.
 * The previous point-of-view character stays in the scene, as they were
 * (present or mentioned); a character not yet in the scene joins as present.
 * Refused if the point of view isn't what the author saw (`expected`).
 */
export async function setPointOfView(ctx: AuthorContext, sceneId: string, change: PovChange) {
  assertCan(ctx, "edit", "manuscript");
  const data = povChange.parse(change);
  const scene = await requireScene(ctx, sceneId);
  const character = await requireCharacter(ctx, data.characterId);
  if (
    !sameIdentity(scene, character) ||
    (character.seriesId && character.seriesId !== scene.seriesId)
  )
    throw new RuleError(`${character.title} can’t be in this scene.`);
  try {
    await db.$transaction(async (tx) => {
      // Serialize point-of-view changes of this scene.
      await tx.$executeRaw`SELECT 1 FROM "scenes" WHERE "id" = ${sceneId}::uuid FOR UPDATE`;
      const current = await tx.sceneParticipation.findFirst({
        where: { workspaceId: ctx.workspaceId, sceneId, isPov: true },
        select: { characterId: true, presence: true, isPov: true },
      });
      if ((current?.characterId ?? null) !== data.expected)
        throw new ConflictError(
          "The point of view of this scene changed meanwhile. Please check it and try again.",
        );
      if (current?.characterId === character.id) return;
      if (current) {
        await tx.sceneParticipation.update({
          where: { sceneId_characterId: { sceneId, characterId: current.characterId } },
          data: { isPov: false },
        });
        await recordParticipationChange(tx, ctx, sceneId, current.characterId, snapshot(current), {
          presence: current.presence,
          pov: false,
        });
      }
      const before = await tx.sceneParticipation.findUnique({
        where: { sceneId_characterId: { sceneId, characterId: character.id } },
        select: { presence: true, isPov: true },
      });
      if (before) {
        await tx.sceneParticipation.update({
          where: { sceneId_characterId: { sceneId, characterId: character.id } },
          data: { isPov: true },
        });
      } else {
        await tx.sceneParticipation.create({
          data: {
            workspaceId: ctx.workspaceId,
            sceneId,
            characterId: character.id,
            presence: "PRESENT",
            isPov: true,
            createdById: ctx.userId,
          },
        });
      }
      await recordParticipationChange(tx, ctx, sceneId, character.id, snapshot(before), {
        presence: before?.presence ?? "PRESENT",
        pov: true,
      });
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    throw new ConflictError(
      "The point of view of this scene changed meanwhile. Please check it and try again.",
    );
  }
}

/** Takes a character out of a scene. The character and the scene are untouched. */
export async function removeParticipant(ctx: AuthorContext, sceneId: string, characterId: string) {
  assertCan(ctx, "edit", "manuscript");
  await requireScene(ctx, sceneId);
  await requireCharacter(ctx, characterId);
  await db.$transaction(async (tx) => {
    const before = await requireParticipation(ctx, tx, sceneId, characterId);
    await tx.sceneParticipation.delete({
      where: { sceneId_characterId: { sceneId, characterId } },
    });
    await recordParticipationChange(tx, ctx, sceneId, characterId, snapshot(before), null);
  });
}
