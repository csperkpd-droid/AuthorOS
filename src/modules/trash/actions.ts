"use server";

import type { StoryNodeKind } from "@/generated/prisma/enums";
import { runAction } from "@/server/action";
import { requireAuthorContext } from "@/server/context";

import {
  deleteForever,
  emptyTrash,
  previewDeleteForever,
  previewEmptyTrash,
  restoreFromTrash,
} from "./service";

export async function restoreAction(kind: StoryNodeKind, id: string) {
  return runAction(async () => restoreFromTrash(await requireAuthorContext(), kind, id));
}

/** "What will this affect?" Read-only. */
export async function previewDeleteForeverAction(kind: StoryNodeKind, id: string) {
  return runAction(async () => previewDeleteForever(await requireAuthorContext(), kind, id), {
    refresh: false,
  });
}

export async function deleteForeverAction(
  kind: StoryNodeKind,
  id: string,
  token: string,
  accepted: string[] = [],
) {
  return runAction(async () =>
    deleteForever(await requireAuthorContext(), kind, id, token, accepted),
  );
}

export async function previewEmptyTrashAction() {
  return runAction(async () => previewEmptyTrash(await requireAuthorContext()), {
    refresh: false,
  });
}

export async function emptyTrashAction(token: string, accepted: string[] = []) {
  return runAction(async () => emptyTrash(await requireAuthorContext(), token, accepted));
}
