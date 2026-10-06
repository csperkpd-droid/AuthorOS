"use server";

import type { PlaceAnchor } from "@/lib/work-place";
import { runAction } from "@/server/action";
import { requireAuthorContext } from "@/server/context";

import { listWorkPlaces, setWritingPlace } from "./service";

/** Records the writing place (no refresh: it must never disturb the editor). */
export async function setWritingPlaceAction(sceneId: string, anchor: PlaceAnchor | null) {
  return runAction(async () => setWritingPlace(await requireAuthorContext(), sceneId, anchor), {
    refresh: false,
  });
}

export async function listWorkPlacesAction(ids: string[]) {
  return runAction(async () => listWorkPlaces(await requireAuthorContext(), ids), {
    refresh: false,
  });
}
