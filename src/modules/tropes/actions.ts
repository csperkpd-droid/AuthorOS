"use server";

import { field, runAction } from "@/server/action";
import { requireAuthorContext } from "@/server/context";

import type { AddTropeInput } from "./schemas";
import {
  addTrope,
  createTrope,
  removeTrope,
  restoreTrope,
  trashTrope,
  updateTrope,
} from "./service";

export async function createTropeAction(name: string) {
  return runAction(async () => createTrope(await requireAuthorContext(), { name }), {
    refresh: false,
  });
}

export async function updateTropeAction(id: string, formData: FormData) {
  return runAction(async () =>
    updateTrope(
      await requireAuthorContext(),
      id,
      { name: field(formData, "name"), description: field(formData, "description") },
      { expectedUpdatedAt: field(formData, "updatedAt") || undefined },
    ),
  );
}

export async function trashTropeAction(id: string) {
  return runAction(async () => trashTrope(await requireAuthorContext(), id), {
    refresh: false,
  });
}

export async function restoreTropeAction(id: string) {
  return runAction(async () => restoreTrope(await requireAuthorContext(), id));
}

export async function addTropeAction(targetId: string, input: AddTropeInput) {
  return runAction(async () => addTrope(await requireAuthorContext(), targetId, input));
}

export async function removeTropeAction(targetId: string, tropeId: string) {
  return runAction(async () => removeTrope(await requireAuthorContext(), targetId, tropeId));
}
