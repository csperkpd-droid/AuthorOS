"use server";

import type { ArcRole } from "@/generated/prisma/enums";
import { runAction } from "@/server/action";
import { requireAuthorContext } from "@/server/context";

import { applyKit, createKit, deleteKit, saveStructuresAsKit, updateKit } from "./kits";
import type { ApplyKitInput, BeatInput, KitInput, NewOutlineInput, TemplateInput } from "./schemas";
import {
  addBeat,
  assignScene,
  createOutline,
  deleteBeat,
  previewDeleteBeat,
  deleteTemplate,
  moveBeat,
  previewDeleteTemplate,
  renameOutline,
  renameTemplate,
  saveAsTemplate,
  setArcRole,
  trashOutline,
  unassignScene,
  updateBeat,
} from "./service";

const ctx = requireAuthorContext;

/** Creates a structure; the client opens it. */
export async function createOutlineAction(input: NewOutlineInput) {
  return runAction(async () => createOutline(await ctx(), input), { refresh: false });
}

export async function renameOutlineAction(id: string, title: string) {
  return runAction(async () => renameOutline(await ctx(), id, title));
}

export async function setArcRoleAction(id: string, arcRole: ArcRole) {
  return runAction(async () => setArcRole(await ctx(), id, arcRole));
}

export async function trashOutlineAction(id: string) {
  return runAction(async () => trashOutline(await ctx(), id), { refresh: false });
}

export async function saveAsTemplateAction(outlineId: string, input: TemplateInput) {
  return runAction(async () => saveAsTemplate(await ctx(), outlineId, input));
}

export async function renameTemplateAction(id: string, input: TemplateInput) {
  return runAction(async () => renameTemplate(await ctx(), id, input));
}

export async function previewDeleteTemplateAction(id: string) {
  return runAction(async () => previewDeleteTemplate(await ctx(), id), { refresh: false });
}

export async function deleteTemplateAction(id: string, token: string) {
  return runAction(async () => deleteTemplate(await ctx(), id, token));
}

export async function createKitAction(input: KitInput) {
  return runAction(async () => createKit(await ctx(), input));
}

export async function updateKitAction(id: string, input: KitInput) {
  return runAction(async () => updateKit(await ctx(), id, input));
}

export async function deleteKitAction(id: string) {
  return runAction(async () => deleteKit(await ctx(), id));
}

export async function saveStructuresAsKitAction(
  target: { bookId?: string; seriesId?: string },
  name: string,
) {
  return runAction(async () => saveStructuresAsKit(await ctx(), { ...target, name }));
}

export async function applyKitAction(input: ApplyKitInput) {
  return runAction(async () => applyKit(await ctx(), input));
}

export async function addBeatAction(outlineId: string, input: BeatInput) {
  return runAction(async () => addBeat(await ctx(), outlineId, input));
}

export async function updateBeatAction(
  beatId: string,
  input: BeatInput,
  expectedUpdatedAt?: string,
) {
  return runAction(async () => updateBeat(await ctx(), beatId, input, { expectedUpdatedAt }));
}

export async function moveBeatAction(beatId: string, afterBeatId: string | null) {
  return runAction(async () => moveBeat(await ctx(), beatId, afterBeatId));
}

export async function previewDeleteBeatAction(beatId: string) {
  return runAction(async () => previewDeleteBeat(await ctx(), beatId), { refresh: false });
}

export async function deleteBeatAction(beatId: string, token: string, accepted: string[] = []) {
  return runAction(async () => deleteBeat(await ctx(), beatId, token, accepted));
}

export async function assignSceneAction(beatId: string, sceneId: string) {
  return runAction(async () => assignScene(await ctx(), beatId, sceneId));
}

export async function unassignSceneAction(beatId: string, sceneId: string) {
  return runAction(async () => unassignScene(await ctx(), beatId, sceneId));
}
