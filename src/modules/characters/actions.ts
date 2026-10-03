"use server";

import { NotFoundError } from "@/lib/errors";
import { connect } from "@/modules/connections";
import { resolveNode } from "@/modules/story-graph";
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
    let id = characterId;
    if (!id) {
      // A new character joins the scene's pen name and series.
      const scene = await resolveNode(ctx, sceneId);
      if (!scene) throw new NotFoundError("Scene");
      const home = scene.seriesId
        ? { seriesId: scene.seriesId }
        : { penNameId: scene.penNameId ?? undefined };
      id = (await createCharacter(ctx, { name: newName ?? "", ...home })).id;
    }
    await connect(ctx, { sourceId: id, targetId: sceneId, kind: "appears_in", attribute: role });
    return { id };
  });
}
