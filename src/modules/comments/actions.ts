"use server";

import { runAction } from "@/server/action";
import { requireAuthorContext } from "@/server/context";

import type { AnchorInput, NewCommentInput } from "./schemas";
import type { ReviewState } from "./service";
import {
  addComment,
  deleteComment,
  listComments,
  listCommentsForReview,
  restoreComment,
  setCommentResolved,
  updateCommentAnchor,
  updateCommentBody,
} from "./service";

// Comments never change the document or the page around it: no refresh;
// the editor's panel reloads its comments itself.
const quiet = { refresh: false } as const;

export async function listCommentsAction(nodeId: string) {
  return runAction(async () => listComments(await requireAuthorContext(), nodeId), quiet);
}

export async function addCommentAction(nodeId: string, input: NewCommentInput) {
  return runAction(async () => addComment(await requireAuthorContext(), nodeId, input), quiet);
}

export async function updateCommentBodyAction(id: string, body: string, expectedBody: string) {
  return runAction(
    async () => updateCommentBody(await requireAuthorContext(), id, body, { expectedBody }),
    quiet,
  );
}

export async function setCommentResolvedAction(id: string, resolved: boolean) {
  return runAction(async () => setCommentResolved(await requireAuthorContext(), id, resolved));
}

export async function updateCommentAnchorAction(id: string, input: AnchorInput) {
  return runAction(async () => updateCommentAnchor(await requireAuthorContext(), id, input));
}

export async function deleteCommentAction(id: string) {
  return runAction(async () => deleteComment(await requireAuthorContext(), id));
}

export async function restoreCommentAction(id: string, deletedAt: string) {
  return runAction(async () => restoreComment(await requireAuthorContext(), id, deletedAt));
}

/** The next page of Review (M17); reading only. */
export async function listCommentsForReviewAction(state: ReviewState, cursor: string) {
  return runAction(
    async () => listCommentsForReview(await requireAuthorContext(), { state, cursor }),
    quiet,
  );
}
