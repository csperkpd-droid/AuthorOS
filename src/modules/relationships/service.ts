import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { ConflictError, NotFoundError, RuleError } from "@/lib/errors";
import { createStoryNode, liveCharacter, liveRelationship } from "@/modules/story-graph";
import type { AuthorContext } from "@/server/context";

import {
  newRelationshipInput,
  relationshipDetails,
  type NewRelationshipInput,
  type RelationshipDetails,
} from "./schemas";

const characterRef = { select: { id: true, name: true, penNameId: true } } as const;
const relationshipSelect = {
  id: true,
  type: true,
  description: true,
  characterA: characterRef,
  characterB: characterRef,
} as const;

/** Relationships in the workspace, optionally only those of one character. */
export async function listRelationships(
  ctx: AuthorContext,
  { characterId, penNameId = null }: { characterId?: string; penNameId?: string | null } = {},
) {
  return db.relationship.findMany({
    where: {
      workspaceId: ctx.workspaceId,
      ...liveRelationship,
      ...(characterId
        ? { OR: [{ characterAId: characterId }, { characterBId: characterId }] }
        : {}),
      // Both characters share an identity, so filtering on A is enough.
      ...(penNameId ? { characterA: { penNameId } } : {}),
    },
    orderBy: { createdAt: "asc" },
    select: relationshipSelect,
  });
}

export async function getRelationship(ctx: AuthorContext, id: string) {
  const row = await db.relationship.findFirst({
    where: { id, workspaceId: ctx.workspaceId, ...liveRelationship },
    select: relationshipSelect,
  });
  if (!row) throw new NotFoundError("Relationship");
  return row;
}

/** Creates a relationship between two characters. Each pair has at most one. */
export async function createRelationship(ctx: AuthorContext, input: NewRelationshipInput) {
  const data = newRelationshipInput.parse(input);
  if (data.characterId === data.otherCharacterId) {
    throw new RuleError("Choose two different characters.");
  }
  const found = await db.character.findMany({
    where: {
      workspaceId: ctx.workspaceId,
      ...liveCharacter,
      id: { in: [data.characterId, data.otherCharacterId] },
    },
    select: { penNameId: true },
  });
  if (found.length !== 2) throw new NotFoundError("Character");
  if (found[0].penNameId !== found[1].penNameId) {
    throw new RuleError("Relationships connect characters of the same pen name.");
  }

  // Stored in id order (matches the database CHECK), so each pair exists once.
  const [characterAId, characterBId] = [data.characterId, data.otherCharacterId].sort();
  try {
    return await db.$transaction(async (tx) => {
      const id = await createStoryNode(tx, ctx.workspaceId, "RELATIONSHIP");
      return tx.relationship.create({
        data: {
          id,
          workspaceId: ctx.workspaceId,
          characterAId,
          characterBId,
          type: data.type,
          description: data.description ?? null,
        },
        select: { id: true },
      });
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new ConflictError(
        "These characters already have a relationship. Edit that one instead.",
      );
    }
    throw error;
  }
}

export async function updateRelationship(
  ctx: AuthorContext,
  id: string,
  input: RelationshipDetails,
) {
  const data = relationshipDetails.parse(input);
  await getRelationship(ctx, id);
  await db.relationship.update({
    where: { id },
    data: { type: data.type, description: data.description ?? null },
  });
}

export async function trashRelationship(ctx: AuthorContext, id: string) {
  await getRelationship(ctx, id);
  await db.relationship.update({ where: { id }, data: { deletedAt: new Date() } });
}
