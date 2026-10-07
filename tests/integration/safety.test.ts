import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { CURRENT_DOC_FORMAT } from "@/lib/doc-format";
import { ConflictError, RuleError } from "@/lib/errors";
import { createCharacter, updateCharacter, updateProfileField } from "@/modules/characters";
import { exportWorkspaceJson } from "@/modules/exports";
import { createFieldDefinition } from "@/modules/fields";
import { listFieldHistory, listRevisions, restoreFieldValue } from "@/modules/history";
import { reviewImport, runImport } from "@/modules/imports";
import { assertBookUnchanged, createBook, getBook, updateBook } from "@/modules/library";
import {
  createChapter,
  createScene,
  getSceneForEditor,
  saveSceneContent,
  trashScene,
  updateSceneDetails,
} from "@/modules/manuscript";
import { createNote } from "@/modules/notes";
import { connect } from "@/modules/connections";
import {
  addBeat,
  createOutline,
  deleteBeat,
  previewDeleteBeat,
  updateBeat,
} from "@/modules/structure";
import { deleteForever, previewDeleteForever } from "@/modules/trash";
import type { AuthorContext } from "@/server/context";

import { createAuthor, resetDatabase } from "../support/db";

let ctx: AuthorContext;

beforeEach(async () => {
  await resetDatabase();
  ctx = await createAuthor("Jane");
});

const words = (n: number, word = "word") =>
  Array.from({ length: n }, (_, i) => `${word}${i}`).join(" ");
const doc = (text: string) => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

async function scene() {
  const book = await createBook(ctx, { title: "Ember" });
  const chapter = await createChapter(ctx, book.id);
  return { book, scene: await createScene(ctx, chapter.id, "Opening") };
}

describe("manuscript text: large edits are always recoverable", () => {
  it("saves the previous text before a save that removes a large share, whatever the time", async () => {
    const { scene: s } = await scene();
    await saveSceneContent(ctx, { sceneId: s.id, content: doc(words(300)), baseVersion: 0 });
    // An ordinary edit right after: no extra version (the 10-minute rhythm).
    await saveSceneContent(ctx, {
      sceneId: s.id,
      content: doc(`${words(300)} more`),
      baseVersion: 1,
    });
    const before = (await listRevisions(ctx, s.id)).length;
    // An accidental select-all and replace, seconds later.
    await saveSceneContent(ctx, { sceneId: s.id, content: doc("Oops."), baseVersion: 2 });
    const revisions = await listRevisions(ctx, s.id);
    expect(revisions.length).toBe(before + 1);
    expect(revisions[0]).toMatchObject({
      source: "BEFORE_LARGE_EDIT",
      label: "Before a large edit",
    });
    expect(revisions[0].excerpt).toContain("word0 word1");
  });

  it("treats text replaced by other text as removed", async () => {
    const { scene: s } = await scene();
    await saveSceneContent(ctx, { sceneId: s.id, content: doc(words(100, "old")), baseVersion: 0 });
    await saveSceneContent(ctx, { sceneId: s.id, content: doc(words(100, "new")), baseVersion: 1 });
    expect((await listRevisions(ctx, s.id))[0].source).toBe("BEFORE_LARGE_EDIT");
  });

  it("records the document format, and reads documents through it", async () => {
    const { scene: s } = await scene();
    await saveSceneContent(ctx, { sceneId: s.id, content: doc("Ash fell."), baseVersion: 0 });
    const row = await db.scene.findUniqueOrThrow({ where: { id: s.id } });
    expect(row.contentFormat).toBe(CURRENT_DOC_FORMAT);
    expect((await getSceneForEditor(ctx, s.id)).scene.content).toEqual(doc("Ash fell."));
  });
});

describe("field history: long-form text is never lost to an edit", () => {
  it("keeps earlier summaries and profile fields, and restores them (undoably)", async () => {
    const c = await createCharacter(ctx, { name: "Elara", summary: "A smuggler." });
    await updateCharacter(ctx, c.id, { name: "Elara", summary: "A queen in hiding." });
    await updateProfileField(ctx, c.id, "goal", "Survive");
    await updateProfileField(ctx, c.id, "goal", "Reclaim the throne");
    const history = await listFieldHistory(ctx, c.id);
    expect(history.map((h) => [h.field, h.value])).toEqual(
      expect.arrayContaining([
        ["summary", "A smuggler."],
        ["profile.goal", "Survive"],
      ]),
    );
    const old = history.find((h) => h.field === "summary")!;
    await restoreFieldValue(ctx, old.id);
    expect((await db.character.findUniqueOrThrow({ where: { id: c.id } })).summary).toBe(
      "A smuggler.",
    );
    // The value replaced by the restore is kept too.
    expect((await listFieldHistory(ctx, c.id, "summary"))[0]).toMatchObject({
      value: "A queen in hiding.",
      source: "BEFORE_RESTORE",
    });
  });

  it("covers synopses, book descriptions and beat descriptions", async () => {
    const { book, scene: s } = await scene();
    await updateSceneDetails(ctx, s.id, { synopsis: "They meet." });
    await updateSceneDetails(ctx, s.id, { synopsis: "They meet again." });
    await updateBook(ctx, book.id, {
      title: "Ember",
      targetWordCount: null,
      description: "First.",
    });
    await updateBook(ctx, book.id, {
      title: "Ember",
      targetWordCount: null,
      description: "Second.",
    });
    const outline = await createOutline(ctx, { bookId: book.id, kind: "PLOT", title: "Plot" });
    const beat = await addBeat(ctx, outline.id, {
      title: "Midpoint",
      targetPercent: 50,
      description: "Everything changes.",
    });
    await updateBeat(ctx, beat.id, { title: "Midpoint", targetPercent: 50, description: "" });
    expect((await listFieldHistory(ctx, s.id)).map((h) => h.value)).toEqual(["They meet."]);
    expect((await listFieldHistory(ctx, book.id)).map((h) => h.value)).toEqual(["First."]);
    // A beat keeps its description history on itself (M14).
    expect(await listFieldHistory(ctx, beat.id)).toEqual([
      expect.objectContaining({ field: "description", value: "Everything changes." }),
    ]);
    expect(await listFieldHistory(ctx, outline.id)).toEqual([]);
  });
});

describe("conflict protection for metadata", () => {
  it("refuses an edit made from a stale form instead of overwriting", async () => {
    const book = await createBook(ctx, { title: "Ember" });
    const opened = (await getBook(ctx, book.id)).updatedAt;
    await updateBook(ctx, book.id, { title: "Ember", targetWordCount: null, description: "Tab A" });
    await expect(
      updateBook(
        ctx,
        book.id,
        { title: "Ember", targetWordCount: null, description: "Tab B" },
        { expectedUpdatedAt: opened },
      ),
    ).rejects.toBeInstanceOf(ConflictError);
    expect((await getBook(ctx, book.id)).description).toBe("Tab A");
    const fresh = (await getBook(ctx, book.id)).updatedAt;
    await updateBook(
      ctx,
      book.id,
      { title: "Ember", targetWordCount: null, description: "Tab B" },
      { expectedUpdatedAt: fresh },
    );
    // Multi-step edits (series, then details) check the form once, up front.
    await expect(
      assertBookUnchanged(ctx, book.id, { expectedUpdatedAt: opened }),
    ).rejects.toBeInstanceOf(ConflictError);
    const latest = (await getBook(ctx, book.id)).updatedAt;
    await assertBookUnchanged(ctx, book.id, { expectedUpdatedAt: latest });
  });

  it("guards single fields by the value the author started from", async () => {
    const { scene: s } = await scene();
    const c = await createCharacter(ctx, { name: "Elara" });
    await updateProfileField(ctx, c.id, "goal", "Survive", { expectedValue: "" });
    await expect(
      updateProfileField(ctx, c.id, "goal", "Flee", { expectedValue: "" }),
    ).rejects.toBeInstanceOf(ConflictError);
    await updateSceneDetails(ctx, s.id, { synopsis: "A" }, { expectedSynopsis: "" });
    await expect(
      updateSceneDetails(ctx, s.id, { synopsis: "B" }, { expectedSynopsis: "" }),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("Change Impact: Green, Yellow, Red", () => {
  it("suggests moving items only about deleted work to the Trash; nothing happens unless accepted", async () => {
    const { scene: s } = await scene();
    const only = await createNote(ctx, { title: "Only about the scene", aboutId: s.id });
    const loose = await createNote(ctx, { title: "Loose note" });
    await connect(ctx, { sourceId: loose.id, targetId: s.id, kind: "about" });
    const other = await createCharacter(ctx, { name: "Kael" });
    await connect(ctx, { sourceId: loose.id, targetId: other.id, kind: "about" });
    await trashScene(ctx, s.id);

    const report = await previewDeleteForever(ctx, "SCENE", s.id);
    expect(report.level).toBe("red");
    const suggestion = report.groups.find((g) => g.key === "ONLY_ABOUT")!;
    expect(suggestion).toMatchObject({ level: "suggested", count: 1 });
    expect(suggestion.items.map((i) => i.id)).toEqual([only.id]);
    expect(report.summary).not.toMatch(/item.*only about/);
    await expect(
      deleteForever(ctx, "SCENE", s.id, report.token, ["SOMETHING_ELSE"]),
    ).rejects.toBeInstanceOf(RuleError);

    await deleteForever(ctx, "SCENE", s.id, report.token, ["ONLY_ABOUT"]);
    expect((await db.note.findUniqueOrThrow({ where: { id: only.id } })).deletedAt).not.toBeNull();
    expect((await db.note.findUniqueOrThrow({ where: { id: loose.id } })).deletedAt).toBeNull();
  });

  it("ignoring a suggestion leaves the item alone", async () => {
    const { scene: s } = await scene();
    const only = await createNote(ctx, { title: "Only about the scene", aboutId: s.id });
    await trashScene(ctx, s.id);
    const report = await previewDeleteForever(ctx, "SCENE", s.id);
    await deleteForever(ctx, "SCENE", s.id, report.token);
    expect((await db.note.findUniqueOrThrow({ where: { id: only.id } })).deletedAt).toBeNull();
  });

  it("removing a beat suggests keeping its description as a note", async () => {
    const { book } = await scene();
    const outline = await createOutline(ctx, { bookId: book.id, kind: "PLOT", title: "Plot" });
    const beat = await addBeat(ctx, outline.id, {
      title: "Midpoint",
      targetPercent: 50,
      description: "Everything changes.",
    });
    const report = await previewDeleteBeat(ctx, beat.id);
    expect(report.level).toBe("yellow"); // nothing placed, one suggestion
    await deleteBeat(ctx, beat.id, report.token, ["KEEP_DESCRIPTION"]);
    const note = await db.note.findFirstOrThrow({ where: { title: "Midpoint" } });
    expect(note.bodyText).toBe("Everything changes.");
    expect(
      await db.connection.count({
        where: { sourceId: note.id, targetId: outline.id, kind: "about" },
      }),
    ).toBe(1);
    // A beat with nothing attached is Green: removed directly.
    const spare = await addBeat(ctx, outline.id, { title: "Spare", targetPercent: null });
    expect((await previewDeleteBeat(ctx, spare.id)).level).toBe("green");
    await deleteBeat(ctx, spare.id);
  });
});

describe("readiness", () => {
  it("keeps core character fields and custom fields from duplicating each other", async () => {
    await expect(
      createFieldDefinition(ctx, { nodeKind: "CHARACTER", label: "goal" }),
    ).rejects.toThrow(/already a core field/);
    await createFieldDefinition(ctx, { nodeKind: "CHARACTER", label: "Magic" });
  });

  it("imports an older backup's 'Published' books as Complete, keeping publication as a field", async () => {
    const book = await createBook(ctx, { title: "Ember", writingStatus: "COMPLETE" });
    const { data } = await exportWorkspaceJson(ctx, { scope: { kind: "all" } });
    const v2 = {
      ...data,
      version: 2,
      books: data.books.map((b) => {
        const legacy: Partial<typeof b> & { status: string } = { ...b, status: "PUBLISHED" };
        delete legacy.writingStatus;
        return legacy;
      }),
    };
    await resetDatabase();
    const other = await createAuthor("Jane");
    const bytes = new TextEncoder().encode(JSON.stringify(v2));
    const file = { sourceId: "authoros-json", filename: "old.json", bytes };
    const review = await reviewImport(other, file);
    expect(review.errors).toEqual([]);
    await runImport(other, file, { token: review.token! });
    expect((await db.book.findUniqueOrThrow({ where: { id: book.id } })).writingStatus).toBe(
      "COMPLETE",
    );
    const value = await db.nodeFieldValue.findFirstOrThrow({
      where: { nodeId: book.id },
      include: { field: true },
    });
    expect([value.field.label, value.value]).toEqual(["Publication status", "Published"]);
  });

  it("an import that replaces text keeps the replaced text in history", async () => {
    const c = await createCharacter(ctx, { name: "Elara", summary: "From the backup." });
    const { data } = await exportWorkspaceJson(ctx, { scope: { kind: "all" } });
    await updateCharacter(ctx, c.id, { name: "Elara", summary: "Written since." });
    const file = {
      sourceId: "authoros-json",
      filename: "b.json",
      bytes: new TextEncoder().encode(JSON.stringify(data)),
    };
    const review = await reviewImport(ctx, file, { existing: "replace" });
    await runImport(ctx, file, { existing: "replace", token: review.token! });
    expect((await listFieldHistory(ctx, c.id, "summary"))[0]).toMatchObject({
      value: "Written since.",
      source: "IMPORT",
    });
  });
});
