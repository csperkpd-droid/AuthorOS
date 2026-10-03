"use server";

import { connect } from "@/modules/connections";
import { field, runAction } from "@/server/action";
import { requireAuthorContext } from "@/server/context";

import { createCharacter, trashCharacter, updateCharacter, updateProfileField } from "./service";

const fromForm = (formData: FormData) => ({
  name: field(formData, "name"),
  aliases: field(formData, "aliases"),
  role: (field(formData, "role") || undefined) as never,
  summary: field(formData, "summary"),
  seriesId: field(formData, "seriesId"),
});

export async function createCharacterAction(formData: FormData) {
  return runAction(async () => createCharacter(await requireAuthorContext(), fromForm(formData)), {
    refresh: false,
  });
}

export async function updateCharacterAction(id: string, formData: FormData) {
  return runAction(async () =>
    updateCharacter(await requireAuthorContext(), id, fromForm(formData)),
  );
}

export async function updateProfileFieldAction(id: string, fieldId: string, value: string) {
  return runAction(
    async () => updateProfileField(await requireAuthorContext(), id, fieldId, value),
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

/**
 * Puts a character in a scene: an existing one (`characterId`) or a new one
 * created from `newName`.
 */
export async function addCharacterToSceneAction(
  sceneId: string,
  { characterId, newName, role }: { characterId?: string; newName?: string; role?: string },
) {
  return runAction(async () => {
    const ctx = await requireAuthorContext();
    const id = characterId ?? (await createCharacter(ctx, { name: newName ?? "" })).id;
    await connect(ctx, { sourceId: id, targetId: sceneId, kind: "appears_in", attribute: role });
    return { id };
  });
}
