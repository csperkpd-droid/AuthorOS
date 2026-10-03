import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { ConflictError, NotFoundError, RuleError } from "@/lib/errors";
import { createBook, getBook } from "@/modules/library";
import {
  createChapter,
  createPart,
  createScene,
  dissolvePart,
  getBookTree,
  getRevision,
  getSceneForEditor,
  listRevisions,
  moveChapter,
  movePart,
  moveScene,
  restoreRevision,
  saveSceneContent,
  saveVersion,
  trashChapter,
  trashPart,
  updateSceneDetails,
  type BookTree,
} from "@/modules/manuscript";
import type { AuthorContext } from "@/server/context";

import { createAuthor, resetDatabase } from "../support/db";

let ctx: AuthorContext;
let bookId: string;

beforeEach(async () => {
  await resetDatabase();
  ctx = await createAuthor();
  bookId = (await createBook(ctx, { title: "The Long Night" })).id;
});

/** A compact picture of the tree: titles nested by level. */
function outline(tree: BookTree) {
  return tree.items.map((i) =>
    i.kind === "part"
      ? { [i.title]: i.chapters.map((c) => ({ [c.title]: c.scenes.map((s) => s.title) })) }
      : { [i.title]: i.scenes.map((s) => s.title) },
  );
}

function doc(text: string) {
  return { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] };
}

describe("structure", () => {
  it("works without parts: Book → Chapter → Scene", async () => {
    const ch1 = await createChapter(ctx, bookId, { title: "Chapter 1" });
    await createScene(ctx, ch1.id, "Arrival");
    await createScene(ctx, ch1.id, "Dinner");
    await createChapter(ctx, bookId, { title: "Chapter 2" });

    expect(outline(await getBookTree(ctx, bookId))).toEqual([
      { "Chapter 1": ["Arrival", "Dinner"] },
      { "Chapter 2": [] },
    ]);
  });

  it("mixes optional parts with part-less chapters at the top level", async () => {
    await createChapter(ctx, bookId, { title: "Prologue" });
    const one = await createPart(ctx, bookId, "Part One");
    const two = await createPart(ctx, bookId, "Part Two");
    await createChapter(ctx, bookId, { title: "Epilogue" });
    await createChapter(ctx, bookId, { title: "Chapter 1", partId: one.id });
    await createChapter(ctx, bookId, { title: "Chapter 2", partId: two.id });

    expect(outline(await getBookTree(ctx, bookId))).toEqual([
      { Prologue: [] },
      { "Part One": [{ "Chapter 1": [] }] },
      { "Part Two": [{ "Chapter 2": [] }] },
      { Epilogue: [] },
    ]);
  });

  it("moves parts, chapters (between levels) and scenes (between chapters)", async () => {
    const pro = await createChapter(ctx, bookId, { title: "Prologue" });
    const part = await createPart(ctx, bookId, "Act I");
    const ch1 = await createChapter(ctx, bookId, { title: "Ch 1" });
    const ch2 = await createChapter(ctx, bookId, { title: "Ch 2" });
    const a = await createScene(ctx, ch1.id, "A");
    const b = await createScene(ctx, ch1.id, "B");

    await moveChapter(ctx, ch1.id, { partId: part.id, afterId: null });
    await moveChapter(ctx, ch2.id, { partId: part.id, afterId: ch1.id });
    await movePart(ctx, part.id, null);
    await moveScene(ctx, a.id, { chapterId: ch2.id, afterId: null });
    await moveScene(ctx, b.id, { chapterId: pro.id, afterId: null });

    expect(outline(await getBookTree(ctx, bookId))).toEqual([
      { "Act I": [{ "Ch 1": [] }, { "Ch 2": ["A"] }] },
      { Prologue: ["B"] },
    ]);

    // Back out to the top level, after the prologue.
    await moveChapter(ctx, ch2.id, { partId: null, afterId: pro.id });
    expect(outline(await getBookTree(ctx, bookId))).toEqual([
      { "Act I": [{ "Ch 1": [] }] },
      { Prologue: ["B"] },
      { "Ch 2": ["A"] },
    ]);
  });

  it("numbers default titles and serializes concurrent adds", async () => {
    const part = await createPart(ctx, bookId);
    const [c1, c2] = [
      await createChapter(ctx, bookId),
      await createChapter(ctx, bookId, { partId: part.id }),
    ];
    expect(outline(await getBookTree(ctx, bookId))).toEqual([
      { "Part 1": [{ "Chapter 2": [] }] },
      { "Chapter 1": [] },
    ]);

    // A double click (or two tabs) must not produce duplicate names or positions.
    await Promise.all(Array.from({ length: 5 }, () => createScene(ctx, c1.id)));
    const scenes = await db.scene.findMany({
      where: { chapterId: c1.id },
      select: { title: true, position: true },
    });
    expect(new Set(scenes.map((s) => s.title))).toEqual(
      new Set(["Scene 1", "Scene 2", "Scene 3", "Scene 4", "Scene 5"]),
    );
    expect(new Set(scenes.map((s) => s.position)).size).toBe(5);
    expect(c2.id).toBeTruthy();
  });

  it("keeps structure within one book", async () => {
    const other = (await createBook(ctx, { title: "Other" })).id;
    const mine = await createChapter(ctx, bookId, { title: "Mine" });
    const theirs = await createChapter(ctx, other, { title: "Theirs" });
    const theirPart = await createPart(ctx, other, "Their part");
    const scene = await createScene(ctx, mine.id, "S");

    await expect(
      moveScene(ctx, scene.id, { chapterId: theirs.id, afterId: null }),
    ).rejects.toBeInstanceOf(RuleError);
    await expect(
      moveChapter(ctx, mine.id, { partId: theirPart.id, afterId: null }),
    ).rejects.toBeInstanceOf(RuleError);
    await expect(
      createChapter(ctx, bookId, { title: "X", partId: theirPart.id }),
    ).rejects.toBeInstanceOf(RuleError);
  });

  it("dissolves a part, keeping its chapters in place and in order", async () => {
    await createChapter(ctx, bookId, { title: "Prologue" });
    const part = await createPart(ctx, bookId, "Part One");
    await createChapter(ctx, bookId, { title: "Epilogue" });
    await createChapter(ctx, bookId, { title: "Ch 1", partId: part.id });
    await createChapter(ctx, bookId, { title: "Ch 2", partId: part.id });

    await dissolvePart(ctx, part.id);
    expect(outline(await getBookTree(ctx, bookId))).toEqual([
      { Prologue: [] },
      { "Ch 1": [] },
      { "Ch 2": [] },
      { Epilogue: [] },
    ]);
    expect(await db.storyNode.count({ where: { id: part.id } })).toBe(0);
  });

  it("hides trashed parts and chapters with everything inside them", async () => {
    const part = await createPart(ctx, bookId, "Part");
    const inPart = await createChapter(ctx, bookId, { title: "In part", partId: part.id });
    const loose = await createChapter(ctx, bookId, { title: "Loose" });
    const s1 = await createScene(ctx, inPart.id, "S1");
    await createScene(ctx, loose.id, "S2");
    await saveSceneContent(ctx, { sceneId: s1.id, content: doc("one two three"), baseVersion: 0 });

    expect((await getBookTree(ctx, bookId)).wordCount).toBe(3);
    await trashPart(ctx, part.id);
    await trashChapter(ctx, loose.id);

    const tree = await getBookTree(ctx, bookId);
    expect(tree.items).toEqual([]);
    expect(tree.wordCount).toBe(0);
    await expect(getSceneForEditor(ctx, s1.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("totals words per chapter, part and book", async () => {
    const part = await createPart(ctx, bookId, "Part");
    const ch = await createChapter(ctx, bookId, { title: "Ch", partId: part.id });
    const s1 = await createScene(ctx, ch.id, "S1");
    const s2 = await createScene(ctx, ch.id, "S2");
    await saveSceneContent(ctx, { sceneId: s1.id, content: doc("one two"), baseVersion: 0 });
    await saveSceneContent(ctx, {
      sceneId: s2.id,
      content: doc("three four five"),
      baseVersion: 0,
    });

    const tree = await getBookTree(ctx, bookId);
    expect(tree.wordCount).toBe(5);
    expect(tree.items[0].wordCount).toBe(5);
    expect(tree.sceneOrder.map((s) => s.title)).toEqual(["S1", "S2"]);
  });
});

describe("scene content", () => {
  let sceneId: string;
  beforeEach(async () => {
    const ch = await createChapter(ctx, bookId, { title: "Ch" });
    sceneId = (await createScene(ctx, ch.id, "Opening")).id;
  });

  it("saves content, derives text and word count, and bumps the version", async () => {
    const result = await saveSceneContent(ctx, {
      sceneId,
      content: doc("It was a dark night."),
      baseVersion: 0,
    });
    expect(result).toMatchObject({ version: 1, wordCount: 5 });

    const { scene } = await getSceneForEditor(ctx, sceneId);
    expect(scene.content).toEqual(doc("It was a dark night."));
    expect(scene.version).toBe(1);
  });

  it("refuses to overwrite edits made elsewhere", async () => {
    await saveSceneContent(ctx, { sceneId, content: doc("tab one"), baseVersion: 0 });
    await expect(
      saveSceneContent(ctx, { sceneId, content: doc("tab two"), baseVersion: 0 }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect((await getSceneForEditor(ctx, sceneId)).scene.content).toEqual(doc("tab one"));
  });

  it("serializes concurrent saves from the same version", async () => {
    const results = await Promise.allSettled([
      saveSceneContent(ctx, { sceneId, content: doc("a"), baseVersion: 0 }),
      saveSceneContent(ctx, { sceneId, content: doc("b"), baseVersion: 0 }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
  });

  it("rejects malformed documents", async () => {
    await expect(
      saveSceneContent(ctx, { sceneId, content: { type: "nope" }, baseVersion: 0 }),
    ).rejects.toThrow();
  });

  it("checkpoints previous content at most once per interval", async () => {
    await saveSceneContent(ctx, { sceneId, content: doc("first draft"), baseVersion: 0 });
    expect(await listRevisions(ctx, sceneId)).toHaveLength(0); // previous content was empty

    await saveSceneContent(ctx, { sceneId, content: doc("second draft"), baseVersion: 1 });
    await saveSceneContent(ctx, { sceneId, content: doc("third draft"), baseVersion: 2 });
    const revisions = await listRevisions(ctx, sceneId);
    expect(revisions).toHaveLength(1);
    expect(revisions[0]).toMatchObject({ source: "AUTOSAVE", excerpt: "first draft" });

    // Once the window has passed, the next save checkpoints again.
    await db.sceneRevision.updateMany({
      data: { createdAt: new Date(Date.now() - 11 * 60 * 1000) },
    });
    await saveSceneContent(ctx, { sceneId, content: doc("fourth draft"), baseVersion: 3 });
    expect((await listRevisions(ctx, sceneId)).map((r) => r.excerpt)).toEqual([
      "third draft",
      "first draft",
    ]);
  });

  it("saves named versions and restores them, keeping a copy of what was replaced", async () => {
    await saveSceneContent(ctx, { sceneId, content: doc("the good version"), baseVersion: 0 });
    const kept = await saveVersion(ctx, sceneId, "Before the rewrite");
    await saveSceneContent(ctx, { sceneId, content: doc("a worse rewrite"), baseVersion: 1 });

    const restored = await restoreRevision(ctx, kept!.id);
    expect(restored.version).toBe(3);
    const { scene } = await getSceneForEditor(ctx, sceneId);
    expect(scene.content).toEqual(doc("the good version"));
    expect(scene.wordCount).toBe(3);

    const revisions = await listRevisions(ctx, sceneId);
    expect(revisions[0]).toMatchObject({ source: "BEFORE_RESTORE", excerpt: "a worse rewrite" });
    expect(revisions.find((r) => r.id === kept!.id)?.label).toBe("Before the rewrite");
  });

  it("restoring an empty version clears the scene", async () => {
    const empty = await saveVersion(ctx, sceneId);
    await saveSceneContent(ctx, { sceneId, content: doc("words"), baseVersion: 0 });
    await restoreRevision(ctx, empty!.id);
    const { scene } = await getSceneForEditor(ctx, sceneId);
    expect(scene.content).toBeNull();
    expect(scene.wordCount).toBe(0);
  });

  it("updates scene details", async () => {
    await updateSceneDetails(ctx, sceneId, { title: "Cold Open", status: "REVISED", synopsis: "" });
    const { scene } = await getSceneForEditor(ctx, sceneId);
    expect(scene).toMatchObject({ title: "Cold Open", status: "REVISED", synopsis: null });
  });

  it("gives previous and next scenes in reading order", async () => {
    const ch2 = await createChapter(ctx, bookId, { title: "Ch 2" });
    const next = await createScene(ctx, ch2.id, "Next");
    const editor = await getSceneForEditor(ctx, sceneId);
    expect(editor.previous).toBeNull();
    expect(editor.next?.id).toBe(next.id);
  });

  it("isolates workspaces", async () => {
    const stranger = await createAuthor("Stranger");
    await expect(getSceneForEditor(stranger, sceneId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      saveSceneContent(stranger, { sceneId, content: doc("x"), baseVersion: 0 }),
    ).rejects.toBeInstanceOf(NotFoundError);
    const revision = await saveVersion(ctx, sceneId);
    await expect(getRevision(stranger, revision!.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(restoreRevision(stranger, revision!.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(getBook(stranger, bookId)).rejects.toBeInstanceOf(NotFoundError);
  });
});
