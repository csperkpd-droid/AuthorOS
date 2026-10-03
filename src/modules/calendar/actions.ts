"use server";

import { runAction } from "@/server/action";
import { requireAuthorContext } from "@/server/context";

import type { EventInput } from "./schemas";
import { createEvent, trashEvent, updateEvent } from "./service";

export async function createEventAction(input: EventInput & { concernsId?: string | null }) {
  return runAction(async () => createEvent(await requireAuthorContext(), input));
}

export async function updateEventAction(id: string, input: EventInput) {
  return runAction(async () => updateEvent(await requireAuthorContext(), id, input));
}

export async function trashEventAction(id: string) {
  return runAction(async () => trashEvent(await requireAuthorContext(), id), { refresh: false });
}
