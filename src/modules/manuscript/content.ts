import "server-only";

import { db } from "@/lib/db";
import type { Doc } from "@/lib/text";
import { saveContent, type SaveResult } from "@/modules/history";
import { recordEditorWords, today } from "@/modules/progress";
import type { AuthorContext } from "@/server/context";

import { sceneDetailsInput, type SceneDetailsInput } from "./schemas";
import { getBookTree, requireScene } from "./structure";

export async function getSceneForEditor(ctx: AuthorContext, id: string) {
  const ref = await requireScene(ctx, id);
  const [scene, tree] = await Promise.all([
    db.scene.findUniqueOrThrow({
      where: { id },
      select: {
        id: true,
        bookId: true,
        title: true,
        status: true,
        synopsis: true,
        content: true,
        wordCount: true,
        version: true,
        updatedAt: true,
        chapter: { select: { id: true, title: true, part: { select: { id: true, title: true } } } },
      },
    }),
    getBookTree(ctx, ref.bookId),
  ]);
  const index = tree.sceneOrder.findIndex((s) => s.id === id);
  return {
    scene: { ...scene, content: (scene.content as Doc | null) ?? null },
    tree,
    previous: index > 0 ? tree.sceneOrder[index - 1] : null,
    next: index >= 0 && index + 1 < tree.sceneOrder.length ? tree.sceneOrder[index + 1] : null,
  };
}

/**
 * Saves scene content through the shared history layer: stale versions are
 * refused (never overwritten) and earlier content is checkpointed. The change
 * in words is added to today's writing for the book, in the same transaction.
 */
export async function saveSceneContent(
  ctx: AuthorContext,
  { sceneId, content, baseVersion }: { sceneId: string; content: unknown; baseVersion: number },
): Promise<SaveResult> {
  const scene = await requireScene(ctx, sceneId);
  const date = await today(ctx);
  return saveContent(
    ctx,
    { nodeId: sceneId, content, baseVersion },
    {
      afterWrite: (tx, words) =>
        recordEditorWords(tx, ctx, { bookId: scene.bookId, date, ...words }),
    },
  );
}

export async function updateSceneDetails(ctx: AuthorContext, id: string, input: SceneDetailsInput) {
  const data = sceneDetailsInput.parse(input);
  await requireScene(ctx, id);
  await db.scene.update({
    where: { id },
    data: {
      ...(data.title !== undefined && { title: data.title }),
      ...(data.status !== undefined && { status: data.status }),
      ...(data.synopsis !== undefined && { synopsis: data.synopsis }),
    },
  });
}

/** Most recently edited scenes, for "continue writing". Optionally one pen name's work only. */
export async function listRecentScenes(
  ctx: AuthorContext,
  { penNameId, limit = 5 }: { penNameId: string | null; limit?: number },
) {
  return db.scene.findMany({
    where: {
      workspaceId: ctx.workspaceId,
      deletedAt: null,
      chapter: { deletedAt: null, OR: [{ partId: null }, { part: { deletedAt: null } }] },
      book: {
        deletedAt: null,
        OR: [{ seriesId: null }, { series: { deletedAt: null } }],
        ...(penNameId ? { penNameId } : {}),
      },
    },
    orderBy: { updatedAt: "desc" },
    take: limit,
    select: {
      id: true,
      title: true,
      wordCount: true,
      updatedAt: true,
      book: { select: { id: true, title: true } },
      chapter: { select: { title: true } },
    },
  });
}
