"use server";

import type { TaskStatus } from "@/generated/prisma/enums";
import { runAction } from "@/server/action";
import { requireAuthorContext } from "@/server/context";

import type { TaskInput } from "./schemas";
import { createTask, setTaskDueDate, setTaskStatus, trashTask, updateTask } from "./service";

export async function createTaskAction(input: TaskInput & { concernsId?: string | null }) {
  return runAction(async () => createTask(await requireAuthorContext(), input));
}

export async function updateTaskAction(id: string, input: TaskInput, expectedUpdatedAt?: string) {
  return runAction(async () =>
    updateTask(await requireAuthorContext(), id, input, { expectedUpdatedAt }),
  );
}

export async function setTaskStatusAction(id: string, status: TaskStatus) {
  return runAction(async () => setTaskStatus(await requireAuthorContext(), id, status));
}

/** Week (M18): a new due date, or null for "No date". */
export async function setTaskDueDateAction(id: string, date: string | null) {
  return runAction(async () => setTaskDueDate(await requireAuthorContext(), id, date));
}

export async function trashTaskAction(id: string) {
  return runAction(async () => trashTask(await requireAuthorContext(), id), { refresh: false });
}
