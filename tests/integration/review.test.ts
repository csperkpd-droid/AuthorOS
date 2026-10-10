import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { WorkspaceRole } from "@/generated/prisma/client";
import { anchorText, makeAnchor } from "@/lib/anchors";
import { db } from "@/lib/db";
import { ConflictError, ForbiddenError, NotFoundError, RuleError } from "@/lib/errors";
import {
  addComment,
  countCommentsForReview,
  countCommentsToReview,
  deleteComment,
  listCommentsForReview,
  restoreComment,
  setCommentResolved,
  updateCommentAnchor,
  type ReviewState,
} from "@/modules/comments";
import { createBook, trashBook } from "@/modules/library";
import {
  createChapter,
  createScene,
  getSceneForEditor,
  saveSceneContent,
  trashScene,
} from "@/modules/manuscript";
import { createNote, getNote, saveNoteBody, trashNote } from "@/modules/notes";
import { createPenName } from "@/modules/pen-names";
import { restoreFromTrash } from "@/modules/trash";
import type { AuthorContext } from "@/server/context";
import { ROLE_GRANTS } from "@/server/policy";

import { createAuthor, resetDatabase } from "../support/db";

/**
 * M17 Review (decision 115): one page for the workspace's comments by state,
 * grouped by book and scene with notes apart. Reads go through the read
 * funnel; actions are M16's; nothing here touches text.
 */

let ctx: AuthorContext;
let rose: string;
let harbour: { bookId: string; sceneId: string };
let ember: { bookId: string; sceneId: string };
let noteId: string;

const doc = (...paragraphs: string[]) => ({
  type: "doc",
  content: paragraphs.map((text) => ({ type: "paragraph", content: [{ type: "text", text }] })),
});

async function saved(nodeId: string, as = ctx) {
  const node = await db.storyNode.findUniqueOrThrow({ where: { id: nodeId } });
  if (node.kind === "SCENE") {
    const { scene } = await getSceneForEditor(as, nodeId);
    return { content: scene.content, version: scene.version, words: scene.wordCount };
  }
  const note = await getNote(as, nodeId);
  return { content: note.body, version: note.version, words: null };
}

async function write(nodeId: string, content: object) {
  const { version } = await saved(nodeId);
  const node = await db.storyNode.findUniqueOrThrow({ where: { id: nodeId } });
  if (node.kind === "SCENE")
    return saveSceneContent(ctx, { sceneId: nodeId, content, baseVersion: version });
  return saveNoteBody(ctx, { noteId: nodeId, content, baseVersion: version });
}

async function commentOn(nodeId: string, quote: string, body = "Check this.") {
  const { content, version } = await saved(nodeId);
  const text = anchorText(content);
  const start = text.indexOf(quote);
  expect(start).toBeGreaterThanOrEqual(0);
  return addComment(ctx, nodeId, {
    version,
    ...makeAnchor(text, start, start + quote.length),
    body,
  });
}

async function sceneIn(title: string, penNameId?: string) {
  const book = await createBook(ctx, { title, ...(penNameId ? { penNameId } : {}) });
  const chapter = await createChapter(ctx, book.id, { title: "One" });
  const scene = await createScene(ctx, chapter.id, `${title} scene`);
  await write(scene.id, doc("The storm came in at dusk.", "Mara ran to the quay."));
  return { bookId: book.id, sceneId: scene.id };
}

/** Every comment of one view, through all its pages. */
async function all(as: AuthorContext, state: ReviewState, limit = 50) {
  const ids: string[] = [];
  let cursor: string | null = null;
  do {
    const page = await listCommentsForReview(as, { state, cursor, limit });
    ids.push(...page.items.map((i) => i.id));
    cursor = page.nextCursor;
  } while (cursor);
  return ids;
}

const ids = async (state: ReviewState, as = ctx) =>
  (await listCommentsForReview(as, { state })).items.map((i) => i.id);

beforeEach(async () => {
  await resetDatabase();
  ctx = await createAuthor("Jane");
  rose = (await createPenName(ctx, { name: "Rose Vale" })).id;
  harbour = await sceneIn("Harbour Lights");
  ember = await sceneIn("Ember", rose);
  noteId = (await createNote(ctx, { title: "Research" })).id;
  await write(noteId, doc("Lamps burned whale oil."));
});

afterEach(() => {
  delete (ROLE_GRANTS as Record<string, unknown>).MANUSCRIPT_READER;
});

describe("views", () => {
  it("lists each state on its own, newest first, with the document and book", async () => {
    const open = await commentOn(harbour.sceneId, "The storm came in at dusk.", "Open one");
    const lost = await commentOn(harbour.sceneId, "Mara ran to the quay.", "Lost one");
    const done = await commentOn(ember.sceneId, "Mara ran to the quay.", "Done one");
    const onNote = await commentOn(noteId, "whale oil", "On the note");
    await setCommentResolved(ctx, done.id, true);
    await write(harbour.sceneId, doc("The storm came in at dusk.", "Mara walked away."));

    // Needs review is the default view.
    const review = await listCommentsForReview(ctx);
    expect(review.items.map((i) => i.id)).toEqual([lost.id]);
    expect(review.items[0]).toMatchObject({
      state: "NEEDS_REVIEW",
      quote: "Mara ran to the quay.",
      body: "Lost one",
      document: {
        id: harbour.sceneId,
        kind: "SCENE",
        title: "Harbour Lights scene",
        href: `/books/${harbour.bookId}/scenes/${harbour.sceneId}`,
      },
      book: { id: harbour.bookId, title: "Harbour Lights" },
    });
    expect(await ids("OPEN")).toEqual([onNote.id, open.id]);
    expect(await ids("RESOLVED")).toEqual([done.id]);
    const note = (await listCommentsForReview(ctx, { state: "OPEN" })).items[0];
    expect(note).toMatchObject({ document: { id: noteId, kind: "NOTE" }, book: null });

    expect(await countCommentsForReview(ctx)).toEqual({ NEEDS_REVIEW: 1, OPEN: 2, RESOLVED: 1 });
    // Reading a view changes nothing.
    expect(await countCommentsForReview(ctx)).toEqual({ NEEDS_REVIEW: 1, OPEN: 2, RESOLVED: 1 });
  });

  it("is empty, with zero counts, when there are no comments", async () => {
    for (const state of ["NEEDS_REVIEW", "OPEN", "RESOLVED"] as const)
      expect(await listCommentsForReview(ctx, { state })).toEqual({ items: [], nextCursor: null });
    expect(await countCommentsForReview(ctx)).toEqual({ NEEDS_REVIEW: 0, OPEN: 0, RESOLVED: 0 });
  });

  it("pages without duplicates or gaps, also when comments share a timestamp", async () => {
    const made: string[] = [];
    for (let i = 0; i < 7; i++) made.push((await commentOn(noteId, "whale", `#${i}`)).id);
    // Three comments created in the same millisecond: ties are broken by id.
    await db.comment.updateMany({
      where: { id: { in: made.slice(2, 5) } },
      data: { createdAt: new Date("2026-05-01T10:00:00.000Z") },
    });
    const paged = await all(ctx, "OPEN", 2);
    expect(paged).toHaveLength(7);
    expect(new Set(paged).size).toBe(7);
    expect(paged).toEqual(await all(ctx, "OPEN", 50));

    // A comment added while paging appears on the first page, not twice.
    const first = await listCommentsForReview(ctx, { state: "OPEN", limit: 3 });
    const late = await commentOn(noteId, "Lamps", "Late");
    const rest = await all(ctx, "OPEN", 50);
    const second = await listCommentsForReview(ctx, {
      state: "OPEN",
      cursor: first.nextCursor,
      limit: 50,
    });
    expect(second.items.map((i) => i.id)).not.toContain(late.id);
    expect([...first.items, ...second.items].map((i) => i.id).sort()).toEqual(
      rest.filter((id) => id !== late.id).sort(),
    );

    // Resolving one between pages doesn't skip another.
    const page1 = await listCommentsForReview(ctx, { state: "OPEN", limit: 3 });
    await setCommentResolved(ctx, page1.items[0].id, true);
    const after = await all(ctx, "OPEN", 50);
    const page2 = await listCommentsForReview(ctx, {
      state: "OPEN",
      cursor: page1.nextCursor,
      limit: 50,
    });
    expect(page2.items.map((i) => i.id)).toEqual(after.slice(2));
  });

  it("refuses a malformed cursor or view and caps the page size", async () => {
    for (const cursor of ["nonsense", "2026-01-01T00:00:00.000Z|not-a-uuid", "|"])
      await expect(listCommentsForReview(ctx, { cursor })).rejects.toBeInstanceOf(RuleError);
    for (const state of ["open", "DELETED", "constructor"])
      await expect(
        listCommentsForReview(ctx, { state: state as ReviewState }),
      ).rejects.toBeInstanceOf(RuleError);
    await commentOn(noteId, "whale");
    const page = await listCommentsForReview(ctx, { state: "OPEN", limit: 10_000 });
    expect(page.items).toHaveLength(1);
  });
});

describe("Writing as a pen name", () => {
  it("shows that pen name's scenes and every shared note; all identities shows all", async () => {
    const onHarbour = await commentOn(harbour.sceneId, "Mara ran to the quay.");
    const onEmber = await commentOn(ember.sceneId, "Mara ran to the quay.");
    const onNote = await commentOn(noteId, "whale oil");

    const asRose = { ...ctx, activePenNameId: rose };
    expect((await ids("OPEN", asRose)).sort()).toEqual([onEmber.id, onNote.id].sort());
    expect(await countCommentsForReview(asRose)).toMatchObject({ OPEN: 2 });

    const harbourPen = (await db.book.findUniqueOrThrow({ where: { id: harbour.bookId } }))
      .penNameId;
    const asDefault = { ...ctx, activePenNameId: harbourPen };
    expect((await ids("OPEN", asDefault)).sort()).toEqual([onHarbour.id, onNote.id].sort());

    const everything = await ids("OPEN", { ...ctx, activePenNameId: null });
    expect(everything.sort()).toEqual([onHarbour.id, onEmber.id, onNote.id].sort());
    // The note's comment once, never once per pen name.
    expect(everything.filter((id) => id === onNote.id)).toHaveLength(1);
  });
});

describe("Trash and deletion", () => {
  it("leaves out comments whose scene, book or note is in the Trash, and brings them back", async () => {
    const onScene = await commentOn(harbour.sceneId, "Mara ran to the quay.");
    const onEmber = await commentOn(ember.sceneId, "Mara ran to the quay.");
    const onNote = await commentOn(noteId, "whale oil");
    const before = await db.comment.findMany({ orderBy: { id: "asc" } });

    await trashScene(ctx, harbour.sceneId);
    await trashBook(ctx, ember.bookId);
    await trashNote(ctx, noteId);
    expect(await ids("OPEN")).toEqual([]);
    expect(await countCommentsForReview(ctx)).toEqual({ NEEDS_REVIEW: 0, OPEN: 0, RESOLVED: 0 });

    await restoreFromTrash(ctx, "SCENE", harbour.sceneId);
    await restoreFromTrash(ctx, "BOOK", ember.bookId);
    await restoreFromTrash(ctx, "NOTE", noteId);
    expect((await ids("OPEN")).sort()).toEqual([onScene.id, onEmber.id, onNote.id].sort());
    // Unchanged by the round trip.
    expect(await db.comment.findMany({ orderBy: { id: "asc" } })).toEqual(before);
  });

  it("never shows a deleted comment; Undo brings it back and is checked again", async () => {
    const c = await commentOn(harbour.sceneId, "Mara ran to the quay.");
    const { deletedAt } = await deleteComment(ctx, c.id);
    expect(await ids("OPEN")).toEqual([]);
    expect(await countCommentsForReview(ctx)).toMatchObject({ OPEN: 0 });

    await restoreComment(ctx, c.id, deletedAt);
    expect(await ids("OPEN")).toEqual([c.id]);

    // An Undo for an earlier deletion is refused.
    const second = await deleteComment(ctx, c.id);
    await expect(restoreComment(ctx, c.id, deletedAt)).rejects.toBeInstanceOf(ConflictError);

    // Undo while the scene is in the Trash: refused like a missing comment.
    await trashScene(ctx, harbour.sceneId);
    await expect(restoreComment(ctx, c.id, second.deletedAt)).rejects.toBeInstanceOf(NotFoundError);
    await restoreFromTrash(ctx, "SCENE", harbour.sceneId);
    expect(await ids("OPEN")).toEqual([]);

    // A viewer can't undo.
    const viewer = { ...ctx, role: "VIEWER" as WorkspaceRole };
    await expect(restoreComment(viewer, c.id, second.deletedAt)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });
});

describe("actions from Review", () => {
  it("resolve, reopen and re-attach move a comment between views without touching the text", async () => {
    const c = await commentOn(harbour.sceneId, "Mara ran to the quay.");
    await write(harbour.sceneId, doc("The storm came in at dusk.", "Mara walked away."));
    const text = await saved(harbour.sceneId);
    const binder = await countCommentsToReview(ctx, harbour.bookId);
    expect(binder).toEqual({ [harbour.sceneId]: 1 });

    await setCommentResolved(ctx, c.id, true);
    expect(await ids("RESOLVED")).toEqual([c.id]);
    // Reopened while its passage is still lost: back to Needs review.
    await setCommentResolved(ctx, c.id, false);
    expect(await ids("NEEDS_REVIEW")).toEqual([c.id]);

    // Attaching happens in the editor, to the passage the author selects.
    const plain = anchorText(text.content);
    const start = plain.indexOf("Mara walked away.");
    await updateCommentAnchor(ctx, c.id, {
      version: text.version,
      ...makeAnchor(plain, start, start + "Mara walked away.".length),
    });
    expect(await ids("OPEN")).toEqual([c.id]);
    expect(await countCommentsToReview(ctx, harbour.bookId)).toEqual({});

    const { deletedAt } = await deleteComment(ctx, c.id);
    await restoreComment(ctx, c.id, deletedAt);

    // The text, its version and its word count never changed.
    expect(await saved(harbour.sceneId)).toEqual(text);
  });
});

describe("authorization", () => {
  it("never shows another workspace's comments", async () => {
    const mine = await commentOn(noteId, "whale oil");
    const other = await createAuthor("Other");
    const otherNote = await createNote(other, { title: "Theirs" });
    await saveNoteBody(other, {
      noteId: otherNote.id,
      content: doc("Secret text."),
      baseVersion: 0,
    });
    const { content, version } = await saved(otherNote.id, other);
    const text = anchorText(content);
    const theirs = await addComment(other, otherNote.id, {
      version,
      ...makeAnchor(text, 0, 6),
      body: "Hidden",
    });

    expect(await ids("OPEN")).toEqual([mine.id]);
    expect(await ids("OPEN", other)).toEqual([theirs.id]);
    expect(await countCommentsForReview(other)).toMatchObject({ OPEN: 1 });

    // Their acting on my comment fails as if it didn't exist.
    await expect(setCommentResolved(other, mine.id, true)).rejects.toBeInstanceOf(NotFoundError);
    await expect(deleteComment(other, mine.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("refuses a member who may view nothing, and leaves out what a role may not view", async () => {
    const onScene = await commentOn(harbour.sceneId, "Mara ran to the quay.");
    await commentOn(noteId, "whale oil");

    const noAccess = { ...ctx, role: "NO_ACCESS" as WorkspaceRole };
    await expect(listCommentsForReview(noAccess)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(countCommentsForReview(noAccess)).rejects.toBeInstanceOf(ForbiddenError);

    (ROLE_GRANTS as Record<string, unknown>).MANUSCRIPT_READER = {
      identity: [],
      manuscript: ["view"],
      storyBible: [],
      structure: [],
      planning: [],
      workspace: [],
    };
    const reader = { ...ctx, role: "MANUSCRIPT_READER" as WorkspaceRole };
    expect(await ids("OPEN", reader)).toEqual([onScene.id]);
    expect(await countCommentsForReview(reader)).toMatchObject({ OPEN: 1 });

    // A viewer sees everything but can't resolve or delete.
    const viewer = { ...ctx, role: "VIEWER" as WorkspaceRole };
    expect(await ids("OPEN", viewer)).toHaveLength(2);
    await expect(setCommentResolved(viewer, onScene.id, true)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(deleteComment(viewer, onScene.id)).rejects.toBeInstanceOf(ForbiddenError);
  });
});
