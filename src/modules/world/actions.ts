"use server";

import { field, runAction } from "@/server/action";
import { requireAuthorContext } from "@/server/context";

import {
  createPlace,
  createWorldEntry,
  trashPlace,
  trashWorldEntry,
  updatePlace,
  updateWorldEntry,
} from "./service";

const fromForm = (formData: FormData) => ({
  name: field(formData, "name"),
  summary: field(formData, "summary"),
  seriesId: field(formData, "seriesId"),
  penNameId: field(formData, "penNameId") || undefined,
});

const guardOf = (formData: FormData) => ({
  expectedUpdatedAt: field(formData, "updatedAt") || undefined,
});

export async function createPlaceAction(formData: FormData) {
  return runAction(async () => createPlace(await requireAuthorContext(), fromForm(formData)), {
    refresh: false,
  });
}

export async function updatePlaceAction(id: string, formData: FormData) {
  return runAction(async () =>
    updatePlace(await requireAuthorContext(), id, fromForm(formData), guardOf(formData)),
  );
}

export async function trashPlaceAction(id: string) {
  return runAction(async () => trashPlace(await requireAuthorContext(), id), { refresh: false });
}

const entryFromForm = (formData: FormData) => ({
  ...fromForm(formData),
  entryType: field(formData, "entryType"),
});

export async function createWorldEntryAction(formData: FormData) {
  return runAction(
    async () => createWorldEntry(await requireAuthorContext(), entryFromForm(formData)),
    { refresh: false },
  );
}

export async function updateWorldEntryAction(id: string, formData: FormData) {
  return runAction(async () =>
    updateWorldEntry(await requireAuthorContext(), id, entryFromForm(formData), guardOf(formData)),
  );
}

export async function trashWorldEntryAction(id: string) {
  return runAction(async () => trashWorldEntry(await requireAuthorContext(), id), {
    refresh: false,
  });
}
