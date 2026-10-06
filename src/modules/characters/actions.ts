"use server";

import { field, runAction } from "@/server/action";
import { requireAuthorContext } from "@/server/context";

import { createCharacter, trashCharacter, updateCharacter, updateProfileField } from "./service";

const fromForm = (formData: FormData) => ({
  name: field(formData, "name"),
  aliases: field(formData, "aliases"),
  role: (field(formData, "role") || undefined) as never,
  summary: field(formData, "summary"),
  seriesId: field(formData, "seriesId"),
  penNameId: field(formData, "penNameId") || undefined,
});

export async function createCharacterAction(formData: FormData) {
  return runAction(async () => createCharacter(await requireAuthorContext(), fromForm(formData)), {
    refresh: false,
  });
}

export async function updateCharacterAction(id: string, formData: FormData) {
  return runAction(async () =>
    updateCharacter(await requireAuthorContext(), id, fromForm(formData), {
      expectedUpdatedAt: field(formData, "updatedAt") || undefined,
    }),
  );
}

export async function updateProfileFieldAction(
  id: string,
  fieldId: string,
  value: string,
  /** The value the author started editing from (stale-edit protection). */
  expectedValue?: string,
) {
  return runAction(
    async () =>
      updateProfileField(await requireAuthorContext(), id, fieldId, value, { expectedValue }),
    {
      refresh: false,
    },
  );
}

export async function trashCharacterAction(id: string) {
  return runAction(async () => trashCharacter(await requireAuthorContext(), id), {
    refresh: false,
  });
}
