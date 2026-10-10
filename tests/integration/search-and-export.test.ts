import JSZip from "jszip";
import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { setDeadline } from "@/modules/calendar";
import { RuleError } from "@/lib/errors";
import { createCharacter, trashCharacter, updateProfileField } from "@/modules/characters";
import {
  checkExportIntegrity,
  exportDocx,
  exportMarkdown,
  exportWorkspaceJson,
} from "@/modules/exports";
import { createFieldDefinition, setFieldValue } from "@/modules/fields";
import { createIdea } from "@/modules/ideas";
import { createBook, createSeries, updateBook } from "@/modules/library";
import {
  createChapter,
  createPart,
  createScene,
  moveChapter,
  saveSceneContent,
} from "@/modules/manuscript";
import { createNote } from "@/modules/notes";
import { createPenName, setActiveIdentity } from "@/modules/pen-names";
import { createRelationship } from "@/modules/relationships";
import { search, toPrefixQuery } from "@/modules/search";
import { assignScene, createKit, createOutline, getOutline } from "@/modules/structure";
import { createTask } from "@/modules/tasks";
import { addParticipant } from "@/modules/participation";
import type { AuthorContext } from "@/server/context";

import { createAuthor, resetDatabase } from "../support/db";

let ctx: AuthorContext;

beforeEach(async () => {
  await resetDatabase();
  ctx = await createAuthor("Jane");
});

const para = (text: string, ...marks: string[]) => ({
  type: "paragraph",
  content: [
    { type: "text", text, ...(marks.length ? { marks: marks.map((type) => ({ type })) } : {}) },
  ],
});
const doc = (...content: object[]) => ({ type: "doc", content });

async function sceneWith(
  bookId: string,
  chapterId: string | null,
  title: string,
  ...paras: object[]
) {
  const chapter = chapterId ?? (await createChapter(ctx, bookId)).id;
  const scene = await createScene(ctx, chapter, title);
  await saveSceneContent(ctx, { sceneId: scene.id, content: doc(...paras), baseVersion: 0 });
  return { sceneId: scene.id, chapterId: chapter };
}

describe("search", () => {
  it("finds text in scenes, notes, ideas and characters, and titles of everything else", async () => {
    const book = await createBook(ctx, { title: "Harbour Lights" });
    await sceneWith(
      book.id,
      null,
      "Arrival",
      para("The lighthouse keeper counted the ships coming home."),
    );
    await createNote(ctx, { title: "Lighthouse research" });
    await createIdea(ctx, { title: "A keeper who can't swim" });
    const mara = await createCharacter(ctx, { name: "Mara Quinn", aliases: ["The Keeper"] });
    await createTask(ctx, { title: "Visit a lighthouse" });

    const results = await search(ctx, { query: "lighth" });
    expect(results.map((r) => [r.node.kind, r.node.title]).sort()).toEqual([
      ["NOTE", "Lighthouse research"],
      ["SCENE", "Arrival"],
      ["TASK", "Visit a lighthouse"],
    ]);
    const scene = results.find((r) => r.node.kind === "SCENE")!;
    expect(scene.snippet).toContain("«lighthouse»");

    expect((await search(ctx, { query: "keeper" })).map((r) => r.node.title).sort()).toEqual([
      "A keeper who can't swim",
      "Arrival",
      "Mara Quinn",
    ]);
    // Every word must match.
    expect((await search(ctx, { query: "keeper swim" })).map((r) => r.node.title)).toEqual([
      "A keeper who can't swim",
    ]);
    // Trashed objects aren't found.
    await trashCharacter(ctx, mara.id);
    expect((await search(ctx, { query: "Quinn" })).length).toBe(0);
    expect(await search(ctx, { query: "  !!  " })).toEqual([]);
    expect(toPrefixQuery("l'ight & house|")).toBe("l:* & ight:* & house:*");
  });

  it("follows Writing as: other identities' work is left out", async () => {
    const rose = await createPenName(ctx, { name: "Rose" });
    const mine = await createBook(ctx, { title: "Mine" });
    const theirs = await createBook(ctx, { title: "Theirs", penNameId: rose.id });
    await sceneWith(mine.id, null, "S1", para("storm at sea"));
    await sceneWith(theirs.id, null, "S2", para("storm in the hills"));
    await createNote(ctx, { title: "Storm notes" });

    const janeId = (
      await db.penName.findFirstOrThrow({
        where: { isDefault: true, workspaceId: ctx.workspaceId },
      })
    ).id;
    const writingAsJane = await search(ctx, { query: "storm", penNameId: janeId });
    expect(writingAsJane.map((r) => r.node.title).sort()).toEqual(["S1", "Storm notes"]);
    expect((await search(ctx, { query: "storm" })).length).toBe(3);
  });
});

describe("manuscript export", () => {
  async function seedBook() {
    const book = await createBook(ctx, { title: "Harbour Lights", subtitle: "A Novel" });
    const part = await createPart(ctx, book.id, "Part One");
    const { chapterId } = await sceneWith(
      book.id,
      null,
      "Arrival",
      { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Dawn" }] },
      para("The keeper woke "),
      para("before the storm.", "italic"),
    );
    await moveChapter(ctx, chapterId, { partId: part.id, afterId: null });
    await sceneWith(book.id, chapterId, "Second", para("Waves broke."));
    return book;
  }

  it("Markdown: books, parts, chapters and scene breaks, from the visible manuscript", async () => {
    const book = await seedBook();
    const { filename, content } = await exportMarkdown(ctx, {
      scope: { kind: "all" },
      bookIds: [book.id],
    });
    expect(filename).toBe("harbour-lights.md");
    expect(content).toBe(
      [
        "# Harbour Lights",
        "*A Novel*",
        "by Jane",
        "## Part One",
        "### Chapter 1",
        "#### Dawn",
        "The keeper woke",
        "*before the storm.*",
        "* * *",
        "Waves broke.",
      ].join("\n\n") + "\n",
    );
  });

  it("DOCX: a standard manuscript document", async () => {
    const book = await seedBook();
    const { filename, buffer } = await exportDocx(ctx, {
      scope: { kind: "all" },
      bookIds: [book.id],
    });
    expect(filename).toBe("harbour-lights.docx");
    const zip = await JSZip.loadAsync(buffer);
    const xml = await zip.file("word/document.xml")!.async("string");
    for (const text of [
      "HARBOUR LIGHTS",
      "by Jane",
      "PART ONE",
      "Chapter 1",
      "The keeper woke",
      "Waves broke.",
    ]) {
      expect(xml).toContain(text);
    }
    expect(xml).toContain('w:line="480"'); // double-spaced
    expect(xml).toContain("<w:i/>"); // italics kept
  });

  it("follows the chosen pen names, and refuses an empty selection", async () => {
    const rose = await createPenName(ctx, { name: "Rose" });
    await createBook(ctx, { title: "Mine" });
    const theirs = await createBook(ctx, { title: "Theirs", penNameId: rose.id });
    await createChapter(ctx, theirs.id);
    const md = await exportMarkdown(ctx, { scope: { kind: "selected", penNameIds: [rose.id] } });
    expect(md.content).toContain("# Theirs");
    expect(md.content).not.toContain("# Mine");
    await expect(exportMarkdown(ctx, { scope: { kind: "current" } })).rejects.toBeInstanceOf(
      RuleError,
    );
    await setActiveIdentity(ctx, rose.id);
    const writingAsRose = { ...ctx, activePenNameId: rose.id };
    expect((await exportMarkdown(writingAsRose, { scope: { kind: "current" } })).content).toContain(
      "# Theirs",
    );
  });
});

/** A checksum of every row of the story tables (exports must not change any). */
async function fingerprint() {
  const tables = [
    "story_nodes",
    "books",
    "scenes",
    "characters",
    "relationships",
    "relationship_members",
    "connections",
    "outlines",
    "beats",
    "beat_assignments",
    "notes",
    "content_revisions",
    "node_field_values",
  ];
  const sums: Record<string, string> = {};
  for (const t of tables) {
    const [row] = await db.$queryRawUnsafe<{ sum: string }[]>(
      `SELECT md5(coalesce(string_agg(x::text, '|' ORDER BY x::text), '')) AS sum FROM "${t}" x`,
    );
    sums[t] = row.sum;
  }
  return sums;
}

describe("workspace JSON export", () => {
  async function seedGraph() {
    const rose = await createPenName(ctx, { name: "Rose" });
    const series = await createSeries(ctx, { title: "Crown" });
    const book = await createBook(ctx, { title: "Ember", seriesId: series.id });
    const { sceneId } = await sceneWith(book.id, null, "Opening", para("Ash fell."));
    const [a, b, c] = await Promise.all(
      ["Elara", "Kael", "Rowan"].map(
        async (name) => (await createCharacter(ctx, { name, seriesId: series.id })).id,
      ),
    );
    await updateProfileField(ctx, a, "goal", "Survive");
    await addParticipant(ctx, sceneId, { characterId: a, pov: true });
    const group = await createRelationship(ctx, { characterIds: [a, b, c], type: "Romance" });
    const arc = await createOutline(ctx, {
      seriesId: series.id,
      kind: "ROMANCE",
      relationshipId: group.id,
      templateId: "00000000-0000-7000-8000-000000000a04",
    });
    await assignScene(ctx, (await getOutline(ctx, arc.id)).beats[0].id, sceneId);
    const field = await createFieldDefinition(ctx, { nodeKind: "CHARACTER", label: "Magic" });
    await setFieldValue(ctx, a, field.id, "Fire");
    const sharedNote = await createNote(ctx, { title: "World notes", aboutId: series.id });
    // Rose's work, and a note only about it.
    const roseBook = await createBook(ctx, { title: "Rose book", penNameId: rose.id });
    const roseOnly = await createNote(ctx, { title: "Rose research", aboutId: roseBook.id });
    const loose = await createNote(ctx, { title: "Loose idea" });
    await updateBook(ctx, book.id, { title: "Ember", targetWordCount: "90000" });
    await setDeadline(ctx, book.id, "2027-03-01");
    await createKit(ctx, { name: "Kit", templateIds: ["00000000-0000-7000-8000-000000000a02"] });
    return { rose, series, book, sceneId, group, arc, sharedNote, roseBook, roseOnly, loose };
  }

  it("preserves ids, hierarchy, relationships, connections and assignments, consistently", async () => {
    const s = await seedGraph();
    const before = await fingerprint();
    const { data, filename } = await exportWorkspaceJson(ctx, {
      scope: { kind: "all" },
      kind: "archive",
    });

    expect(filename).toMatch(/^spellbound-draft-workspace-archive-\d{4}-\d{2}-\d{2}\.json$/);
    expect(data).toMatchObject({
      format: "authoros.workspace",
      version: 8,
      scope: { kind: "workspace" },
    });
    expect(checkExportIntegrity(data)).toEqual([]);
    expect(data.books.map((b) => b.id).sort()).toEqual([s.book.id, s.roseBook.id].sort());
    expect(data.scenes[0]).toMatchObject({ id: s.sceneId, contentText: "Ash fell." });
    expect(data.relationships[0].members).toHaveLength(3);
    expect(data.sceneParticipations).toEqual([
      expect.objectContaining({ sceneId: s.sceneId, presence: "PRESENT", isPov: true }),
    ]);
    expect(data.connections.some((c) => c.kind === "appears_in")).toBe(false);
    expect(data.beatScenes).toEqual([expect.objectContaining({ sceneId: s.sceneId })]);
    expect(data.outlines[0]).toMatchObject({
      id: s.arc.id,
      seriesId: s.series.id,
      relationshipId: s.group.id,
    });
    expect(data.fieldValues).toEqual([expect.objectContaining({ value: "Fire" })]);
    expect(data.templateKits[0].items).toHaveLength(1);
    expect(data.contentRevisions).toBeDefined();
    expect(data.storyNodes.length).toBe(
      data.penNames.length +
        data.series.length +
        data.books.length +
        data.parts.length +
        data.chapters.length +
        data.scenes.length +
        data.characters.length +
        data.relationships.length +
        data.notes.length +
        data.ideas.length +
        data.tasks.length +
        data.calendarEvents.length +
        data.outlines.length +
        // Beats are story objects since M14.
        data.outlineBeats.length,
    );
    // Survives a round trip through JSON text.
    const text = JSON.stringify(data);
    expect(checkExportIntegrity(JSON.parse(text))).toEqual([]);

    // Exporting changes nothing.
    const after = await fingerprint();
    expect(after).toEqual(before);
  });

  it("scoped to pen names: only their work, shared items not linked only elsewhere, links inside", async () => {
    const s = await seedGraph();
    const jane = (
      await db.penName.findFirstOrThrow({
        where: { isDefault: true, workspaceId: ctx.workspaceId },
      })
    ).id;
    const { data } = await exportWorkspaceJson(ctx, {
      scope: { kind: "selected", penNameIds: [jane] },
    });
    expect(checkExportIntegrity(data)).toEqual([]);
    expect(data.penNames.map((p) => p.id)).toEqual([jane]);
    expect(data.books.map((b) => b.title)).toEqual(["Ember"]);
    expect(data.notes.map((n) => n.title).sort()).toEqual(["Loose idea", "World notes"]);
    expect(data.connections.every((c) => c.sourceId !== s.roseOnly.id)).toBe(true);
    expect(data.contentRevisions).toBeUndefined();
  });
});

describe("search by language and phrase", () => {
  it("finds word forms in a pen name's language, keeps exact phrases exact", async () => {
    const { updatePenName, getDefaultPenName } = await import("@/modules/pen-names");
    const jane = await getDefaultPenName(ctx);
    const book = await createBook(ctx, { title: "Harbour Lights" });
    await sceneWith(book.id, null, "Flight", para("She was running toward the lighthouses."));
    await createNote(ctx, { title: "Runs and tides" });

    // Without a language, only exact words (as prefixes) match: "runs" isn't
    // a prefix of "running".
    expect((await search(ctx, { query: "runs" })).map((r) => r.node.title)).toEqual([
      "Runs and tides",
    ]);
    await updatePenName(ctx, jane.id, { name: jane.name, language: "en" });
    const found = (await search(ctx, { query: "runs" })).map((r) => r.node.title).sort();
    expect(found).toEqual(["Flight", "Runs and tides"]);
    expect((await search(ctx, { query: "lighthouse" })).map((r) => r.node.title)).toEqual([
      "Flight",
    ]);

    // Quoted phrases match exactly, in order.
    expect((await search(ctx, { query: '"running toward"' })).map((r) => r.node.title)).toEqual([
      "Flight",
    ]);
    expect(await search(ctx, { query: '"toward running"' })).toEqual([]);

    // Another pen name's language doesn't apply to this one's work.
    const rose = await createPenName(ctx, { name: "Rose", language: "es" });
    const roseBook = await createBook(ctx, { title: "Libro", penNameId: rose.id });
    await sceneWith(roseBook.id, null, "Huida", para("Corrían hacia el faro."));
    expect((await search(ctx, { query: "corrian" })).length).toBe(0); // accents differ: exact only
    expect((await search(ctx, { query: "corrían" })).map((r) => r.node.title)).toEqual(["Huida"]);
    await expect(
      updatePenName(ctx, rose.id, { name: "Rose", language: "Klingon!" }),
    ).rejects.toThrow();
  });
});
