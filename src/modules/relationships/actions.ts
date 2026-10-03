"use server";

import { field, runAction } from "@/server/action";
import { requireAuthorContext } from "@/server/context";

import { createRelationship, trashRelationship, updateRelationship } from "./service";

export async function createRelationshipAction(formData: FormData) {
  return runAction(async () =>
    createRelationship(await requireAuthorContext(), {
      characterId: field(formData, "characterId"),
      otherCharacterId: field(formData, "otherCharacterId"),
      type: field(formData, "type"),
      description: field(formData, "description"),
    }),
  );
}

export async function updateRelationshipAction(id: string, formData: FormData) {
  return runAction(async () =>
    updateRelationship(await requireAuthorContext(), id, {
      type: field(formData, "type"),
      description: field(formData, "description"),
    }),
  );
}

export async function trashRelationshipAction(id: string) {
  return runAction(async () => trashRelationship(await requireAuthorContext(), id), {
    refresh: false,
  });
}
