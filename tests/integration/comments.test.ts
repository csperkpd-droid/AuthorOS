import JSZip from "jszip";
import { beforeEach, describe, expect, it } from "vitest";

import { anchorText, makeAnchor } from "@/lib/anchors";
import { CURRENT_DOC_FORMAT, upgradeDoc } from "@/lib/doc-format";
import { db } from "@/lib/db";
import { ConflictError, NotFoundError } from "@/lib/errors";
import {
  addComment,
  countCommentsToReview,
  deleteComment,
  listComments,
  restoreComment,
  setCommentResolved,
  updateCommentAnchor,
  updateCommentBody,
} from "@/modules/comments";
import { exportDocx, exportMarkdown, exportWorkspaceJson } from "@/modules/exports";
import { listRevisions, restoreRevision, saveVersion } from "@/modules/history";
import { reviewImport, runImport } from "@/modules/imports";
import { createBook } from "@/modules/library";
import {
  createChapter,
  createScene,
  getSceneForEditor,
  saveSceneContent,
  trashScene,
} from "@/modules/manuscript";
import { createNote, getNote, saveNoteBody, trashNote } from "@/modules/notes";
import { deleteForever, previewDeleteForever, restoreFromTrash } from "@/modules/trash";
import type { AuthorContext } from "@/server/context";

import { createAuthor, resetDatabase } from "../support/db";

/**
 * M16 Comments with external anchors (decisions 87 and 114): comments sit
 * beside the text, are re-found strictly on every save, restore and import,
 * and never change the document.
 */

let ctx: AuthorContext;
let bookId: string;
let sceneId: string;

const doc = (...paragraphs: string[]) => ({
  type: "doc",
  content: paragraphs.map((text) => ({
    type: "paragraph",
    ...(text ? { content: [{ type: "text", text }] } : {}),
  })),
});

const STORY = doc(
  "The storm came in at dusk.",
  "Mara ran to the quay. The lamps went out.",
  "Nobody saw her again.",
);

async function scene() {
  return (await getSceneForEditor(ctx, sceneId)).scene;
}

/** Saves new text for the scene from the version it has now. */
async function write(content: object) {
  const current = await scene();
  return saveSceneContent(ctx, { sceneId, content, baseVersion: current.version });
}

/** The saved text and version of a scene or note. */
async function saved(nodeId: string) {
  if (nodeId === sceneId) {
    const s = await scene();
    return { content: s.content, version: s.version };
  }
  const n = await getNote(ctx, nodeId);
  return { content: n.body, version: n.version };
}

/** Comments on the first occurrence of `quote` in the saved text. */
async function commentOn(quote: string, body = "Check this.", nodeId = sceneId) {
  const { content, version } = await saved(nodeId);
  const text = anchorText(content);
  const start = text.indexOf(quote);
  expect(start, `“${quote}” is in the text`).toBeGreaterThanOrEqual(0);
  return addComment(ctx, nodeId, {
    version,
    ...makeAnchor(text, start, start + quote.length),
    body,
  });
}

const only = async (nodeId = sceneId) => (await listComments(ctx, nodeId))[0];

beforeEach(async () => {
  await resetDatabase();
  ctx = await createAuthor("Jane");
  bookId = (await createBook(ctx, { title: "Harbour Lights" })).id;
  const chapter = await createChapter(ctx, bookId, { title: "Arrival" });
  sceneId = (await createScene(ctx, chapter.id, "The storm")).id;
  await write(STORY);
});

describe("anchoring through edits", () => {
  it("follows the passage when paragraphs are typed above it", async () => {
    await commentOn("Mara ran to the quay.");
    await write(
      doc("A new opening.", "And another.", ...STORY.content.map((p) => p.content![0].text)),
    );
    const c = await only();
    expect(c.state).toBe("OPEN");
    const text = anchorText((await scene()).content);
    expect(text.slice(c.start, c.end)).toBe("Mara ran to the quay.");
    expect(c.docVersion).toBe((await scene()).version);
  });

  it("follows the passage when unrelated text is deleted", async () => {
    await commentOn("The lamps went out.");
    await write(doc("Mara ran to the quay. The lamps went out.", "Nobody saw her again."));
    const c = await only();
    expect(c.state).toBe("OPEN");
    expect(anchorText((await scene()).content).slice(c.start, c.end)).toBe("The lamps went out.");
  });

  it("needs review when the passage is rewritten, and keeps its original quote", async () => {
    await commentOn("Mara ran to the quay.");
    await write(doc("The storm came in at dusk.", "Mara walked slowly. The lamps went out."));
    const c = await only();
    expect(c.state).toBe("NEEDS_REVIEW");
    expect(c.anchorLost).toBe(true);
    expect(c.quote).toBe("Mara ran to the quay.");
    expect(await countCommentsToReview(ctx, bookId)).toEqual({ [sceneId]: 1 });
  });

  it("needs review when the passage is removed, and never attaches to other text", async () => {
    await commentOn("Nobody saw her again.");
    await write(doc("The storm came in at dusk.", "Nobody saw the lamps."));
    const c = await only();
    expect(c.state).toBe("NEEDS_REVIEW");
    // Bringing similar text back doesn't re-attach it: only the author does.
    await write(STORY);
    expect((await only()).state).toBe("NEEDS_REVIEW");
  });

  it("tells repeated passages apart by their context, or asks for review", async () => {
    const twice = doc("He said yes. She laughed.", "Later, he said yes. Nobody laughed.");
    await write(twice);
    const text = anchorText(twice);
    const second = text.lastIndexOf("he said yes.");
    const v = (await scene()).version;
    await addComment(ctx, sceneId, {
      version: v,
      ...makeAnchor(text, second, second + "he said yes.".length),
      body: "Echo.",
    });
    await write(
      doc("Prologue.", "He said yes. She laughed.", "Later, he said yes. Nobody laughed."),
    );
    const c = await only();
    expect(c.state).toBe("OPEN");
    const now = anchorText((await scene()).content);
    expect(c.start).toBe(now.lastIndexOf("he said yes."));

    // Both sides of every occurrence changed: not certain, so review.
    await write(doc("And he said yes.", "Then he said yes!"));
    expect((await only()).state).toBe("NEEDS_REVIEW");
  });

  it("only the author attaches a flagged comment to new text", async () => {
    const { id } = await commentOn("Mara ran to the quay.");
    await write(doc("The storm came in at dusk.", "Mara sprinted to the harbour."));
    expect((await only()).state).toBe("NEEDS_REVIEW");
    const current = await scene();
    const text = anchorText(current.content);
    const start = text.indexOf("Mara sprinted to the harbour.");
    // A stale selection (an older version) is refused.
    await expect(
      updateCommentAnchor(ctx, id, {
        version: current.version - 1,
        ...makeAnchor(text, start, start + 29),
      }),
    ).rejects.toBeInstanceOf(ConflictError);
    await updateCommentAnchor(ctx, id, {
      version: current.version,
      ...makeAnchor(text, start, start + 29),
    });
    const c = await only();
    expect(c.state).toBe("OPEN");
    expect(c.quote).toBe("Mara sprinted to the harbour.");
    expect(await countCommentsToReview(ctx, bookId)).toEqual({});
  });

  it("is re-found when an earlier version is restored", async () => {
    await saveVersion(ctx, sceneId, "Before the rewrite");
    await commentOn("Mara ran to the quay.");
    await write(doc("Everything changed."));
    expect((await only()).state).toBe("NEEDS_REVIEW");

    const { id: other } = await commentOn("Everything changed.");
    const named = (await listRevisions(ctx, sceneId)).find(
      (r) => r.label === "Before the rewrite",
    )!;
    await restoreRevision(ctx, named.id);
    const comments = await listComments(ctx, sceneId);
    // The flagged one stays flagged (the author decides); the other lost its passage.
    expect(comments.map((c) => [c.quote, c.state]).sort()).toEqual([
      ["Everything changed.", "NEEDS_REVIEW"],
      ["Mara ran to the quay.", "NEEDS_REVIEW"],
    ]);
    expect(comments.find((c) => c.id === other)!.anchorLost).toBe(true);
  });
});

describe("two devices", () => {
  it("a comment on a passage of an older version is placed only where it is certain", async () => {
    const before = await scene();
    const text = anchorText(before.content);
    const start = text.indexOf("Mara ran to the quay.");
    const selection = makeAnchor(text, start, start + 21);
    // Another device saves in between.
    await write(doc("New line.", ...STORY.content.map((p) => p.content![0].text)));
    await addComment(ctx, sceneId, { version: before.version, ...selection, body: "Still here." });
    const c = await only();
    expect(anchorText((await scene()).content).slice(c.start, c.end)).toBe("Mara ran to the quay.");
    // And a passage that no longer exists is refused, not guessed.
    await write(doc("Gone."));
    await expect(
      addComment(ctx, sceneId, { version: before.version, ...selection, body: "Lost." }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("saves and comments at the same moment never leave an anchor on the wrong text", async () => {
    await commentOn("The lamps went out.");
    const current = await scene();
    const text = anchorText(current.content);
    const start = text.indexOf("The storm");
    const results = await Promise.allSettled([
      saveSceneContent(ctx, {
        sceneId,
        content: doc("Prologue.", ...STORY.content.map((p) => p.content![0].text)),
        baseVersion: current.version,
      }),
      addComment(ctx, sceneId, {
        version: current.version,
        ...makeAnchor(text, start, start + 9),
        body: "Opening.",
      }),
      // The other device, from the same version: only one of the two saves wins.
      saveSceneContent(ctx, { sceneId, content: doc("Other"), baseVersion: current.version }),
    ]);
    const saves = [results[0], results[2]];
    expect(saves.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(
      saves.filter((r) => r.status === "rejected").map((r) => (r as PromiseRejectedResult).reason),
    ).toEqual([expect.any(ConflictError)]);
    // Whatever the order, every comment is on its exact passage or flagged.
    const now = anchorText((await scene()).content);
    for (const c of await listComments(ctx, sceneId)) {
      if (c.state === "OPEN") expect(now.slice(c.start, c.end)).toBe(c.quote);
      else expect(c.anchorLost).toBe(true);
    }
  });

  it("an edit of a comment changed elsewhere is refused", async () => {
    const { id } = await commentOn("Mara ran to the quay.", "First.");
    await updateCommentBody(ctx, id, "Second.", { expectedBody: "First." });
    await expect(
      updateCommentBody(ctx, id, "Third.", { expectedBody: "First." }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect((await only()).body).toBe("Second.");
  });
});

describe("comments never change the document", () => {
  it("leaves text, versions, word counts and manuscript exports untouched", async () => {
    const before = await scene();
    const revisions = await listRevisions(ctx, sceneId);
    const markdown = (await exportMarkdown(ctx, { scope: { kind: "all" } })).content;

    const { id } = await commentOn("Mara ran to the quay.", "A comment-only remark.");
    await updateCommentBody(ctx, id, "Edited remark.");
    await setCommentResolved(ctx, id, true);
    await setCommentResolved(ctx, id, false);
    const { deletedAt } = await deleteComment(ctx, id);
    await restoreComment(ctx, id, deletedAt);

    const after = await scene();
    expect(after.content).toEqual(before.content);
    expect(after.version).toBe(before.version);
    expect(after.wordCount).toBe(before.wordCount);
    expect(await listRevisions(ctx, sceneId)).toEqual(revisions);
    expect((await exportMarkdown(ctx, { scope: { kind: "all" } })).content).toBe(markdown);
    const { buffer } = await exportDocx(ctx, { scope: { kind: "all" } });
    const xml = await (await JSZip.loadAsync(buffer)).file("word/document.xml")!.async("string");
    expect(xml).not.toContain("Edited remark");
    expect(xml).not.toContain("comment");
    expect(xml).toContain("Mara ran to the quay.");
  });
});

describe("lifecycle", () => {
  it("resolves (kept, still stored), reopens, deletes softly and undoes", async () => {
    const { id } = await commentOn("Mara ran to the quay.");
    await setCommentResolved(ctx, id, true);
    expect((await only()).state).toBe("RESOLVED");
    expect(await db.comment.count({ where: { id, deletedAt: null } })).toBe(1);
    await setCommentResolved(ctx, id, false);
    expect((await only()).state).toBe("OPEN");

    const { deletedAt } = await deleteComment(ctx, id);
    expect(await listComments(ctx, sceneId)).toEqual([]);
    expect(await db.comment.count({ where: { id } })).toBe(1);
    await restoreComment(ctx, id, deletedAt);
    await restoreComment(ctx, id, deletedAt); // repeated: harmless
    expect((await only()).id).toBe(id);

    // An Undo for an earlier deletion is refused once the comment was deleted again.
    const second = await deleteComment(ctx, id);
    await expect(restoreComment(ctx, id, deletedAt)).rejects.toBeInstanceOf(ConflictError);
    await restoreComment(ctx, id, second.deletedAt);
  });

  it("a resolved comment whose passage changed reopens as needing review", async () => {
    const { id } = await commentOn("Mara ran to the quay.");
    await setCommentResolved(ctx, id, true);
    await write(doc("Rewritten entirely."));
    expect((await only()).state).toBe("RESOLVED");
    await setCommentResolved(ctx, id, false);
    expect((await only()).state).toBe("NEEDS_REVIEW");
  });

  it("an undone comment is checked against the text as it is now", async () => {
    const { id } = await commentOn("Mara ran to the quay.");
    const { deletedAt } = await deleteComment(ctx, id);
    await write(doc("Rewritten entirely."));
    await restoreComment(ctx, id, deletedAt);
    expect((await only()).state).toBe("NEEDS_REVIEW");
  });

  it("follows the Trash: hidden with its scene or note, back when restored", async () => {
    await commentOn("Mara ran to the quay.");
    await write(doc("Rewritten entirely."));
    await trashScene(ctx, sceneId);
    await expect(listComments(ctx, sceneId)).rejects.toBeInstanceOf(NotFoundError);
    expect(await countCommentsToReview(ctx, bookId)).toEqual({});
    await restoreFromTrash(ctx, "SCENE", sceneId);
    expect(await listComments(ctx, sceneId)).toHaveLength(1);
    expect(await countCommentsToReview(ctx, bookId)).toEqual({ [sceneId]: 1 });

    const note = await createNote(ctx, { title: "Research" });
    await saveNoteBody(ctx, { noteId: note.id, content: doc("Lamps were oil."), baseVersion: 0 });
    await commentOn("Lamps were oil.", "Verify.", note.id);
    await trashNote(ctx, note.id);
    await expect(listComments(ctx, note.id)).rejects.toBeInstanceOf(NotFoundError);
    await restoreFromTrash(ctx, "NOTE", note.id);
    expect((await listComments(ctx, note.id)).map((c) => c.body)).toEqual(["Verify."]);
  });

  it("deleting forever lists the comments that go with the scene", async () => {
    await commentOn("Mara ran to the quay.");
    await commentOn("Nobody saw her again.");
    await trashScene(ctx, sceneId);
    const report = await previewDeleteForever(ctx, "SCENE", sceneId);
    expect(report.groups.find((g) => g.key === "COMMENTS")?.count).toBe(2);
    await deleteForever(ctx, "SCENE", sceneId, report.token);
    expect(await db.comment.count()).toBe(0);
  });

  it("works on notes like on scenes", async () => {
    const note = await createNote(ctx, { title: "Research" });
    await saveNoteBody(ctx, {
      noteId: note.id,
      content: doc("Lamps were oil.", "Quays were stone."),
      baseVersion: 0,
    });
    await commentOn("Quays were stone.", "Source?", note.id);
    const v = (await getNote(ctx, note.id)).version;
    await saveNoteBody(ctx, {
      noteId: note.id,
      content: doc("Intro.", "Lamps were oil.", "Quays were stone."),
      baseVersion: v,
    });
    const c = (await listComments(ctx, note.id))[0];
    expect(c.state).toBe("OPEN");
    expect(anchorText((await getNote(ctx, note.id)).body).slice(c.start, c.end)).toBe(
      "Quays were stone.",
    );
  });

  it("refuses passages that aren't in the text, and other kinds of objects", async () => {
    const current = await scene();
    await expect(
      addComment(ctx, sceneId, {
        version: current.version,
        start: 0,
        end: 5,
        quote: "Zebra",
        body: "No.",
      }),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      addComment(ctx, bookId, { version: 0, start: 0, end: 1, quote: "x", body: "No." }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("never crosses workspaces", async () => {
    const { id } = await commentOn("Mara ran to the quay.");
    const other = await createAuthor("Sam");
    await expect(listComments(other, sceneId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(deleteComment(other, id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(setCommentResolved(other, id, true)).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      addComment(other, sceneId, { version: 1, start: 0, end: 1, quote: "T", body: "x" }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("backups (format 9)", () => {
  const file = (data: unknown) => ({
    sourceId: "authoros-json",
    filename: "b.json",
    bytes: new TextEncoder().encode(JSON.stringify(data)),
  });

  it("round-trips comments with their anchors; reimporting adds nothing", async () => {
    const { id } = await commentOn("Mara ran to the quay.", "Keep.");
    const { id: resolved } = await commentOn("Nobody saw her again.", "Done.");
    await setCommentResolved(ctx, resolved, true);
    const { id: gone } = await commentOn("The storm came in at dusk.", "Deleted.");
    await deleteComment(ctx, gone);
    const { data } = await exportWorkspaceJson(ctx, { scope: { kind: "all" } });
    expect(data.version).toBe(9);
    expect(data.comments.map((c) => c.body).sort()).toEqual(["Done.", "Keep."]);

    await resetDatabase();
    const other = await createAuthor("Jane");
    const review = await reviewImport(other, file(data));
    expect(review.errors).toEqual([]);
    expect(review.conflicts).toEqual([]);
    await runImport(other, file(data), { token: review.token! });
    const restored = await listComments(other, sceneId);
    expect(restored.map((c) => [c.id, c.body, c.state, c.quote])).toEqual([
      [id, "Keep.", "OPEN", "Mara ran to the quay."],
      [resolved, "Done.", "RESOLVED", "Nobody saw her again."],
    ]);
    const again = await reviewImport(other, file(data));
    expect(again.canImport).toBe(false);
    expect(await db.comment.count()).toBe(2);
  });

  it("re-anchors imported comments against the text they land on, flagging what isn't certain", async () => {
    await commentOn("Mara ran to the quay.", "Kept.");
    await commentOn("The lamps went out.", "Lost.");
    const { data } = await exportWorkspaceJson(ctx, { scope: { kind: "all" } });
    // The file's scene text was changed before importing.
    const changed = {
      ...data,
      scenes: data.scenes.map((s) => ({
        ...s,
        content: doc(
          "The storm came in at dusk.",
          "Mara ran to the quay. The lamps were dark.",
          "Nobody saw her again.",
        ),
      })),
    };
    await resetDatabase();
    const other = await createAuthor("Jane");
    const review = await reviewImport(other, file(changed));
    expect(review.errors).toEqual([]);
    await runImport(other, file(changed), { token: review.token! });
    const comments = await listComments(other, sceneId);
    expect(comments.map((c) => [c.body, c.state])).toEqual([
      ["Kept.", "OPEN"],
      ["Lost.", "NEEDS_REVIEW"],
    ]);
    const text = anchorText((await getSceneForEditor(other, sceneId)).scene.content);
    const kept = comments.find((c) => c.body === "Kept.")!;
    expect(text.slice(kept.start, kept.end)).toBe("Mara ran to the quay.");
  });

  it("older files (formats 1–8) still import, and inconsistent comments are refused", async () => {
    await commentOn("Mara ran to the quay.");
    const { data } = await exportWorkspaceJson(ctx, { scope: { kind: "all" } });
    const old: Record<string, unknown> = { ...data, version: 8 };
    delete old.comments;
    const bad = {
      ...data,
      comments: data.comments.map((c) => ({ ...c, nodeId: bookId })),
    };
    await resetDatabase();
    const other = await createAuthor("Jane");
    const review = await reviewImport(other, file(old));
    expect(review.errors).toEqual([]);
    await runImport(other, file(old), { token: review.token! });
    expect(await db.comment.count()).toBe(0);
    const refused = await reviewImport(other, file(bad));
    expect(refused.errors.join(" ")).toContain("not a scene or note");
  });
});

describe("document format (the upgrade check the readiness report asked for before M16)", () => {
  it("reads stored documents through the upgrade chain and refuses a newer format", async () => {
    // M16 changes no document: text is stored in the current format, unchanged.
    const stored = await db.scene.findUniqueOrThrow({
      where: { id: sceneId },
      select: { content: true, contentFormat: true },
    });
    expect(stored.contentFormat).toBe(CURRENT_DOC_FORMAT);
    expect(upgradeDoc(stored.content as never, stored.contentFormat)).toEqual(stored.content);
    expect((await scene()).content).toEqual(stored.content);
    // A document written by a newer version is refused on read, never misread.
    await db.scene.update({
      where: { id: sceneId },
      data: { contentFormat: CURRENT_DOC_FORMAT + 1 },
    });
    await expect(scene()).rejects.toThrow(/newer than this version/);
  });
});
