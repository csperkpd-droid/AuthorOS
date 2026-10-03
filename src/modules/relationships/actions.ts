"use server";

import { field, runAction } from "@/server/action";
import { requireAuthorContext } from "@/server/context";

import {
  createRelationship,
  setRelationshipMembers,
  trashRelationship,
  updateRelationship,
} from "./service";

export async function createRelationshipAction(formData: FormData) {
  return runAction(async () =>
    createRelationship(await requireAuthorContext(), {
      characterIds: [
        field(formData, "characterId"),
        field(formData, "otherCharacterId"),
        ...formData.getAll("moreCharacterIds").map(String),
      ].filter(Boolean),
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

export async function setRelationshipMembersAction(id: string, characterIds: string[]) {
  return runAction(async () =>
    setRelationshipMembers(await requireAuthorContext(), id, characterIds),
  );
}

/** Creates the relationship between some members of a group (e.g. one pair). */
export async function createWithinGroupAction(characterIds: string[], type: string) {
  return runAction(async () =>
    createRelationship(await requireAuthorContext(), { characterIds, type }),
  );
}
