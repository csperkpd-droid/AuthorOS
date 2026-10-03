"use server";

import { field, runAction } from "@/server/action";
import { requireAuthorContext } from "@/server/context";

import {
  archivePenName,
  createPenName,
  restorePenName,
  setActiveIdentity,
  setDefaultPenName,
  updatePenName,
} from "./service";

export async function savePenNameAction(id: string | null, formData: FormData) {
  return runAction(async () => {
    const ctx = await requireAuthorContext();
    const input = {
      name: field(formData, "name"),
      bio: field(formData, "bio"),
      ...(formData.has("language") && { language: field(formData, "language") }),
    };
    if (id)
      await updatePenName(ctx, id, input, {
        expectedUpdatedAt: field(formData, "updatedAt") || undefined,
      });
    else await createPenName(ctx, input);
    return null;
  });
}

export async function setDefaultPenNameAction(id: string) {
  return runAction(async () => setDefaultPenName(await requireAuthorContext(), id));
}

export async function archivePenNameAction(id: string) {
  return runAction(async () => archivePenName(await requireAuthorContext(), id));
}

export async function restorePenNameAction(id: string) {
  return runAction(async () => restorePenName(await requireAuthorContext(), id));
}

/** Switch the identity the author is working as; null = all identities. */
export async function switchIdentityAction(penNameId: string | null) {
  return runAction(async () => setActiveIdentity(await requireAuthorContext(), penNameId));
}
