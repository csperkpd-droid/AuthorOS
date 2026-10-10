export {
  addComment,
  countCommentsToReview,
  deleteComment,
  listComments,
  reanchorComments,
  restoreComment,
  setCommentResolved,
  updateCommentAnchor,
  updateCommentBody,
} from "./service";
export type { CommentView } from "./service";
export { anchorInput, commentBody, newCommentInput } from "./schemas";
export type { AnchorInput, NewCommentInput } from "./schemas";
