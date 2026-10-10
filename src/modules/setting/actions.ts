"use server";

import { listSettingHistory } from "@/modules/history";
import { runAction } from "@/server/action";
import { requireAuthorContext } from "@/server/context";

import { removeScenePlace, setSceneInNewPlace, setScenePlace } from "./service";

/** Sets a scene in an existing place (`placeId`) or a new one created from `newName`. */
export async function setScenePlaceAction(
  sceneId: string,
  { placeId, newName }: { placeId?: string; newName?: string },
) {
  return runAction(async () => {
    const ctx = await requireAuthorContext();
    if (placeId) {
      await setScenePlace(ctx, sceneId, placeId);
      return { id: placeId };
    }
    return setSceneInNewPlace(ctx, sceneId, newName ?? "");
  });
}

export async function removeScenePlaceAction(sceneId: string, placeId: string) {
  return runAction(async () => removeScenePlace(await requireAuthorContext(), sceneId, placeId));
}

export async function listSettingHistoryAction(sceneId: string) {
  return runAction(async () => listSettingHistory(await requireAuthorContext(), sceneId), {
    refresh: false,
  });
}
