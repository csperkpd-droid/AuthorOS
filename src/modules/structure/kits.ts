import "server-only";

import { db } from "@/lib/db";
import { NotFoundError, RuleError } from "@/lib/errors";
import { liveOutline } from "@/modules/story-graph";
import type { AuthorContext } from "@/server/context";

import { applyKitInput, kitInput, type ApplyKitInput, type KitInput } from "./schemas";
import { prepareOutline, prepareTemplate } from "./service";

/**
 * Template kits: a named set of templates applied together ("My Romantasy
 * Book Kit": a main plot, a romance arc, a character arc…). A kit refers to
 * the author's templates; applying it creates new, independent structures,
 * exactly as applying each template would. Nothing live is shared between
 * projects.
 */

const kitSelect = {
  id: true,
  name: true,
  description: true,
  items: {
    orderBy: { position: "asc" },
    select: {
      id: true,
      itemType: true,
      template: {
        select: {
          id: true,
          kind: true,
          name: true,
          forSeries: true,
          workspaceId: true,
          _count: { select: { beats: true } },
        },
      },
    },
  },
} as const;

export async function listKits(ctx: AuthorContext) {
  return db.templateKit.findMany({
    where: { workspaceId: ctx.workspaceId },
    orderBy: { name: "asc" },
    select: kitSelect,
  });
}

export async function getKit(ctx: AuthorContext, id: string) {
  const kit = await db.templateKit.findFirst({
    where: { id, workspaceId: ctx.workspaceId },
    select: kitSelect,
  });
  if (!kit) throw new NotFoundError("Template kit");
  return kit;
}

/** Templates this workspace may use (built-in or its own). */
async function requireTemplates(ctx: AuthorContext, ids: string[]) {
  const found = await db.structureTemplate.count({
    where: { id: { in: ids }, OR: [{ workspaceId: null }, { workspaceId: ctx.workspaceId }] },
  });
  if (found !== new Set(ids).size) throw new NotFoundError("Template");
}

export async function createKit(ctx: AuthorContext, input: KitInput) {
  const data = kitInput.parse(input);
  await requireTemplates(ctx, data.templateIds);
  return db.templateKit.create({
    data: {
      workspaceId: ctx.workspaceId,
      name: data.name,
      description: data.description ?? null,
      items: { create: data.templateIds.map((templateId, position) => ({ templateId, position })) },
    },
    select: { id: true },
  });
}

/** Renames a kit and replaces its templates. */
export async function updateKit(ctx: AuthorContext, id: string, input: KitInput) {
  const data = kitInput.parse(input);
  await getKit(ctx, id);
  await requireTemplates(ctx, data.templateIds);
  await db.$transaction([
    db.templateKitItem.deleteMany({ where: { kitId: id } }),
    db.templateKit.update({
      where: { id },
      data: {
        name: data.name,
        description: data.description ?? null,
        items: {
          create: data.templateIds.map((templateId, position) => ({ templateId, position })),
        },
      },
    }),
  ]);
}

/** Deletes a kit. Its templates, and anything made from them, stay. */
export async function deleteKit(ctx: AuthorContext, id: string) {
  await getKit(ctx, id);
  await db.templateKit.delete({ where: { id } });
}

/**
 * Saves every structure of a book (or every series-wide structure of a
 * series) as templates, gathered in a new kit. All or nothing.
 */
export async function saveStructuresAsKit(
  ctx: AuthorContext,
  { bookId, seriesId, name }: { bookId?: string; seriesId?: string; name: string },
) {
  const outlines = await db.outline.findMany({
    where: {
      workspaceId: ctx.workspaceId,
      ...liveOutline,
      ...(bookId ? { bookId } : { seriesId }),
    },
    orderBy: { createdAt: "asc" },
    select: { id: true, title: true },
  });
  if (outlines.length === 0) throw new RuleError("There are no structures to save yet.");
  const kitName = kitInput.shape.name.parse(name);
  const prepared = await Promise.all(
    outlines.map((o) => prepareTemplate(ctx, o.id, { name: `${kitName}: ${o.title}` })),
  );
  return db.$transaction(async (tx) => {
    const templates = [];
    for (const p of prepared) templates.push(await p.insert(tx));
    return tx.templateKit.create({
      data: {
        workspaceId: ctx.workspaceId,
        name: kitName,
        items: { create: templates.map((t, position) => ({ templateId: t.id, position })) },
      },
      select: { id: true },
    });
  });
}

/**
 * Applies a kit to a book or series: one new structure per template (per
 * chosen relationship for romance templates, per chosen character for
 * character arcs). Everything is validated first and created together.
 */
export async function applyKit(ctx: AuthorContext, input: ApplyKitInput) {
  const data = applyKitInput.parse(input);
  const kit = await getKit(ctx, data.kitId);
  const target = { bookId: data.bookId, seriesId: data.seriesId };
  const plans: Parameters<typeof prepareOutline>[1][] = [];
  const skipped: string[] = [];

  for (const item of kit.items) {
    const t = item.template;
    const owners = data.owners[item.id] ?? {};
    if (t.kind === "ROMANCE") {
      const ids = [...new Set(owners.relationshipIds ?? [])];
      if (ids.length === 0) skipped.push(item.id);
      for (const relationshipId of ids)
        plans.push({ ...target, kind: "ROMANCE", templateId: t.id, relationshipId });
    } else if (t.kind === "CHARACTER_ARC") {
      const ids = [...new Set(owners.characterIds ?? [])];
      if (ids.length === 0) skipped.push(item.id);
      for (const characterId of ids)
        plans.push({ ...target, kind: "CHARACTER_ARC", templateId: t.id, characterId });
    } else {
      plans.push({ ...target, kind: t.kind, templateId: t.id });
    }
  }
  if (plans.length === 0) {
    throw new RuleError(
      "Choose at least one relationship or character, or a kit with other templates.",
    );
  }
  const prepared = await Promise.all(plans.map((p) => prepareOutline(ctx, p)));
  const created = await db.$transaction(async (tx) => {
    const ids: string[] = [];
    for (const p of prepared) ids.push((await p.insert(tx)).id);
    return ids;
  });
  return { created, skipped };
}
