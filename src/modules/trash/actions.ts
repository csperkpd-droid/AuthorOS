"use server";

import type { StoryNodeKind } from "@/generated/prisma/enums";
import { runAction } from "@/server/action";
import { requireAuthorContext } from "@/server/context";

import { deleteForever, emptyTrash, restoreFromTrash } from "./service";

export async function restoreAction(kind: StoryNodeKind, id: string) {
  return runAction(async () => restoreFromTrash(await requireAuthorContext(), kind, id));
}

export async function deleteForeverAction(kind: StoryNodeKind, id: string) {
  return runAction(async () => deleteForever(await requireAuthorContext(), kind, id));
}

export async function emptyTrashAction() {
  return runAction(async () => emptyTrash(await requireAuthorContext()));
}
