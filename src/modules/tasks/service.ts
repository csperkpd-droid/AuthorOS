import "server-only";

import type { Prisma, TaskStatus } from "@/generated/prisma/client";
import { fromDbDate, toDbDate, type DateString } from "@/lib/dates";
import { db } from "@/lib/db";
import { assertNotStale, staleError, type EditGuard } from "@/lib/concurrency";
import { NotFoundError } from "@/lib/errors";
import { createPlannedConnection, planConnection } from "@/modules/connections";
import { createStoryNode, liveTask, resolveNodes, type NodeSummary } from "@/modules/story-graph";
import type { AuthorContext } from "@/server/context";
import { recordFieldHistory } from "@/modules/history";
import { assertCan } from "@/server/policy";

import { taskInput, taskStatus, type TaskInput } from "./schemas";

/**
 * Tasks: the author's to-dos, with priority and an optional due date. A task
 * is a story node; what it concerns (a book, a scene, a character…) is a set
 * of `concerns` connections, so any story object can have tasks. Tasks are
 * author-level, shared across identities like notes.
 */

const taskSelect = {
  id: true,
  title: true,
  notes: true,
  status: true,
  priority: true,
  dueOn: true,
  completedAt: true,
  updatedAt: true,
} as const;

type Row = Prisma.TaskGetPayload<{ select: typeof taskSelect }>;
export type TaskView = Omit<Row, "dueOn"> & { dueOn: DateString | null; concerns: NodeSummary[] };

async function withConcerns(ctx: AuthorContext, rows: Row[]): Promise<TaskView[]> {
  const links = await db.connection.findMany({
    where: {
      workspaceId: ctx.workspaceId,
      kind: "concerns",
      sourceId: { in: rows.map((r) => r.id) },
    },
    orderBy: { createdAt: "asc" },
    select: { sourceId: true, targetId: true },
  });
  const nodes = await resolveNodes(
    ctx,
    links.map((l) => l.targetId),
  );
  return rows.map((r) => ({
    ...r,
    dueOn: r.dueOn ? fromDbDate(r.dueOn) : null,
    concerns: links.filter((l) => l.sourceId === r.id).flatMap((l) => nodes.get(l.targetId) ?? []),
  }));
}

export type TaskFilter = {
  status?: "open" | "done" | "all";
  /** Only tasks concerning this story object. */
  concernsId?: string;
  /** Only tasks due within [from, to]. */
  dueFrom?: DateString;
  dueTo?: DateString;
};

/** Open tasks first by due date (undated last), then by priority. */
export async function listTasks(ctx: AuthorContext, filter: TaskFilter = {}) {
  const { status = "open" } = filter;
  const rows = await db.task.findMany({
    where: {
      workspaceId: ctx.workspaceId,
      ...liveTask,
      ...(status === "open" ? { status: { not: "DONE" } } : {}),
      ...(status === "done" ? { status: "DONE" } : {}),
      ...(filter.concernsId
        ? { node: { outgoing: { some: { kind: "concerns", targetId: filter.concernsId } } } }
        : {}),
      ...(filter.dueFrom || filter.dueTo
        ? {
            dueOn: {
              ...(filter.dueFrom ? { gte: toDbDate(filter.dueFrom) } : {}),
              ...(filter.dueTo ? { lte: toDbDate(filter.dueTo) } : {}),
            },
          }
        : {}),
    },
    orderBy:
      status === "done"
        ? [{ completedAt: "desc" }]
        : [{ dueOn: { sort: "asc", nulls: "last" } }, { priority: "desc" }, { createdAt: "asc" }],
    select: taskSelect,
  });
  return withConcerns(ctx, rows);
}

export async function getTask(ctx: AuthorContext, id: string): Promise<TaskView> {
  const row = await db.task.findFirst({
    where: { id, workspaceId: ctx.workspaceId, ...liveTask },
    select: taskSelect,
  });
  if (!row) throw new NotFoundError("Task");
  return (await withConcerns(ctx, [row]))[0];
}

/** Creates a task, optionally already concerning a story object (atomically). */
export async function createTask(
  ctx: AuthorContext,
  input: TaskInput & { concernsId?: string | null },
) {
  assertCan(ctx, "edit", "planning");
  const data = taskInput.parse(input);
  return db.$transaction(async (tx) => {
    const id = await createStoryNode(tx, ctx.workspaceId, "TASK");
    const plan = input.concernsId
      ? await planConnection(
          ctx,
          { sourceId: id, targetId: input.concernsId, kind: "concerns" },
          { id, kind: "TASK" },
        )
      : null;
    await tx.task.create({
      data: {
        id,
        workspaceId: ctx.workspaceId,
        title: data.title,
        notes: data.notes ?? null,
        priority: data.priority ?? "NORMAL",
        dueOn: data.dueOn ? toDbDate(data.dueOn) : null,
      },
    });
    if (plan) await createPlannedConnection(tx, ctx, plan);
    return { id };
  });
}

export async function updateTask(
  ctx: AuthorContext,
  id: string,
  input: TaskInput,
  guard: EditGuard = {},
) {
  assertCan(ctx, "edit", "planning");
  const data = taskInput.parse(input);
  await getTask(ctx, id);
  await db.$transaction(async (tx) => {
    const row = await tx.task.findUniqueOrThrow({
      where: { id },
      select: { notes: true, updatedAt: true },
    });
    assertNotStale(row.updatedAt, guard.expectedUpdatedAt, "task");
    await recordFieldHistory(tx, ctx, id, row, { notes: data.notes ?? null });
    const { count } = await tx.task.updateMany({
      where: { id, updatedAt: row.updatedAt },
      data: {
        title: data.title,
        notes: data.notes ?? null,
        ...(data.priority && { priority: data.priority }),
        dueOn: data.dueOn ? toDbDate(data.dueOn) : null,
      },
    });
    if (count === 0) throw staleError("task");
  });
}

/** Marks a task to do, in progress or done (done records when). */
export async function setTaskStatus(ctx: AuthorContext, id: string, status: TaskStatus) {
  assertCan(ctx, "edit", "planning");
  const next = taskStatus.parse(status);
  const task = await getTask(ctx, id);
  if (task.status === next) return;
  await db.task.update({
    where: { id },
    data: { status: next, completedAt: next === "DONE" ? new Date() : null },
  });
}

export async function trashTask(ctx: AuthorContext, id: string) {
  assertCan(ctx, "edit", "planning");
  await getTask(ctx, id);
  await db.task.update({ where: { id }, data: { deletedAt: new Date() } });
}
