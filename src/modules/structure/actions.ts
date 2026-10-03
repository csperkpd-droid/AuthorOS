"use server";

import type { ArcRole } from "@/generated/prisma/enums";
import { runAction } from "@/server/action";
import { requireAuthorContext } from "@/server/context";

import type { BeatInput, NewOutlineInput, TemplateInput } from "./schemas";
import {
  addBeat,
  assignScene,
  createOutline,
  deleteBeat,
  deleteTemplate,
  moveBeat,
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

export async function deleteTemplateAction(id: string) {
  return runAction(async () => deleteTemplate(await ctx(), id));
}

export async function addBeatAction(outlineId: string, input: BeatInput) {
  return runAction(async () => addBeat(await ctx(), outlineId, input));
}

export async function updateBeatAction(beatId: string, input: BeatInput) {
  return runAction(async () => updateBeat(await ctx(), beatId, input));
}

export async function moveBeatAction(beatId: string, afterBeatId: string | null) {
  return runAction(async () => moveBeat(await ctx(), beatId, afterBeatId));
}

export async function deleteBeatAction(beatId: string) {
  return runAction(async () => deleteBeat(await ctx(), beatId));
}

export async function assignSceneAction(beatId: string, sceneId: string) {
  return runAction(async () => assignScene(await ctx(), beatId, sceneId));
}

export async function unassignSceneAction(beatId: string, sceneId: string) {
  return runAction(async () => unassignScene(await ctx(), beatId, sceneId));
}
