"use server";

import { runAction } from "@/server/action";
import { requireAuthorContext } from "@/server/context";

import { applyIdentityMove, previewIdentityMove, type IdentityMove } from "./service";

/** "What will this affect?" Read-only, so no refresh. */
export async function previewIdentityMoveAction(move: IdentityMove) {
  return runAction(async () => previewIdentityMove(await requireAuthorContext(), move), {
    refresh: false,
  });
}

export async function applyIdentityMoveAction(move: IdentityMove, token: string) {
  return runAction(async () => applyIdentityMove(await requireAuthorContext(), move, token));
}
