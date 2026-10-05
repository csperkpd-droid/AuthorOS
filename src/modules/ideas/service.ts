import "server-only";

import { db } from "@/lib/db";
import { assertNotStale, staleError, type EditGuard } from "@/lib/concurrency";
import { NotFoundError } from "@/lib/errors";
import { connect } from "@/modules/connections";
import { createBook } from "@/modules/library";
import { createStoryNode, liveIdea } from "@/modules/story-graph";
import type { AuthorContext } from "@/server/context";
import { recordFieldHistory } from "@/modules/history";
import { assertCan, assertCanView } from "@/server/policy";

import { ideaInput, type IdeaInput } from "./schemas";

const ideaSelect = { id: true, title: true, body: true, status: true, updatedAt: true } as const;

/** Ideas, open ones first, newest first. */
export async function listIdeas(ctx: AuthorContext) {
  assertCanView(ctx, "storyBible");
  const ideas = await db.idea.findMany({
    where: { workspaceId: ctx.workspaceId, ...liveIdea },
    orderBy: { createdAt: "desc" },
    select: ideaSelect,
  });
  const rank = { OPEN: 0, USED: 1, ARCHIVED: 2 } as const;
  return ideas.sort((a, b) => rank[a.status] - rank[b.status]);
}

export async function getIdea(ctx: AuthorContext, id: string) {
  assertCanView(ctx, "storyBible", { kind: "IDEA", id: id });
  const idea = await db.idea.findFirst({
    where: { id, workspaceId: ctx.workspaceId, ...liveIdea },
    select: ideaSelect,
  });
  if (!idea) throw new NotFoundError("Idea");
  return idea;
}

export async function createIdea(ctx: AuthorContext, input: IdeaInput) {
  assertCan(ctx, "edit", "storyBible");
  const data = ideaInput.parse(input);
  return db.$transaction(async (tx) => {
    const id = await createStoryNode(tx, ctx.workspaceId, "IDEA");
    return tx.idea.create({
      data: {
        id,
        workspaceId: ctx.workspaceId,
        title: data.title,
        body: data.body ?? null,
        status: data.status,
      },
      select: { id: true },
    });
  });
}

export async function updateIdea(
  ctx: AuthorContext,
  id: string,
  input: IdeaInput,
  guard: EditGuard = {},
) {
  assertCan(ctx, "edit", "storyBible");
  const data = ideaInput.parse(input);
  await getIdea(ctx, id);
  await db.$transaction(async (tx) => {
    const row = await tx.idea.findUniqueOrThrow({
      where: { id },
      select: { body: true, updatedAt: true },
    });
    assertNotStale(row.updatedAt, guard.expectedUpdatedAt, "idea");
    await recordFieldHistory(tx, ctx, id, row, { body: data.body ?? null });
    const { count } = await tx.idea.updateMany({
      where: { id, updatedAt: row.updatedAt },
      data: {
        title: data.title,
        body: data.body ?? null,
        ...(data.status && { status: data.status }),
      },
    });
    if (count === 0) throw staleError("idea");
  });
}

/**
 * Turns an idea into a new book (under the current identity). The book is
 * connected back to the idea ("Inspired") and the idea is marked used.
 */
export async function promoteIdeaToBook(ctx: AuthorContext, id: string) {
  assertCan(ctx, "edit", "storyBible");
  const idea = await getIdea(ctx, id);
  const book = await createBook(ctx, { title: idea.title, description: idea.body ?? "" });
  await connect(ctx, { sourceId: idea.id, targetId: book.id, kind: "inspired" });
  await db.idea.update({ where: { id }, data: { status: "USED" } });
  return book;
}

export async function trashIdea(ctx: AuthorContext, id: string) {
  assertCan(ctx, "edit", "storyBible");
  await getIdea(ctx, id);
  await db.idea.update({ where: { id }, data: { deletedAt: new Date() } });
}
