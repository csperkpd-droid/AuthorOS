"use server";

import { setDeadline } from "@/modules/calendar";
import { field, runAction } from "@/server/action";
import { requireAuthorContext } from "@/server/context";

import {
  assertBookUnchanged,
  createBook,
  createSeries,
  moveBookInSeries,
  previewBookSeries,
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
    await updateSeries(
      ctx,
      id,
      {
        title: field(formData, "title"),
        description: field(formData, "description"),
        penNameId: optional(field(formData, "penNameId")),
      },
      { expectedUpdatedAt: field(formData, "updatedAt") || undefined },
    );
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

/** "What will this affect?" for changing a book's series. */
export async function previewBookSeriesAction(id: string, seriesId: string | null) {
  return runAction(async () => previewBookSeries(await requireAuthorContext(), id, seriesId), {
    refresh: false,
  });
}

export async function updateBookAction(id: string, formData: FormData) {
  return runAction(async () => {
    const ctx = await requireAuthorContext();
    const input: BookInput = {
      title: field(formData, "title"),
      subtitle: field(formData, "subtitle"),
      description: field(formData, "description"),
      writingStatus: field(formData, "writingStatus") as BookInput["writingStatus"],
      targetWordCount: field(formData, "targetWordCount"),
      ...(formData.has("heatLevel") && {
        heatLevel: field(formData, "heatLevel") as BookInput["heatLevel"],
      }),
    };
    bookInput.parse(input); // validate everything before changing anything
    const guard = { expectedUpdatedAt: field(formData, "updatedAt") || undefined };
    await assertBookUnchanged(ctx, id, guard);
    let seriesChanged = false;
    // Series membership first: it decides whether the book may pick its own pen name.
    if (formData.has("seriesId")) {
      const seriesId = field(formData, "seriesId");
      // Leaving a series is reviewed first (Change Impact); the token is the review's.
      seriesChanged = await setBookSeries(
        ctx,
        id,
        seriesId === "" ? null : seriesId,
        optional(field(formData, "seriesToken")) ?? undefined,
      );
    }
    // Moving series already changed the book; the guard was checked above.
    await updateBook(ctx, id, input, seriesChanged ? {} : guard);
    // The deadline is a calendar entry about the book (one source of truth for dates).
    if (formData.has("dueOn")) await setDeadline(ctx, id, field(formData, "dueOn"));
    return null;
  });
}

export async function moveBookInSeriesAction(id: string, afterBookId: string | null) {
  return runAction(async () => moveBookInSeries(await requireAuthorContext(), id, afterBookId));
}

export async function trashBookAction(id: string) {
  return runAction(async () => trashBook(await requireAuthorContext(), id), NAVIGATES);
}
