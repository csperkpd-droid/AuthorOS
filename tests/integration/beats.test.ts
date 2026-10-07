import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { ForbiddenError, RuleError } from "@/lib/errors";
import { connect } from "@/modules/connections";
import { exportWorkspaceJson } from "@/modules/exports";
import { listFieldHistory, restoreFieldValue } from "@/modules/history";
import { reviewImport, runImport } from "@/modules/imports";
import {
  createBook,
  createSeries,
  previewBookSeries,
  setBookSeries,
  trashBook,
} from "@/modules/library";
import {
  createChapter,
  createPart,
  createScene,
  trashPart,
  trashScene,
} from "@/modules/manuscript";
import { createNote } from "@/modules/notes";
import { auditGraph, resolveNode, searchNodes } from "@/modules/story-graph";
import {
  addBeat,
  assignScene,
  beatsForScene,
  createOutline,
  getOutline,
  keepPlacement,
  listOutlines,
  trashOutline,
  updateBeat,
} from "@/modules/structure";
import { restoreFromTrash } from "@/modules/trash";
import type { AuthorContext } from "@/server/context";

import { createAuthor, resetDatabase } from "../support/db";

/**
 * M14: beats are Story Graph objects, and each beat assignment has a
 * validity that follows its scene: Potentially Stale while the scene is in
 * the Trash, Conflicted when it leaves the structure's book or series (or
 * Intentionally Excepted when the author keeps it), Current otherwise.
 * Nothing is ever removed or re-placed for the author.
 */

let ctx: AuthorContext;

beforeEach(async () => {
  await resetDatabase();
  ctx = await createAuthor("Jane");
});

const placement = (beatId: string, sceneId: string) =>
  db.beatAssignment.findUniqueOrThrow({
    where: { beatId_sceneId: { beatId, sceneId } },
    select: { validity: true, exceptedAt: true, note: true },
  });

/** A series with one book, a series structure with one beat placed in a scene. */
async function seriesWithPlacement() {
  const series = await createSeries(ctx, { title: "Crown of Ash" });
  const book = await createBook(ctx, { title: "Ember", seriesId: series.id });
  const part = await createPart(ctx, book.id, "Part One");
  const chapter = await createChapter(ctx, book.id, { partId: part.id, title: "Sparks" });
  const scene = await createScene(ctx, chapter.id, "The fire");
  const outline = await createOutline(ctx, {
    seriesId: series.id,
    kind: "PLOT",
    title: "Series plot",
  });
  const beat = await addBeat(ctx, outline.id, { title: "Midpoint", targetPercent: 50 });
  await assignScene(ctx, beat.id, scene.id);
  return { series, book, part, chapter, scene, outline, beat };
}

/** Changes a book's series through its Change Impact review. */
async function moveBook(bookId: string, seriesId: string | null) {
  const report = await previewBookSeries(ctx, bookId, seriesId);
  await setBookSeries(ctx, bookId, seriesId, report.token);
  return report;
}

describe("beats as Story Graph objects", () => {
  it("are found, searched by name and opened at their structure", async () => {
    const { beat, outline } = await seriesWithPlacement();
    const node = await resolveNode(ctx, beat.id);
    expect(node).toMatchObject({
      kind: "BEAT",
      title: "Midpoint",
      context: "Series plot",
      href: `/structure/${outline.id}#beat-${beat.id}`,
    });
    const hits = await searchNodes(ctx, { query: "midp", kinds: ["BEAT"] });
    expect(hits.map((h) => h.id)).toEqual([beat.id]);
  });

  it("never leak: another workspace and a trashed structure hide them", async () => {
    const { beat, outline } = await seriesWithPlacement();
    const stranger = await createAuthor("Stranger");
    expect(await resolveNode(stranger, beat.id)).toBeNull();
    expect(await searchNodes(stranger, { query: "Midpoint", kinds: ["BEAT"] })).toEqual([]);
    await trashOutline(ctx, outline.id);
    expect(await resolveNode(ctx, beat.id)).toBeNull();
    expect(await searchNodes(ctx, { query: "Midpoint", kinds: ["BEAT"] })).toEqual([]);
  });

  it("can be connected, within their identity", async () => {
    const { beat } = await seriesWithPlacement();
    const note = await createNote(ctx, { title: "Why the midpoint turns" });
    await connect(ctx, { sourceId: note.id, targetId: beat.id, kind: "about" });
    expect(await auditGraph(ctx)).toEqual([]);
  });

  it("keep their description history on themselves, and restore it", async () => {
    const { beat } = await seriesWithPlacement();
    await updateBeat(ctx, beat.id, {
      title: "Midpoint",
      targetPercent: 50,
      description: "Everything changes.",
    });
    await updateBeat(ctx, beat.id, {
      title: "Midpoint",
      targetPercent: 50,
      description: "Nothing is the same.",
    });
    const history = await listFieldHistory(ctx, beat.id);
    expect(history).toEqual([
      expect.objectContaining({ field: "description", value: "Everything changes." }),
    ]);
    await restoreFieldValue(ctx, history[0].id);
    const outline = await db.beat.findUniqueOrThrow({ where: { id: beat.id } });
    expect(outline.description).toBe("Everything changes.");
    expect((await listFieldHistory(ctx, beat.id)).map((h) => [h.value, h.source])).toEqual([
      ["Nothing is the same.", "BEFORE_RESTORE"],
      ["Everything changes.", "BEFORE_EDIT"],
    ]);
  });

  it("each beat of a structure made from a template is its own object", async () => {
    const book = await createBook(ctx, { title: "Harbour Lights" });
    const plot = await createOutline(ctx, {
      bookId: book.id,
      kind: "PLOT",
      templateId: "00000000-0000-7000-8000-000000000a02",
    });
    const beats = (await getOutline(ctx, plot.id)).beats;
    expect(beats.length).toBeGreaterThan(5);
    const nodes = await db.storyNode.findMany({ where: { id: { in: beats.map((b) => b.id) } } });
    expect(nodes.every((n) => n.kind === "BEAT")).toBe(true);
    expect(nodes).toHaveLength(beats.length);
    expect(await auditGraph(ctx)).toEqual([]);
  });
});

describe("beat assignment validity", () => {
  it("starts Current", async () => {
    const { beat, scene } = await seriesWithPlacement();
    expect(await placement(beat.id, scene.id)).toEqual({
      validity: "CURRENT",
      exceptedAt: null,
      note: null,
    });
  });

  it("a scene in the Trash: Potentially Stale, kept; restored: Current again", async () => {
    const { beat, scene, outline } = await seriesWithPlacement();
    await trashScene(ctx, scene.id);
    expect((await placement(beat.id, scene.id)).validity).toBe("POTENTIALLY_STALE");
    const board = await getOutline(ctx, outline.id);
    expect(board.beats[0].scenes).toEqual([]);
    expect(board.beats[0].observations).toEqual([
      expect.objectContaining({
        sceneId: scene.id,
        sceneTitle: "The fire",
        validity: "POTENTIALLY_STALE",
      }),
    ]);
    await restoreFromTrash(ctx, "SCENE", scene.id);
    expect((await placement(beat.id, scene.id)).validity).toBe("CURRENT");
    expect((await getOutline(ctx, outline.id)).beats[0].scenes.map((s) => s.id)).toEqual([
      scene.id,
    ]);
    expect(await auditGraph(ctx)).toEqual([]);
  });

  it("follows what contains the scene: a part or a book in the Trash", async () => {
    const { beat, scene, part, book } = await seriesWithPlacement();
    await trashPart(ctx, part.id);
    expect((await placement(beat.id, scene.id)).validity).toBe("POTENTIALLY_STALE");
    await restoreFromTrash(ctx, "PART", part.id);
    expect((await placement(beat.id, scene.id)).validity).toBe("CURRENT");
    await trashBook(ctx, book.id);
    expect((await placement(beat.id, scene.id)).validity).toBe("POTENTIALLY_STALE");
    await restoreFromTrash(ctx, "BOOK", book.id);
    expect((await placement(beat.id, scene.id)).validity).toBe("CURRENT");
  });

  it("a book leaving the series: Conflicted, nothing removed; back in the series: Current", async () => {
    const { beat, scene, book, series, outline } = await seriesWithPlacement();
    const report = await moveBook(book.id, null);
    expect(report.groups.find((g) => g.key === "PLACEMENTS")).toMatchObject({
      count: 1,
      effect: expect.stringMatching(/^Kept/),
    });
    expect((await placement(beat.id, scene.id)).validity).toBe("CONFLICTED");
    expect(await db.beatAssignment.count()).toBe(1);
    expect(await db.scene.count({ where: { id: scene.id, deletedAt: null } })).toBe(1);
    // The board shows it as an observation, not as a placed scene.
    const board = await getOutline(ctx, outline.id);
    expect(board.beats[0]).toMatchObject({
      scenes: [],
      observations: [
        expect.objectContaining({ sceneId: scene.id, bookTitle: "Ember", validity: "CONFLICTED" }),
      ],
    });
    expect((await listOutlines(ctx, { seriesId: series.id }))[0].placedCount).toBe(0);
    expect(await beatsForScene(ctx, scene.id)).toEqual([
      expect.objectContaining({ beatId: beat.id, validity: "CONFLICTED" }),
    ]);
    expect(await auditGraph(ctx)).toEqual([]);

    await moveBook(book.id, series.id);
    expect((await placement(beat.id, scene.id)).validity).toBe("CURRENT");
    expect((await listOutlines(ctx, { seriesId: series.id }))[0].placedCount).toBe(1);
  });

  it("Intentionally Excepted is the author's choice; it lasts until the scene fits again", async () => {
    const { beat, scene, book, series, outline } = await seriesWithPlacement();
    // Only a placement that no longer fits can be kept this way.
    await expect(keepPlacement(ctx, beat.id, scene.id)).rejects.toBeInstanceOf(RuleError);
    await moveBook(book.id, null);
    await keepPlacement(ctx, beat.id, scene.id, { note: "The epilogue echoes it." });
    expect(await placement(beat.id, scene.id)).toMatchObject({
      validity: "INTENTIONALLY_EXCEPTED",
      exceptedAt: expect.any(Date),
      note: "The epilogue echoes it.",
    });
    expect((await getOutline(ctx, outline.id)).beats[0].observations).toEqual([
      expect.objectContaining({
        validity: "INTENTIONALLY_EXCEPTED",
        note: "The epilogue echoes it.",
      }),
    ]);
    expect((await listOutlines(ctx, { seriesId: series.id }))[0].placedCount).toBe(1);

    // Trashed and restored while still outside: the author's choice stands.
    await trashScene(ctx, scene.id);
    expect((await placement(beat.id, scene.id)).validity).toBe("POTENTIALLY_STALE");
    await restoreFromTrash(ctx, "SCENE", scene.id);
    expect((await placement(beat.id, scene.id)).validity).toBe("INTENTIONALLY_EXCEPTED");

    // Back in the series: simply Current, the exception no longer needed.
    await moveBook(book.id, series.id);
    expect(await placement(beat.id, scene.id)).toMatchObject({
      validity: "CURRENT",
      exceptedAt: null,
    });
    expect(await auditGraph(ctx)).toEqual([]);
  });

  it("keeping a placement needs edit rights on structure", async () => {
    const { beat, scene, book } = await seriesWithPlacement();
    await moveBook(book.id, null);
    const viewer = { ...ctx, role: "VIEWER" as const };
    await expect(keepPlacement(viewer, beat.id, scene.id)).rejects.toBeInstanceOf(ForbiddenError);
    expect((await placement(beat.id, scene.id)).validity).toBe("CONFLICTED");
  });
});

describe("backups (format 7)", () => {
  it("keep beats, validity, the author's exceptions and notes", async () => {
    const { beat, scene, book } = await seriesWithPlacement();
    await updateBeat(ctx, beat.id, { title: "Midpoint", targetPercent: 50, description: "One" });
    await updateBeat(ctx, beat.id, { title: "Midpoint", targetPercent: 50, description: "Two" });
    await moveBook(book.id, null);
    await keepPlacement(ctx, beat.id, scene.id, { note: "Kept on purpose." });
    const { data } = await exportWorkspaceJson(ctx, { scope: { kind: "all" }, kind: "archive" });
    expect(data.version).toBe(7);
    expect(data.storyNodes).toContainEqual({ id: beat.id, kind: "BEAT" });
    expect(data.beatScenes).toEqual([
      expect.objectContaining({
        beatId: beat.id,
        sceneId: scene.id,
        validity: "INTENTIONALLY_EXCEPTED",
        note: "Kept on purpose.",
      }),
    ]);

    await resetDatabase();
    const other = await createAuthor("Jane");
    const file = {
      sourceId: "authoros-json",
      filename: "backup.json",
      bytes: new TextEncoder().encode(JSON.stringify(data)),
    };
    const review = await reviewImport(other, file);
    expect(review.conflicts).toEqual([]);
    await runImport(other, file, { token: review.token! });
    expect(await placement(beat.id, scene.id)).toMatchObject({
      validity: "INTENTIONALLY_EXCEPTED",
      note: "Kept on purpose.",
    });
    expect((await resolveNode(other, beat.id))?.kind).toBe("BEAT");
    expect((await listFieldHistory(other, beat.id)).map((h) => h.value)).toEqual(["One"]);
    expect(await auditGraph(other)).toEqual([]);
  });

  it("upgrade an older file: beats become objects, history moves onto them", async () => {
    const { beat, outline, scene } = await seriesWithPlacement();
    await updateBeat(ctx, beat.id, { title: "Midpoint", targetPercent: 50, description: "One" });
    await updateBeat(ctx, beat.id, { title: "Midpoint", targetPercent: 50, description: "Two" });
    const { data } = await exportWorkspaceJson(ctx, { scope: { kind: "all" }, kind: "archive" });
    // As a format 6 file looked: no beat nodes, history on the structure,
    // placements without validity.
    const old = {
      ...data,
      version: 6,
      storyNodes: data.storyNodes.filter((n) => n.kind !== "BEAT"),
      fieldRevisions: data.fieldRevisions!.map((r) =>
        r.nodeId === beat.id
          ? { ...r, nodeId: outline.id, field: `beat:${beat.id}.description` }
          : r,
      ),
      beatScenes: data.beatScenes.map(({ beatId, sceneId, createdAt }) => ({
        beatId,
        sceneId,
        createdAt,
      })),
    };
    await resetDatabase();
    const other = await createAuthor("Jane");
    const file = {
      sourceId: "authoros-json",
      filename: "old.json",
      bytes: new TextEncoder().encode(JSON.stringify(old)),
    };
    const review = await reviewImport(other, file);
    expect(review.errors).toEqual([]);
    expect(review.conflicts).toEqual([]);
    await runImport(other, file, { token: review.token! });
    expect((await resolveNode(other, beat.id))?.kind).toBe("BEAT");
    expect((await placement(beat.id, scene.id)).validity).toBe("CURRENT");
    expect(await listFieldHistory(other, beat.id)).toEqual([
      expect.objectContaining({ field: "description", value: "One" }),
    ]);
    expect(await auditGraph(other)).toEqual([]);
  });

  it("an older file's placements get their validity from what is imported", async () => {
    const { beat, scene } = await seriesWithPlacement();
    await trashScene(ctx, scene.id);
    const { data } = await exportWorkspaceJson(ctx, { scope: { kind: "all" } });
    const old = {
      ...data,
      version: 6,
      storyNodes: data.storyNodes.filter((n) => n.kind !== "BEAT"),
      beatScenes: data.beatScenes.map(({ beatId, sceneId, createdAt }) => ({
        beatId,
        sceneId,
        createdAt,
      })),
    };
    await resetDatabase();
    const other = await createAuthor("Jane");
    const file = {
      sourceId: "authoros-json",
      filename: "old.json",
      bytes: new TextEncoder().encode(JSON.stringify(old)),
    };
    const review = await reviewImport(other, file);
    await runImport(other, file, { token: review.token! });
    expect(await placement(beat.id, scene.id)).toMatchObject({
      validity: "POTENTIALLY_STALE",
      exceptedAt: null,
    });
    expect(await db.scene.count({ where: { id: scene.id, deletedAt: { not: null } } })).toBe(1);
  });
});
