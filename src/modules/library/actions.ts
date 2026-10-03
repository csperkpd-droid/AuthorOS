"use server";

import { field, runAction } from "@/server/action";
import { requireAuthorContext } from "@/server/context";

import {
  createBook,
  createSeries,
  moveBookInSeries,
  setBookSeries,
  trashBook,
  trashSeries,
  updateBook,
  updateSeries,
} from "./service";
import { bookInput, type BookInput } from "./schemas";

const optional = (value: string) => (value === "" ? undefined : value);

// Actions after which the client navigates away: no need to refresh the page
// being left. (Actions return ids and the client navigates; a server-side
// redirect would never resolve the awaited action promise.)
const NAVIGATES = { refresh: false };

export async function createSeriesAction(formData: FormData) {
  return runAction(async () => {
    const ctx = await requireAuthorContext();
    return createSeries(ctx, {
      title: field(formData, "title"),
      description: field(formData, "description"),
      penNameId: optional(field(formData, "penNameId")),
    });
  }, NAVIGATES);
}

export async function updateSeriesAction(id: string, formData: FormData) {
  return runAction(async () => {
    const ctx = await requireAuthorContext();
    await updateSeries(ctx, id, {
      title: field(formData, "title"),
      description: field(formData, "description"),
      penNameId: optional(field(formData, "penNameId")),
    });
    return null;
  });
}

export async function trashSeriesAction(id: string) {
  return runAction(async () => trashSeries(await requireAuthorContext(), id), NAVIGATES);
}

export async function createBookAction(formData: FormData) {
  return runAction(async () => {
    const ctx = await requireAuthorContext();
    return createBook(ctx, {
      title: field(formData, "title"),
      subtitle: field(formData, "subtitle"),
      seriesId: optional(field(formData, "seriesId")),
      penNameId: optional(field(formData, "penNameId")),
    });
  }, NAVIGATES);
}

export async function updateBookAction(id: string, formData: FormData) {
  return runAction(async () => {
    const ctx = await requireAuthorContext();
    const input: BookInput = {
      title: field(formData, "title"),
      subtitle: field(formData, "subtitle"),
      description: field(formData, "description"),
      status: field(formData, "status") as BookInput["status"],
      targetWordCount: field(formData, "targetWordCount"),
      penNameId: optional(field(formData, "penNameId")),
      ...(formData.has("tropes") && { tropes: field(formData, "tropes") }),
      ...(formData.has("heatLevel") && {
        heatLevel: field(formData, "heatLevel") as BookInput["heatLevel"],
      }),
    };
    bookInput.parse(input); // validate everything before changing anything
    // Series membership first: it decides whether the book may pick its own pen name.
    if (formData.has("seriesId")) {
      const seriesId = field(formData, "seriesId");
      await setBookSeries(ctx, id, seriesId === "" ? null : seriesId);
    }
    await updateBook(ctx, id, input);
    return null;
  });
}

export async function moveBookInSeriesAction(id: string, afterBookId: string | null) {
  return runAction(async () => moveBookInSeries(await requireAuthorContext(), id, afterBookId));
}

export async function trashBookAction(id: string) {
  return runAction(async () => trashBook(await requireAuthorContext(), id), NAVIGATES);
}
