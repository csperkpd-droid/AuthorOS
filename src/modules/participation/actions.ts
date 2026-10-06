"use server";

import { listParticipationHistory } from "@/modules/history";
import { runAction } from "@/server/action";
import { requireAuthorContext } from "@/server/context";

import type { ParticipantChange, PovChange, ScenePresence } from "./schemas";
import {
  addNewCharacterToScene,
  addParticipant,
  removeParticipant,
  setPointOfView,
  updateParticipant,
} from "./service";

/**
 * Puts a character in a scene: an existing one (`characterId`) or a new one
 * created from `newName` (it joins the scene's pen name and series).
 */
export async function addToSceneAction(
  sceneId: string,
  {
    characterId,
    newName,
    presence,
    pov = false,
  }: { characterId?: string; newName?: string; presence?: ScenePresence; pov?: boolean },
) {
  return runAction(async () => {
    const ctx = await requireAuthorContext();
    if (characterId) {
      await addParticipant(ctx, sceneId, { characterId, presence, pov });
      return { id: characterId };
    }
    return addNewCharacterToScene(ctx, sceneId, { name: newName ?? "", presence, pov });
  });
}

export async function updateParticipantAction(
  sceneId: string,
  characterId: string,
  change: ParticipantChange,
) {
  return runAction(async () =>
    updateParticipant(await requireAuthorContext(), sceneId, characterId, change),
  );
}

export async function setPointOfViewAction(sceneId: string, change: PovChange) {
  return runAction(async () => setPointOfView(await requireAuthorContext(), sceneId, change));
}

export async function removeParticipantAction(sceneId: string, characterId: string) {
  return runAction(async () =>
    removeParticipant(await requireAuthorContext(), sceneId, characterId),
  );
}

export async function listParticipationHistoryAction(sceneId: string) {
  return runAction(async () => listParticipationHistory(await requireAuthorContext(), sceneId), {
    refresh: false,
  });
}
