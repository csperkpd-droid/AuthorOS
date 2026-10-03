import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { ConflictError, NotFoundError, RuleError } from "@/lib/errors";
import { createStoryNode, liveCharacter, liveRelationship } from "@/modules/story-graph";
import type { AuthorContext } from "@/server/context";

import { relationshipTitle } from "./labels";
import {
  memberRole,
  newRelationshipInput,
  relationshipDetails,
  type NewRelationshipInput,
  type RelationshipDetails,
} from "./schemas";

/**
 * Relationships between two or more characters: a couple, a love triangle, a
 * Why Choose/reverse-harem group, a family. Members are rows of
 * relationship_members; one relationship exists per exact set of members
 * (`member_key`, checked by the database at commit). The dynamics between
 * individual members of a group are relationships of their own, so each can
 * develop differently and connect to its own scenes and notes.
 */

const relationshipSelect = {
  id: true,
  type: true,
  description: true,
  members: {
    orderBy: { position: "asc" },
    select: {
      role: true,
      character: { select: { id: true, name: true, penNameId: true, seriesId: true } },
    },
  },
} as const;

type Row = Prisma.RelationshipGetPayload<{ select: typeof relationshipSelect }>;
export type RelationshipView = Omit<Row, "members"> & {
  /** Members in order, each with their role in this relationship (if any). */
  members: (Row["members"][number]["character"] & { role: string | null })[];
  /** "Elara & Kael", or "Elara, Kael & Rowan". */
  title: string;
  /** All members share one pen name. */
  penNameId: string;
};

function toView(row: Row): RelationshipView {
  const members = row.members.map((m) => ({ ...m.character, role: m.role }));
  return {
    ...row,
    members,
    title: relationshipTitle(members.map((m) => m.name)),
    penNameId: members[0].penNameId,
  };
}

export const memberKey = (characterIds: string[]) => [...characterIds].sort().join(",");

/** Relationships in the workspace, optionally only those of one character or identity. */
export async function listRelationships(
  ctx: AuthorContext,
  { characterId, penNameId = null }: { characterId?: string; penNameId?: string | null } = {},
): Promise<RelationshipView[]> {
  const rows = await db.relationship.findMany({
    where: {
      workspaceId: ctx.workspaceId,
      ...liveRelationship,
      AND: [
        ...(characterId ? [{ members: { some: { characterId } } }] : []),
        // Every member shares the identity, so one matching member is enough.
        ...(penNameId ? [{ members: { some: { character: { penNameId } } } }] : []),
      ],
    },
    orderBy: { createdAt: "asc" },
    select: relationshipSelect,
  });
  return rows.map(toView);
}

export async function getRelationship(ctx: AuthorContext, id: string): Promise<RelationshipView> {
  const row = await db.relationship.findFirst({
    where: { id, workspaceId: ctx.workspaceId, ...liveRelationship },
    select: relationshipSelect,
  });
  if (!row) throw new NotFoundError("Relationship");
  return toView(row);
}

/** Live characters of this workspace, all of one pen name. */
async function requireMembers(ctx: AuthorContext, characterIds: string[]) {
  const found = await db.character.findMany({
    where: { workspaceId: ctx.workspaceId, ...liveCharacter, id: { in: characterIds } },
    select: { id: true, penNameId: true },
  });
  if (found.length !== characterIds.length) throw new NotFoundError("Character");
  if (new Set(found.map((c) => c.penNameId)).size > 1) {
    throw new RuleError("Relationships connect characters of the same pen name.");
  }
}

const duplicate = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";

/** Creates a relationship between two or more characters. */
export async function createRelationship(ctx: AuthorContext, input: NewRelationshipInput) {
  const data = newRelationshipInput.parse(input);
  if (data.characterIds.length < 2)
    throw new RuleError("Choose at least two different characters.");
  await requireMembers(ctx, data.characterIds);
  try {
    return await db.$transaction(async (tx) => {
      const id = await createStoryNode(tx, ctx.workspaceId, "RELATIONSHIP");
      await tx.relationship.create({
        data: {
          id,
          workspaceId: ctx.workspaceId,
          memberKey: memberKey(data.characterIds),
          type: data.type,
          description: data.description ?? null,
        },
      });
      await tx.relationshipMember.createMany({
        data: data.characterIds.map((characterId, position) => ({
          workspaceId: ctx.workspaceId,
          relationshipId: id,
          characterId,
          position,
        })),
      });
      return { id };
    });
  } catch (error) {
    if (duplicate(error)) {
      throw new ConflictError(
        data.characterIds.length === 2
          ? "These characters already have a relationship. Edit that one instead."
          : "These characters already have a group relationship. Edit that one instead.",
      );
    }
    throw error;
  }
}

/**
 * Changes who is in a relationship (two or more characters, one pen name),
 * with each member's optional role in it. Members given as plain ids keep
 * their current role.
 */
export async function setRelationshipMembers(
  ctx: AuthorContext,
  id: string,
  members: (string | { characterId: string; role?: string | null })[],
) {
  const list = members.map((m) => (typeof m === "string" ? { characterId: m } : m));
  const characterIds = list.map((m) => m.characterId);
  const ids = [...new Set(characterIds)];
  if (ids.length < 2) throw new RuleError("A relationship needs at least two characters.");
  const current = await getRelationship(ctx, id);
  await requireMembers(ctx, ids);
  const roleOf = (characterId: string) => {
    const given = list.find((m) => m.characterId === characterId);
    return given && "role" in given
      ? memberRole.parse(given.role)
      : (current.members.find((m) => m.id === characterId)?.role ?? null);
  };
  if (ids[0] && current.members[0].penNameId !== (await penOf(ids[0]))) {
    throw new RuleError("Members must stay within the relationship’s pen name.");
  }
  try {
    await db.$transaction(async (tx) => {
      await tx.relationship.update({ where: { id }, data: { memberKey: memberKey(ids) } });
      await tx.relationshipMember.deleteMany({ where: { relationshipId: id } });
      await tx.relationshipMember.createMany({
        data: ids.map((characterId, position) => ({
          workspaceId: ctx.workspaceId,
          relationshipId: id,
          characterId,
          position,
          role: roleOf(characterId),
        })),
      });
    });
  } catch (error) {
    if (duplicate(error)) {
      throw new ConflictError("Those characters already have a relationship.");
    }
    throw error;
  }
}

async function penOf(characterId: string) {
  return (
    await db.character.findUniqueOrThrow({
      where: { id: characterId },
      select: { penNameId: true },
    })
  ).penNameId;
}

/**
 * For a group: every pair (and smaller group) of its members, with the
 * relationship between them if there is one. Each dynamic within a group is a
 * relationship of its own.
 */
export async function groupDynamics(ctx: AuthorContext, id: string) {
  const group = await getRelationship(ctx, id);
  if (group.members.length < 3) return [];
  const memberIds = group.members.map((m) => m.id);
  const within = await db.relationship.findMany({
    where: {
      workspaceId: ctx.workspaceId,
      ...liveRelationship,
      id: { not: id },
      members: { every: { characterId: { in: memberIds } } },
    },
    select: relationshipSelect,
  });
  const existing = new Map(
    within.map(toView).map((r) => [memberKey(r.members.map((m) => m.id)), r]),
  );
  const pairs: {
    members: (typeof group.members)[number][];
    relationship: RelationshipView | null;
  }[] = [];
  for (let i = 0; i < group.members.length; i++) {
    for (let j = i + 1; j < group.members.length; j++) {
      const members = [group.members[i], group.members[j]];
      pairs.push({
        members,
        relationship: existing.get(memberKey(members.map((m) => m.id))) ?? null,
      });
    }
  }
  // Sub-groups (three or more) that exist are listed too.
  const subGroups = [...existing.values()]
    .filter((r) => r.members.length > 2)
    .map((r) => ({ members: r.members, relationship: r }));
  return [...pairs, ...subGroups];
}

/** Groups (three or more members) that include every member of this relationship. */
export async function groupsIncluding(ctx: AuthorContext, id: string) {
  const rel = await getRelationship(ctx, id);
  const rows = await db.relationship.findMany({
    where: {
      workspaceId: ctx.workspaceId,
      ...liveRelationship,
      id: { not: id },
      AND: rel.members.map((m) => ({ members: { some: { characterId: m.id } } })),
    },
    select: relationshipSelect,
  });
  return rows.map(toView).filter((r) => r.members.length > rel.members.length);
}

/** Sets (or, with null, clears) one member's role in a relationship. */
export async function setMemberRole(
  ctx: AuthorContext,
  id: string,
  characterId: string,
  role: string | null,
) {
  const rel = await getRelationship(ctx, id);
  if (!rel.members.some((m) => m.id === characterId)) throw new NotFoundError("Member");
  await db.relationshipMember.update({
    where: { relationshipId_characterId: { relationshipId: id, characterId } },
    data: { role: memberRole.parse(role) },
  });
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
