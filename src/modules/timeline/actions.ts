"use server";

import { listStoryTimeHistory } from "@/modules/history";
import { field, runAction } from "@/server/action";
import { requireAuthorContext } from "@/server/context";

import type { NewTimelineEventInput, PlacementInput } from "./schemas";
import {
  createTimelineEvent,
  moveTimelineEvent,
  placeSceneInTime,
  removeSceneFromTime,
  setStoryTimeLabel,
  trashTimelineEvent,
  updateTimelineEvent,
} from "./service";

export async function placeSceneInTimeAction(sceneId: string, input: PlacementInput) {
  return runAction(async () => placeSceneInTime(await requireAuthorContext(), sceneId, input));
}

export async function setStoryTimeLabelAction(
  sceneId: string,
  label: string,
  expected: string | null,
) {
  return runAction(async () =>
    setStoryTimeLabel(await requireAuthorContext(), sceneId, { label, expected }),
  );
}

export async function removeSceneFromTimeAction(sceneId: string) {
  return runAction(async () => removeSceneFromTime(await requireAuthorContext(), sceneId));
}

export async function createTimelineEventAction(input: NewTimelineEventInput) {
  return runAction(async () => createTimelineEvent(await requireAuthorContext(), input));
}

export async function updateTimelineEventAction(id: string, formData: FormData) {
  return runAction(async () =>
    updateTimelineEvent(
      await requireAuthorContext(),
      id,
      {
        title: field(formData, "title"),
        label: field(formData, "label"),
        description: field(formData, "description"),
      },
      { expectedUpdatedAt: field(formData, "updatedAt") || undefined },
    ),
  );
}

export async function moveTimelineEventAction(id: string, afterId: string | null) {
  return runAction(async () => moveTimelineEvent(await requireAuthorContext(), id, afterId));
}

export async function trashTimelineEventAction(id: string) {
  return runAction(async () => trashTimelineEvent(await requireAuthorContext(), id), {
    refresh: false,
  });
}

export async function listStoryTimeHistoryAction(sceneId: string) {
  return runAction(async () => listStoryTimeHistory(await requireAuthorContext(), sceneId), {
    refresh: false,
  });
}
