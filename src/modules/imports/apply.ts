import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { countWords } from "@/lib/text";
import { recordFieldHistory } from "@/modules/history";
import type { AuthorContext } from "@/server/context";

import type { ImportOps, Row, TableOps } from "./plan";

type Tx = Prisma.TransactionClient;

const BATCH = 1000;

/**
 * Writes a plan inside the caller's transaction, parents before children.
 * Any failure throws and the transaction rolls back: nothing is imported.
 */
export async function applyPlan(tx: Tx, ctx: AuthorContext, ops: ImportOps) {
  const ws = ctx.workspaceId;
  const json = (v: unknown) => (v === null || v === undefined ? Prisma.DbNull : (v as object));

  const insert = async (rows: Row[], write: (rows: never[]) => Promise<unknown>) => {
    for (let i = 0; i < rows.length; i += BATCH) await write(rows.slice(i, i + BATCH) as never[]);
  };
  const update = async (
    table: TableOps,
    write: (u: { id: string; data: never }) => Promise<unknown>,
  ) => {
    for (const u of table.update) await write(u as { id: string; data: never });
  };

  // Replacing existing objects keeps their previous long-form text first.
  await keepTextHistory(tx, ctx, ops);

  // Story nodes first: every typed row, pen names included, uses one.
  await insert(
    ops.nodes.map((n) => ({ ...n, workspaceId: ws })),
    (data) => tx.storyNode.createMany({ data }),
  );

  await insert(ops.penNames.create, (data) => tx.penName.createMany({ data }));
  await update(ops.penNames, ({ id, data }) => tx.penName.update({ where: { id }, data }));

  await insert(ops.series.create, (data) => tx.series.createMany({ data }));
  await update(ops.series, ({ id, data }) => tx.series.update({ where: { id }, data }));
  await insert(ops.books.create, (data) => tx.book.createMany({ data }));
  await update(ops.books, ({ id, data }) => tx.book.update({ where: { id }, data }));
  await insert(ops.parts.create, (data) => tx.part.createMany({ data }));
  await update(ops.parts, ({ id, data }) => tx.part.update({ where: { id }, data }));
  await insert(ops.chapters.create, (data) => tx.chapter.createMany({ data }));
  await update(ops.chapters, ({ id, data }) => tx.chapter.update({ where: { id }, data }));

  // Text about to be replaced is saved as a version first.
  for (const s of ops.snapshots) {
    const current =
      s.kind === "SCENE"
        ? await tx.scene.findUniqueOrThrow({
            where: { id: s.id },
            select: { content: true, contentText: true, wordCount: true },
          })
        : await tx.note
            .findUniqueOrThrow({
              where: { id: s.id },
              select: { body: true, bodyText: true },
            })
            .then((n) => ({
              content: n.body,
              contentText: n.bodyText,
              wordCount: countWords(n.bodyText),
            }));
    await tx.contentRevision.create({
      data: {
        workspaceId: ws,
        nodeId: s.id,
        content: json(current.content),
        contentText: current.contentText,
        wordCount: current.wordCount,
        source: "IMPORT",
        label: "Before import",
        createdById: ctx.userId,
      },
    });
  }

  await insert(
    ops.scenes.create.map((r) => ({ ...r, content: json(r.content) })),
    (data) => tx.scene.createMany({ data }),
  );
  await update(ops.scenes, ({ id, data }) =>
    tx.scene.update({
      where: { id },
      data: { ...(data as Row), content: json((data as Row).content) } as never,
    }),
  );
  await insert(ops.characters.create, (data) => tx.character.createMany({ data }));
  await update(ops.characters, ({ id, data }) => tx.character.update({ where: { id }, data }));

  await insert(ops.relationships.create, (data) => tx.relationship.createMany({ data }));
  await insert(ops.relationshipMembers, (data) => tx.relationshipMember.createMany({ data }));
  await update(ops.relationships, ({ id, data }) =>
    tx.relationship.update({ where: { id }, data }),
  );
  for (const m of ops.memberRoles)
    await tx.relationshipMember.updateMany({
      where: { workspaceId: ws, relationshipId: m.relationshipId, characterId: m.characterId },
      data: { role: m.role },
    });

  await insert(
    ops.notes.create.map((r) => ({ ...r, body: json(r.body) })),
    (data) => tx.note.createMany({ data }),
  );
  await update(ops.notes, ({ id, data }) =>
    tx.note.update({
      where: { id },
      data: { ...(data as Row), body: json((data as Row).body) } as never,
    }),
  );
  await insert(ops.ideas.create, (data) => tx.idea.createMany({ data }));
  await update(ops.ideas, ({ id, data }) => tx.idea.update({ where: { id }, data }));
  await insert(ops.tasks.create, (data) => tx.task.createMany({ data }));
  await update(ops.tasks, ({ id, data }) => tx.task.update({ where: { id }, data }));
  await insert(ops.calendarEvents.create, (data) => tx.calendarEvent.createMany({ data }));
  await update(ops.calendarEvents, ({ id, data }) =>
    tx.calendarEvent.update({ where: { id }, data }),
  );

  await insert(ops.templates.create, (data) => tx.structureTemplate.createMany({ data }));
  await update(ops.templates, ({ id, data }) =>
    tx.structureTemplate.update({ where: { id }, data }),
  );
  await insert(ops.templateBeats.create, (data) => tx.templateBeat.createMany({ data }));
  await update(ops.templateBeats, ({ id, data }) =>
    tx.templateBeat.update({ where: { id }, data }),
  );

  await insert(ops.outlines.create, (data) => tx.outline.createMany({ data }));
  await update(ops.outlines, ({ id, data }) => tx.outline.update({ where: { id }, data }));
  await insert(ops.outlineBeats.create, (data) => tx.outlineBeat.createMany({ data }));
  await update(ops.outlineBeats, ({ id, data }) => tx.outlineBeat.update({ where: { id }, data }));
  await insert(ops.beatScenes, (data) => tx.beatScene.createMany({ data }));

  await insert(ops.sceneParticipations.create, (data) =>
    tx.sceneParticipation.createMany({ data }),
  );
  for (const u of ops.sceneParticipations.update) {
    const [sceneId, characterId] = u.id.split("|");
    await tx.sceneParticipation.update({
      where: { sceneId_characterId: { sceneId, characterId } },
      data: u.data as never,
    });
  }

  await insert(ops.connections.create, (data) => tx.connection.createMany({ data }));
  await update(ops.connections, ({ id, data }) => tx.connection.update({ where: { id }, data }));

  await insert(ops.kits.create, (data) => tx.templateKit.createMany({ data }));
  await update(ops.kits, ({ id, data }) => tx.templateKit.update({ where: { id }, data }));
  if (ops.kitItemsReplaced.length)
    await tx.templateKitItem.deleteMany({ where: { kitId: { in: ops.kitItemsReplaced } } });
  await insert(ops.kitItems, (data) => tx.templateKitItem.createMany({ data }));

  await insert(ops.fieldDefinitions.create, (data) => tx.fieldDefinition.createMany({ data }));
  await update(ops.fieldDefinitions, ({ id, data }) =>
    tx.fieldDefinition.update({ where: { id }, data }),
  );
  await insert(ops.fieldValues.create, (data) => tx.nodeFieldValue.createMany({ data }));
  for (const u of ops.fieldValues.update) {
    const [nodeId, fieldId] = u.id.split("|");
    await tx.nodeFieldValue.update({
      where: { nodeId_fieldId: { nodeId, fieldId } },
      data: u.data as never,
    });
  }

  await insert(ops.writingSessions.create, (data) => tx.writingSession.createMany({ data }));
  await insert(
    ops.revisions.map((r) => ({ ...r, content: json(r.content) })),
    (data) => tx.contentRevision.createMany({ data }),
  );
  await insert(ops.fieldRevisions, (data) => tx.fieldRevision.createMany({ data }));

  if (ops.dailyWordGoal !== null)
    await tx.workspaceMember.updateMany({
      where: { workspaceId: ws, userId: ctx.userId, dailyWordGoal: null },
      data: { dailyWordGoal: ops.dailyWordGoal },
    });
}

/**
 * Before an import replaces existing objects, their current long-form text
 * (synopses, summaries, profile fields, descriptions, idea bodies, notes,
 * beat descriptions, bios) goes to field history (source IMPORT), as scene
 * and note text goes to version history: nothing is overwritten unrecoverably.
 */
async function keepTextHistory(tx: Tx, ctx: AuthorContext, ops: ImportOps) {
  const keep = async (
    table: TableOps,
    load: (ids: string[]) => Promise<({ id: string } & Record<string, unknown>)[]>,
    fields: (row: Record<string, unknown>, data: Row) => Record<string, string | null | undefined>,
    nodeOf: (row: Record<string, unknown>) => string = (row) => row.id as string,
  ) => {
    if (!table.update.length) return;
    const rows = new Map((await load(table.update.map((u) => u.id))).map((r) => [r.id, r]));
    for (const u of table.update) {
      const row = rows.get(u.id);
      if (!row) continue;
      const after = fields(row, u.data);
      const before = Object.fromEntries(
        Object.keys(after).map((key) => [key, beforeValue(row, key)]),
      );
      await recordFieldHistory(tx, ctx, nodeOf(row), before, after, "IMPORT");
    }
  };
  const ids = (list: string[]) => ({ where: { id: { in: list } } });
  const column = (name: string) => (_row: Record<string, unknown>, data: Row) =>
    name in data ? { [name]: (data[name] as string | null) ?? null } : {};

  await keep(ops.penNames, (l) => tx.penName.findMany(ids(l)), column("bio"));
  await keep(ops.series, (l) => tx.series.findMany(ids(l)), column("description"));
  await keep(ops.books, (l) => tx.book.findMany(ids(l)), column("description"));
  await keep(
    ops.scenes,
    (l) => tx.scene.findMany({ ...ids(l), select: { id: true, synopsis: true } }),
    column("synopsis"),
  );
  await keep(ops.relationships, (l) => tx.relationship.findMany(ids(l)), column("description"));
  await keep(ops.ideas, (l) => tx.idea.findMany(ids(l)), column("body"));
  await keep(ops.tasks, (l) => tx.task.findMany(ids(l)), column("notes"));
  await keep(ops.calendarEvents, (l) => tx.calendarEvent.findMany(ids(l)), column("description"));
  await keep(
    ops.characters,
    (l) => tx.character.findMany(ids(l)),
    (row, data) => {
      const current = (row.profile as Record<string, string> | null) ?? {};
      const next = (data.profile as Record<string, string> | undefined) ?? {};
      const keys = new Set([...Object.keys(current), ...Object.keys(next)]);
      return {
        ...column("summary")(row, data),
        ...Object.fromEntries(
          [...keys].map((k) => [`profile.${k}`, "profile" in data ? (next[k] ?? null) : undefined]),
        ),
      };
    },
  );
  await keep(
    ops.outlineBeats,
    (l) => tx.outlineBeat.findMany(ids(l)),
    (row, data) =>
      "description" in data
        ? { [`beat:${row.id as string}.description`]: (data.description as string | null) ?? null }
        : {},
    (row) => row.outlineId as string,
  );
}

/** A row's current value of a history field name (column, profile field or beat description). */
function beforeValue(row: Record<string, unknown>, field: string) {
  if (field.startsWith("profile."))
    return ((row.profile as Record<string, string> | null) ?? {})[field.slice(8)] ?? null;
  if (field.startsWith("beat:")) return (row.description as string | null) ?? null;
  return (row[field] as string | null) ?? null;
}
