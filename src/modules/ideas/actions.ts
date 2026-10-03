"use server";

import { field, runAction } from "@/server/action";
import { requireAuthorContext } from "@/server/context";

import { createIdea, promoteIdeaToBook, trashIdea, updateIdea } from "./service";

export async function createIdeaAction(formData: FormData) {
  return runAction(async () =>
    createIdea(await requireAuthorContext(), {
      title: field(formData, "title"),
      body: field(formData, "body"),
    }),
  );
}

export async function updateIdeaAction(id: string, formData: FormData) {
  return runAction(async () =>
    updateIdea(await requireAuthorContext(), id, {
      title: field(formData, "title"),
      body: field(formData, "body"),
      status: (field(formData, "status") || undefined) as never,
    }),
  );
}

/** Turns the idea into a book; the client opens the new book. */
export async function promoteIdeaAction(id: string) {
  return runAction(async () => promoteIdeaToBook(await requireAuthorContext(), id), {
    refresh: false,
  });
}

export async function trashIdeaAction(id: string) {
  return runAction(async () => trashIdea(await requireAuthorContext(), id), { refresh: false });
}
