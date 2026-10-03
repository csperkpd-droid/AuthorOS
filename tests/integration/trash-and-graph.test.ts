import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { NotFoundError } from "@/lib/errors";
import { createBook, createSeries, listLibrary, trashBook, trashSeries } from "@/modules/library";
import {
  createChapter,
  createPart,
  createScene,
  getBookTree,
  saveSceneContent,
  saveVersion,
  trashChapter,
  trashScene,
} from "@/modules/manuscript";
import { getDefaultPenName } from "@/modules/pen-names";
import { createStoryNode } from "@/modules/story-graph";
import { deleteForever, emptyTrash, listTrash, restoreFromTrash } from "@/modules/trash";
import type { AuthorContext } from "@/server/context";

import { createAuthor, resetDatabase } from "../support/db";

let ctx: AuthorContext;

beforeEach(async () => {
  await resetDatabase();
  ctx = await createAuthor();
});

async function bookWithContent() {
  const book = await createBook(ctx, { title: "Book" });
  const part = await createPart(ctx, book.id, "Part");
  const chapter = await createChapter(ctx, book.id, { title: "Chapter", partId: part.id });
  const scene = await createScene(ctx, chapter.id, "Scene");
  await saveSceneContent(ctx, {
    sceneId: scene.id,
    content: {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "words" }] }],
    },
    baseVersion: 0,
  });
  await saveVersion(ctx, scene.id, "v1");
  return { book, part, chapter, scene };
}

describe("trash", () => {
  it("lists only the topmost trashed item of each branch", async () => {
    const { book, chapter, scene } = await bookWithContent();
    await trashScene(ctx, scene.id);
    await trashChapter(ctx, chapter.id);

    let items = await listTrash(ctx);
    expect(items.map((i) => [i.kind, i.title, i.context])).toEqual([
      ["CHAPTER", "Chapter", "Book › Part"],
    ]);

    await trashBook(ctx, book.id);
    items = await listTrash(ctx);
    expect(items.map((i) => i.kind)).toEqual(["BOOK"]);
  });

  it("restores an item with its contents, but not things trashed separately", async () => {
    const { book, chapter, scene } = await bookWithContent();
    const other = await createScene(ctx, chapter.id, "Other scene");
    await trashScene(ctx, scene.id);
    await trashChapter(ctx, chapter.id);

    await restoreFromTrash(ctx, "CHAPTER", chapter.id);
    const tree = await getBookTree(ctx, book.id);
    const chapterItem = tree.items[0].kind === "part" ? tree.items[0].chapters[0] : null;
    expect(chapterItem?.scenes.map((s) => s.id)).toEqual([other.id]);
    // The separately trashed scene is now listed on its own.
    expect((await listTrash(ctx)).map((i) => i.id)).toEqual([scene.id]);
  });

  it("restores series with their books", async () => {
    const series = await createSeries(ctx, { title: "Saga" });
    await createBook(ctx, { title: "One", seriesId: series.id });
    await trashSeries(ctx, series.id);
    expect((await listLibrary(ctx, { penNameId: null })).series).toHaveLength(0);

    await restoreFromTrash(ctx, "SERIES", series.id);
    const lib = await listLibrary(ctx, { penNameId: null });
    expect(lib.series[0].books.map((b) => b.title)).toEqual(["One"]);
  });

  it("deletes forever, cascading through the structure and the story graph", async () => {
    const { book, scene } = await bookWithContent();
    const keep = await createBook(ctx, { title: "Keep" });
    await trashBook(ctx, book.id);

    await deleteForever(ctx, "BOOK", book.id);

    expect(await listTrash(ctx)).toEqual([]);
    expect(await db.book.count({ where: { id: book.id } })).toBe(0);
    expect(await db.part.count({ where: { bookId: book.id } })).toBe(0);
    expect(await db.chapter.count({ where: { bookId: book.id } })).toBe(0);
    expect(await db.scene.count({ where: { bookId: book.id } })).toBe(0);
    expect(await db.sceneRevision.count({ where: { sceneId: scene.id } })).toBe(0);
    // Only the surviving book's node remains: no orphaned graph nodes.
    const nodes = await db.storyNode.findMany({ where: { workspaceId: ctx.workspaceId } });
    expect(nodes.map((n) => n.id)).toEqual([keep.id]);
  });

  it("refuses to restore or delete items that are not in the Trash", async () => {
    const book = await createBook(ctx, { title: "Live" });
    await expect(deleteForever(ctx, "BOOK", book.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(restoreFromTrash(ctx, "BOOK", book.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("empties the trash and isolates workspaces", async () => {
    const { book } = await bookWithContent();
    await trashBook(ctx, book.id);

    const stranger = await createAuthor("Stranger");
    expect(await listTrash(stranger)).toEqual([]);
    await expect(deleteForever(stranger, "BOOK", book.id)).rejects.toBeInstanceOf(NotFoundError);
    expect(await emptyTrash(stranger)).toBe(0);

    expect(await emptyTrash(ctx)).toBe(1);
    expect(await db.storyNode.count({ where: { workspaceId: ctx.workspaceId } })).toBe(0);
  });
});

describe("story graph and tenancy guarantees in the database", () => {
  it("gives every story object a node of the matching kind", async () => {
    const { book, part, chapter, scene } = await bookWithContent();
    const nodes = await db.storyNode.findMany({ where: { workspaceId: ctx.workspaceId } });
    const kinds = Object.fromEntries(nodes.map((n) => [n.id, n.kind]));
    expect(kinds).toEqual({
      [book.id]: "BOOK",
      [part.id]: "PART",
      [chapter.id]: "CHAPTER",
      [scene.id]: "SCENE",
    });
  });

  it("rejects a typed row pointing at a node of another kind", async () => {
    const pen = await getDefaultPenName(ctx);
    const sceneNode = await db.$transaction((tx) => createStoryNode(tx, ctx.workspaceId, "SCENE"));
    await expect(
      db.book.create({
        data: { id: sceneNode, workspaceId: ctx.workspaceId, penNameId: pen.id, title: "Bad" },
      }),
    ).rejects.toThrow(/not of kind BOOK/);
  });

  it("rejects links across workspaces even if service checks were bypassed", async () => {
    const stranger = await createAuthor("Stranger");
    const theirPen = await getDefaultPenName(stranger);
    const node = await db.$transaction((tx) => createStoryNode(tx, ctx.workspaceId, "BOOK"));
    await expect(
      db.book.create({
        data: { id: node, workspaceId: ctx.workspaceId, penNameId: theirPen.id, title: "Bad" },
      }),
    ).rejects.toThrow(/foreign key/i);

    const { book } = await bookWithContent();
    const theirChapterNode = await db.$transaction((tx) =>
      createStoryNode(tx, stranger.workspaceId, "CHAPTER"),
    );
    await expect(
      db.chapter.create({
        data: {
          id: theirChapterNode,
          workspaceId: stranger.workspaceId,
          bookId: book.id,
          title: "Bad",
          position: "a0",
        },
      }),
    ).rejects.toThrow(/foreign key/i);
  });

  it("rejects a scene whose book differs from its chapter's book", async () => {
    const { chapter } = await bookWithContent();
    const other = await createBook(ctx, { title: "Other" });
    const node = await db.$transaction((tx) => createStoryNode(tx, ctx.workspaceId, "SCENE"));
    await expect(
      db.scene.create({
        data: {
          id: node,
          workspaceId: ctx.workspaceId,
          bookId: other.id,
          chapterId: chapter.id,
          title: "Bad",
          position: "a0",
        },
      }),
    ).rejects.toThrow(/foreign key/i);
  });
});
