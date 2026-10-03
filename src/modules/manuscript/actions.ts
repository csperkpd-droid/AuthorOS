"use server";

import { runAction } from "@/server/action";
import { requireAuthorContext } from "@/server/context";

import { saveSceneContent, updateSceneDetails } from "./content";
import type { SceneDetailsInput } from "./schemas";
import {
  createChapter,
  createPart,
  createScene,
  dissolvePart,
  previewDissolvePart,
  moveChapter,
  movePart,
  moveScene,
  renameChapter,
  renamePart,
  trashChapter,
  trashPart,
  trashScene,
} from "./structure";

const ctx = requireAuthorContext;

// ─── Structure ──────────────────────────────────────────────────────────────

/** Structure is added with default titles ("Chapter 3"); authors rename inline. */
export async function addPartAction(bookId: string) {
  return runAction(async () => createPart(await ctx(), bookId));
}

export async function addChapterAction(bookId: string, partId: string | null) {
  return runAction(async () => createChapter(await ctx(), bookId, { partId }));
}

export async function addSceneAction(chapterId: string) {
  return runAction(async () => createScene(await ctx(), chapterId));
}

export async function renamePartAction(id: string, title: string) {
  return runAction(async () => renamePart(await ctx(), id, title));
}

export async function renameChapterAction(id: string, title: string) {
  return runAction(async () => renameChapter(await ctx(), id, title));
}

export async function movePartAction(id: string, afterId: string | null) {
  return runAction(async () => movePart(await ctx(), id, afterId));
}

export async function moveChapterAction(id: string, partId: string | null, afterId: string | null) {
  return runAction(async () => moveChapter(await ctx(), id, { partId, afterId }));
}

export async function moveSceneAction(id: string, chapterId: string, afterId: string | null) {
  return runAction(async () => moveScene(await ctx(), id, { chapterId, afterId }));
}

export async function previewDissolvePartAction(id: string) {
  return runAction(async () => previewDissolvePart(await ctx(), id), { refresh: false });
}

export async function dissolvePartAction(id: string, token: string) {
  return runAction(async () => dissolvePart(await ctx(), id, token));
}

export async function trashPartAction(id: string) {
  return runAction(async () => trashPart(await ctx(), id));
}

export async function trashChapterAction(id: string) {
  return runAction(async () => trashChapter(await ctx(), id));
}

/** Trashes a scene. `leaving`: the client navigates away, so skip the refresh. */
export async function trashSceneAction(id: string, leaving = false) {
  return runAction(async () => trashScene(await ctx(), id), { refresh: !leaving });
}

// ─── Writing ────────────────────────────────────────────────────────────────

/** Autosave. Does not refresh the page, so the editor is never re-rendered under the author. */
export async function saveSceneContentAction(
  sceneId: string,
  content: unknown,
  baseVersion: number,
) {
  return runAction(async () => saveSceneContent(await ctx(), { sceneId, content, baseVersion }), {
    refresh: false,
  });
}

export async function updateSceneDetailsAction(sceneId: string, input: SceneDetailsInput) {
  return runAction(async () => updateSceneDetails(await ctx(), sceneId, input));
}
