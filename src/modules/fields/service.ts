import "server-only";

import { Prisma, type StoryNodeKind } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { ConflictError, NotFoundError, RuleError } from "@/lib/errors";
import { positionAtEnd, sortByPosition } from "@/lib/ordering";
import { requireAssignablePenName } from "@/modules/pen-names";
import { resolveNode } from "@/modules/story-graph";
import type { AuthorContext } from "@/server/context";

import { fieldLabel, fieldValue, newFieldInput, type NewFieldInput } from "./schemas";

/**
 * Author-defined fields ("Magic type", "Love language"…) for any kind of
 * story object. Definitions belong to a node kind and optionally one
 * identity; values attach to story nodes, so every object type can have
 * custom fields without schema changes.
 */

/** Field definitions for a kind, as seen by objects of the given identity. */
export async function listFieldDefinitions(
  ctx: AuthorContext,
  { nodeKind, penNameId }: { nodeKind: StoryNodeKind; penNameId: string | null },
) {
  const rows = await db.fieldDefinition.findMany({
    where: {
      workspaceId: ctx.workspaceId,
      nodeKind,
      OR: [{ penNameId: null }, ...(penNameId ? [{ penNameId }] : [])],
    },
    select: { id: true, label: true, type: true, position: true, penNameId: true },
  });
  return sortByPosition(rows);
}

export async function createFieldDefinition(ctx: AuthorContext, input: NewFieldInput) {
  const data = newFieldInput.parse(input);
  if (data.penNameId) await requireAssignablePenName(ctx, data.penNameId);
  try {
    return await db.$transaction(async (tx) => {
      const siblings = await tx.fieldDefinition.findMany({
        where: { workspaceId: ctx.workspaceId, nodeKind: data.nodeKind },
        select: { id: true, position: true },
      });
      return tx.fieldDefinition.create({
        data: {
          workspaceId: ctx.workspaceId,
          nodeKind: data.nodeKind,
          label: data.label,
          type: data.type,
          penNameId: data.penNameId ?? null,
          position: positionAtEnd(siblings),
        },
        select: { id: true },
      });
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new ConflictError("There’s already a field with that name.");
    }
    throw error;
  }
}

async function requireDefinition(ctx: AuthorContext, id: string) {
  const def = await db.fieldDefinition.findFirst({
    where: { id, workspaceId: ctx.workspaceId },
    select: { id: true, nodeKind: true, penNameId: true },
  });
  if (!def) throw new NotFoundError("Field");
  return def;
}

export async function renameFieldDefinition(ctx: AuthorContext, id: string, label: string) {
  await requireDefinition(ctx, id);
  await db.fieldDefinition.update({ where: { id }, data: { label: fieldLabel.parse(label) } });
}

/** Removes a field and its values from every object. */
export async function deleteFieldDefinition(ctx: AuthorContext, id: string) {
  await requireDefinition(ctx, id);
  await db.fieldDefinition.delete({ where: { id } });
}

/** Custom field values of one object, by field id. */
export async function getFieldValues(
  ctx: AuthorContext,
  nodeId: string,
): Promise<Record<string, string>> {
  const rows = await db.nodeFieldValue.findMany({
    where: { nodeId, workspaceId: ctx.workspaceId },
    select: { fieldId: true, value: true },
  });
  return Object.fromEntries(rows.map((r) => [r.fieldId, r.value]));
}

/** Sets a custom field on an object; an empty value clears it. */
export async function setFieldValue(
  ctx: AuthorContext,
  nodeId: string,
  fieldId: string,
  value: string,
) {
  const text = fieldValue.parse(value);
  const [node, def] = await Promise.all([
    resolveNode(ctx, nodeId),
    requireDefinition(ctx, fieldId),
  ]);
  if (!node) throw new NotFoundError("Item");
  if (def.nodeKind !== node.kind)
    throw new RuleError("That field belongs to a different kind of item.");
  if (def.penNameId && def.penNameId !== node.penNameId) {
    throw new RuleError("That field belongs to a different pen name.");
  }
  if (text.trim() === "") {
    await db.nodeFieldValue.deleteMany({ where: { nodeId, fieldId } });
    return;
  }
  await db.nodeFieldValue.upsert({
    where: { nodeId_fieldId: { nodeId, fieldId } },
    create: { workspaceId: ctx.workspaceId, nodeId, fieldId, value: text },
    update: { value: text },
  });
}
