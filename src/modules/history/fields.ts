import "server-only";

import { Prisma, type StoryNodeKind } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { NotFoundError, RuleError } from "@/lib/errors";
import { nodeKind, resolveNode, storyObjectType } from "@/modules/story-graph";
import type { AuthorContext } from "@/server/context";
import { assertCan, assertCanView } from "@/server/policy";

import { PARTICIPATION_FIELD } from "./participation";
import { STORY_TIME_FIELD } from "./story-time";

/**
 * Field history (M8): earlier values of the long-form text that isn't a
 * rich-text document, such as synopses, summaries, character profile
 * fields, descriptions, idea bodies, beat descriptions, task notes, and
 * pen-name bios. Every edit that replaces a non-empty value keeps the old
 * value first (in the same transaction), so no long-form text is lost to an
 * edit, an import or a restore. Restoring keeps the current value too.
 *
 * Field names: a column ("synopsis"), a character profile field
 * ("profile.goal"), or a beat's description ("beat:<id>.description", kept on
 * the beat's structure).
 */

type Tx = Prisma.TransactionClient;
type Client = Tx | typeof db;
export type FieldValues = Record<string, string | null | undefined>;

const PROFILE = /^profile\.([a-zA-Z0-9_-]{1,60})$/;
const BEAT = /^beat:([0-9a-f-]{36})\.description$/;

/** The text fields with history, per kind: table and column. */
const COLUMNS: Partial<Record<StoryNodeKind, Record<string, { table: string; column: string }>>> = {
  SCENE: { synopsis: { table: "scenes", column: "synopsis" } },
  CHARACTER: { summary: { table: "characters", column: "summary" } },
  RELATIONSHIP: { description: { table: "relationships", column: "description" } },
  SERIES: { description: { table: "series", column: "description" } },
  BOOK: { description: { table: "books", column: "description" } },
  IDEA: { body: { table: "ideas", column: "body" } },
  TASK: { notes: { table: "tasks", column: "notes" } },
  EVENT: { description: { table: "calendar_events", column: "description" } },
  PEN_NAME: { bio: { table: "pen_names", column: "bio" } },
  TIMELINE_EVENT: { description: { table: "timeline_events", column: "description" } },
  // Descriptions only: trope names have no history (decision 110).
  TROPE: { description: { table: "tropes", column: "description" } },
};

function fieldOf(kind: StoryNodeKind, field: string) {
  const column = COLUMNS[kind]?.[field];
  if (column) return { type: "column" as const, ...column };
  const profile = kind === "CHARACTER" ? PROFILE.exec(field) : null;
  if (profile) return { type: "profile" as const, key: profile[1] };
  const beat = kind === "OUTLINE" ? BEAT.exec(field) : null;
  if (beat) return { type: "beat" as const, beatId: beat[1] };
  return null;
}

const empty = (v: string | null | undefined) => !v || v.trim() === "";

/**
 * Keeps the previous value of every field that `after` changes (undefined
 * = not part of this edit). Call inside the edit's transaction, before or
 * after writing. Empty previous values have nothing to keep.
 */
export async function recordFieldHistory(
  client: Client,
  ctx: AuthorContext,
  nodeId: string,
  /** The current row (extra columns such as `updatedAt` are ignored). */
  before: Record<string, unknown>,
  after: FieldValues,
  source: "BEFORE_EDIT" | "BEFORE_RESTORE" | "IMPORT" = "BEFORE_EDIT",
) {
  const text = (field: string) => {
    const v = before[field];
    return typeof v === "string" ? v : null;
  };
  const rows = Object.entries(after)
    .filter(([field, value]) => {
      if (value === undefined) return false;
      const previous = text(field);
      return !empty(previous) && (previous ?? "") !== (value ?? "");
    })
    .map(([field]) => ({
      workspaceId: ctx.workspaceId,
      nodeId,
      field,
      value: text(field)!,
      source,
      createdById: ctx.userId,
    }));
  if (rows.length) await client.fieldRevision.createMany({ data: rows });
}

async function readField(client: Client, kind: StoryNodeKind, nodeId: string, field: string) {
  const spec = fieldOf(kind, field);
  if (!spec) throw new RuleError("That field has no history.");
  if (spec.type === "column") {
    const rows = await client.$queryRaw<{ value: string | null }[]>(
      Prisma.sql`SELECT ${Prisma.raw(`"${spec.column}"`)}::text AS value
        FROM ${Prisma.raw(`"${spec.table}"`)} WHERE "id" = ${nodeId}::uuid`,
    );
    return rows[0]?.value ?? null;
  }
  if (spec.type === "profile") {
    const c = await client.character.findUniqueOrThrow({
      where: { id: nodeId },
      select: { profile: true },
    });
    const value = (c.profile as Record<string, unknown> | null)?.[spec.key];
    return typeof value === "string" ? value : null;
  }
  const beat = await client.outlineBeat.findFirst({
    where: { id: spec.beatId, outlineId: nodeId },
    select: { description: true },
  });
  if (!beat) throw new NotFoundError("Beat");
  return beat.description;
}

async function writeField(
  tx: Tx,
  kind: StoryNodeKind,
  nodeId: string,
  field: string,
  value: string | null,
) {
  const spec = fieldOf(kind, field)!;
  if (spec.type === "column") {
    await tx.$executeRaw(
      Prisma.sql`UPDATE ${Prisma.raw(`"${spec.table}"`)}
        SET ${Prisma.raw(`"${spec.column}"`)} = ${value}, "updated_at" = now()
        WHERE "id" = ${nodeId}::uuid`,
    );
    return;
  }
  if (spec.type === "profile") {
    const c = await tx.character.findUniqueOrThrow({
      where: { id: nodeId },
      select: { profile: true },
    });
    const profile = { ...((c.profile as Record<string, string> | null) ?? {}) };
    if (empty(value)) delete profile[spec.key];
    else profile[spec.key] = value!;
    await tx.character.update({ where: { id: nodeId }, data: { profile } });
    return;
  }
  await tx.outlineBeat.update({ where: { id: spec.beatId }, data: { description: value } });
}

export type FieldRevisionView = {
  id: string;
  field: string;
  value: string;
  source: string;
  createdAt: Date;
};

/** Earlier values of a visible object's text fields (optionally one field), newest first. */
export async function listFieldHistory(
  ctx: AuthorContext,
  nodeId: string,
  field?: string,
): Promise<FieldRevisionView[]> {
  assertCanView(ctx, "any", { kind: "NODE", id: nodeId });
  if (!(await resolveNode(ctx, nodeId))) throw new NotFoundError("Item");
  return db.fieldRevision.findMany({
    where: {
      workspaceId: ctx.workspaceId,
      nodeId,
      // Participation and Story Time changes are a record, not earlier text.
      ...(field
        ? { field }
        : {
            NOT: [{ field: { startsWith: PARTICIPATION_FIELD } }, { field: STORY_TIME_FIELD }],
          }),
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, field: true, value: true, source: true, createdAt: true },
    take: 200,
  });
}

/**
 * Puts an earlier value back. The current value is kept as a "before
 * restore" entry first, so restoring can be undone too.
 */
export async function restoreFieldValue(ctx: AuthorContext, revisionId: string) {
  assertCan(ctx, "edit", "any");
  const revision = await db.fieldRevision.findFirst({
    where: { id: revisionId, workspaceId: ctx.workspaceId },
  });
  if (!revision || !(await resolveNode(ctx, revision.nodeId)))
    throw new NotFoundError("Earlier value");
  const kind = (await nodeKind(ctx, revision.nodeId))!;
  assertCan(ctx, "edit", storyObjectType(kind).area);
  await db.$transaction(async (tx) => {
    const current = await readField(tx, kind, revision.nodeId, revision.field);
    await recordFieldHistory(
      tx,
      ctx,
      revision.nodeId,
      { [revision.field]: current },
      { [revision.field]: revision.value },
      "BEFORE_RESTORE",
    );
    await writeField(tx, kind, revision.nodeId, revision.field, revision.value);
  });
}
