import "server-only";

import { Prisma, type StoryNodeKind } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { ConflictError, NotFoundError, RuleError } from "@/lib/errors";
import { positionAtEnd, sortByPosition } from "@/lib/ordering";
import { CORE_CHARACTER_FIELD_LABELS } from "@/modules/characters";
import { getBook, getSeries } from "@/modules/library";
import { getPenName, requireAssignablePenName } from "@/modules/pen-names";
import { buildReport } from "@/modules/impact";
import { resolveNode, resolveNodes } from "@/modules/story-graph";
import type { AuthorContext } from "@/server/context";
import { assertCan } from "@/server/policy";

import { fieldLabel, fieldValue, newFieldInput, type NewFieldInput } from "./schemas";

/**
 * Author-defined fields ("Magic type", "Love language"…) for any kind of
 * story object. A definition belongs to a node kind and a scope: one pen name
 * (the default, since pen names often write different genres), every
 * identity, one series, or one book. Values attach to story nodes, so every
 * object type can have custom fields without schema changes.
 */

/** Where an object sits, for deciding which scoped fields apply to it. */
export type FieldContext = {
  penNameId: string | null;
  seriesId: string | null;
  /** Books the object belongs to or appears in (characters: their scenes' books). */
  bookIds: string[];
};

export async function fieldContext(ctx: AuthorContext, nodeId: string): Promise<FieldContext> {
  const node = await resolveNode(ctx, nodeId);
  if (!node) throw new NotFoundError("Item");
  let bookIds: string[] = [];
  switch (node.kind) {
    case "BOOK":
      bookIds = [node.id];
      break;
    case "PART":
    case "CHAPTER":
    case "SCENE": {
      const row =
        node.kind === "SCENE"
          ? await db.scene.findUnique({ where: { id: nodeId }, select: { bookId: true } })
          : node.kind === "CHAPTER"
            ? await db.chapter.findUnique({ where: { id: nodeId }, select: { bookId: true } })
            : await db.part.findUnique({ where: { id: nodeId }, select: { bookId: true } });
      bookIds = row ? [row.bookId] : [];
      break;
    }
    case "OUTLINE": {
      const row = await db.outline.findUnique({ where: { id: nodeId }, select: { bookId: true } });
      bookIds = row?.bookId ? [row.bookId] : [];
      break;
    }
    case "CHARACTER":
    case "RELATIONSHIP": {
      const scenes = await db.connection.findMany({
        where: {
          workspaceId: ctx.workspaceId,
          sourceId: nodeId,
          kind: { in: ["appears_in", "develops_in"] },
        },
        select: { target: { select: { scene: { select: { bookId: true } } } } },
      });
      bookIds = [
        ...new Set(scenes.flatMap((s) => (s.target.scene ? [s.target.scene.bookId] : []))),
      ];
      break;
    }
    default:
      bookIds = [];
  }
  return { penNameId: node.penNameId, seriesId: node.seriesId, bookIds };
}

const definitionSelect = {
  id: true,
  label: true,
  type: true,
  position: true,
  penNameId: true,
  seriesId: true,
  bookId: true,
  penName: { select: { name: true } },
  series: { select: { title: true } },
  book: { select: { title: true } },
} as const;

/** Where a definition applies, in words ("Rose Hart", "All pen names", "Series: …"). */
function scopeLabel(d: {
  penName: { name: string } | null;
  series: { title: string } | null;
  book: { title: string } | null;
}) {
  if (d.penName) return d.penName.name;
  if (d.series) return `Series: ${d.series.title}`;
  if (d.book) return `Book: ${d.book.title}`;
  return "All pen names";
}

/** Field definitions of a kind that apply to an object in `context`. */
export async function listFieldDefinitions(
  ctx: AuthorContext,
  { nodeKind, context }: { nodeKind: StoryNodeKind; context: FieldContext },
) {
  const rows = await db.fieldDefinition.findMany({
    where: {
      workspaceId: ctx.workspaceId,
      nodeKind,
      OR: [
        { penNameId: null, seriesId: null, bookId: null },
        ...(context.penNameId ? [{ penNameId: context.penNameId }] : []),
        ...(context.seriesId ? [{ seriesId: context.seriesId }] : []),
        ...(context.bookIds.length ? [{ bookId: { in: context.bookIds } }] : []),
      ],
    },
    select: definitionSelect,
  });
  return sortByPosition(rows).map(({ penName, series, book, ...d }) => ({
    ...d,
    scope: scopeLabel({ penName, series, book }),
  }));
}

/**
 * The scopes the author can pick when adding a field to an object: its pen
 * name first (the default), then every identity, its series, its books.
 */
export async function fieldScopeOptions(ctx: AuthorContext, context: FieldContext) {
  const [pen, series, books] = await Promise.all([
    context.penNameId ? getPenName(ctx, context.penNameId) : null,
    context.seriesId ? getSeries(ctx, context.seriesId).catch(() => null) : null,
    Promise.all(context.bookIds.map((b) => getBook(ctx, b).catch(() => null))),
  ]);
  return [
    ...(pen ? [{ value: `pen:${pen.id}`, label: `This pen name (${pen.name})` }] : []),
    { value: "all", label: "All pen names" },
    ...(series ? [{ value: `series:${series.id}`, label: `This series (${series.title})` }] : []),
    ...books.flatMap((b) => (b ? [{ value: `book:${b.id}`, label: `Book: ${b.title}` }] : [])),
  ];
}

/** Core fields of a kind, which custom fields never duplicate. */
const CORE_FIELDS: Partial<Record<StoryNodeKind, string[]>> = {
  CHARACTER: CORE_CHARACTER_FIELD_LABELS,
};

function assertNotCoreField(kind: StoryNodeKind, label: string) {
  const core = CORE_FIELDS[kind]?.find((l) => l.toLowerCase() === label.trim().toLowerCase());
  if (core)
    throw new RuleError(`“${core}” is already a core field. Use it instead of a custom field.`);
}

export async function createFieldDefinition(ctx: AuthorContext, input: NewFieldInput) {
  assertCan(ctx, "edit", "storyBible");
  const data = newFieldInput.parse(input);
  assertNotCoreField(data.nodeKind, data.label);
  if (data.penNameId) await requireAssignablePenName(ctx, data.penNameId);
  if (data.seriesId) await getSeries(ctx, data.seriesId);
  if (data.bookId) await getBook(ctx, data.bookId);
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
          seriesId: data.seriesId ?? null,
          bookId: data.bookId ?? null,
          position: positionAtEnd(siblings),
        },
        select: { id: true },
      });
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new ConflictError("There’s already a field with that name here.");
    }
    throw error;
  }
}

async function requireDefinition(ctx: AuthorContext, id: string) {
  const def = await db.fieldDefinition.findFirst({
    where: { id, workspaceId: ctx.workspaceId },
    select: { id: true, nodeKind: true, penNameId: true, seriesId: true, bookId: true },
  });
  if (!def) throw new NotFoundError("Field");
  return def;
}

export async function renameFieldDefinition(ctx: AuthorContext, id: string, label: string) {
  assertCan(ctx, "edit", "storyBible");
  const definition = await requireDefinition(ctx, id);
  assertNotCoreField(definition.nodeKind, label);
  await db.fieldDefinition.update({ where: { id }, data: { label: fieldLabel.parse(label) } });
}

/**
 * "What will this affect?" for deleting a field: every object with a value
 * for it, and the values that will be lost. The objects themselves stay.
 */
export async function previewDeleteField(ctx: AuthorContext, id: string) {
  await requireDefinition(ctx, id);
  const def = await db.fieldDefinition.findUniqueOrThrow({
    where: { id },
    select: { label: true, nodeKind: true },
  });
  const values = await db.nodeFieldValue.findMany({
    where: { fieldId: id, workspaceId: ctx.workspaceId },
    select: { nodeId: true, value: true },
  });
  const nodes = await resolveNodes(
    ctx,
    values.map((v) => v.nodeId),
  );
  const excerpt = (v: string) => (v.length > 60 ? `“${v.slice(0, 57)}…”` : `“${v}”`);
  return buildReport({
    title: `Delete the “${def.label}” field?`,
    description:
      "The field disappears from every item, and the values filled in for it are deleted. The items themselves stay.",
    groups: [
      {
        key: "VALUES",
        label: "Items with a value",
        noun: { one: "value", many: "values" },
        effect: "Value deleted",
        count: values.length,
        items: values.map((v) => {
          const node = nodes.get(v.nodeId);
          return {
            id: v.nodeId,
            title: node?.title ?? "An item in the Trash",
            href: node?.href ?? null,
            note: excerpt(v.value),
          };
        }),
      },
    ],
  });
}

/**
 * Removes a field and its values from every object. With the reviewed
 * report's `token`, refused if the values changed since.
 */
export async function deleteFieldDefinition(ctx: AuthorContext, id: string, token?: string) {
  assertCan(ctx, "manage", "storyBible");
  await requireDefinition(ctx, id);
  if (token !== undefined && (await previewDeleteField(ctx, id)).token !== token) {
    throw new ConflictError("This field’s values changed since you reviewed them. Review again.");
  }
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
  assertCan(ctx, "edit", "storyBible");
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
  if (def.seriesId || def.bookId) {
    const context = await fieldContext(ctx, nodeId);
    if (def.seriesId && def.seriesId !== context.seriesId) {
      throw new RuleError("That field belongs to a different series.");
    }
    if (def.bookId && !context.bookIds.includes(def.bookId)) {
      throw new RuleError("That field belongs to a different book.");
    }
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
