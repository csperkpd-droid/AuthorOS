import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { WorkspaceRole } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { ConflictError, ForbiddenError, NotFoundError, RuleError } from "@/lib/errors";
import { createCharacter } from "@/modules/characters";
import { connect, listConnections } from "@/modules/connections";
import { exportWorkspaceJson } from "@/modules/exports";
import { listFieldHistory, listStoryTimeHistory } from "@/modules/history";
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
  createScene,
  moveScene,
  saveSceneContent,
  trashScene,
} from "@/modules/manuscript";
import { createNote } from "@/modules/notes";
import { addParticipant } from "@/modules/participation";
import { search } from "@/modules/search";
import { auditGraph, resolveNode } from "@/modules/story-graph";
import {
  createTimelineEvent,
  getSceneStoryTime,
  getTimeline,
  getTimelineEvent,
  listTimelines,
  moveTimelineEvent,
  placeSceneInTime,
  removeSceneFromTime,
  setStoryTimeLabel,
  trashTimelineEvent,
  updateTimelineEvent,
} from "@/modules/timeline";
import { deleteForever, previewDeleteForever, restoreFromTrash } from "@/modules/trash";
import type { AuthorContext } from "@/server/context";
import { ROLE_GRANTS } from "@/server/policy";

import { createAuthor, resetDatabase } from "../support/db";

/**
 * M12 Story Time (decision 109): scenes and timeline events in story order,
 * separate from reading order, never inferred, never dates.
 */

let ctx: AuthorContext;
let bookId: string;
let chapterId: string;
let s1: string;
let s2: string;
let s3: string;

const doc = (text: string) => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

beforeEach(async () => {
  await resetDatabase();
  ctx = await createAuthor("Jane");
  bookId = (await createBook(ctx, { title: "Harbour Lights" })).id;
  chapterId = (await createChapter(ctx, bookId, { title: "Arrival" })).id;
  s1 = (await createScene(ctx, chapterId, "The storm")).id;
  s2 = (await createScene(ctx, chapterId, "The letter")).id;
  s3 = (await createScene(ctx, chapterId, "The calm")).id;
});

afterEach(() => {
  for (const name of ["SCENES_ONLY", "BIBLE_ONLY", "MANUSCRIPT_READER"])
    delete (ROLE_GRANTS as Record<string, unknown>)[name];
});

const storyOrder = async (ownerId = bookId, as: AuthorContext = ctx) =>
  (await getTimeline(as, ownerId)).entries.map((e) =>
    e.label ? `${e.title} (${e.label})` : e.title,
  );

const binder = async () =>
  (await db.scene.findMany({ where: { chapterId }, orderBy: { position: "asc" } })).map(
    (s) => s.title,
  );

function role(name: string, grants: Partial<Record<string, string[]>>) {
  (ROLE_GRANTS as Record<string, unknown>)[name] = {
    identity: ["view"],
    manuscript: ["view"],
    storyBible: ["view"],
    structure: ["view"],
    planning: ["view"],
    workspace: ["view"],
    ...grants,
  };
  return { ...ctx, role: name as WorkspaceRole };
}

describe("Story Time: scenes", () => {
  it("places scenes in story order with free-form labels, apart from reading order", async () => {
    // A flashback: "The letter" happens first in the story.
    await placeSceneInTime(ctx, s2, { afterId: null, label: "Ten years earlier" });
    await placeSceneInTime(ctx, s1, { afterId: s2, label: "Day 1, night" });
    await placeSceneInTime(ctx, s3, { afterId: s1, label: "Day 2" });
    expect(await storyOrder()).toEqual([
      "The letter (Ten years earlier)",
      "The storm (Day 1, night)",
      "The calm (Day 2)",
    ]);
    // Reading order (the binder) is untouched, and shown beside story order.
    expect(await binder()).toEqual(["The storm", "The letter", "The calm"]);
    const timeline = await getTimeline(ctx, bookId);
    expect(timeline.entries.map((e) => e.readingIndex)).toEqual([2, 1, 3]);

    // Moving a scene in the book doesn't move it in story time, and back.
    await moveScene(ctx, s3, { chapterId, afterId: null });
    expect(await binder()).toEqual(["The calm", "The storm", "The letter"]);
    expect((await storyOrder()).at(-1)).toBe("The calm (Day 2)");
    await placeSceneInTime(ctx, s3, { afterId: null });
    expect(await binder()).toEqual(["The calm", "The storm", "The letter"]);
    expect((await storyOrder())[0]).toBe("The calm (Day 2)"); // the label is kept
  });

  it("never places a scene for the author", async () => {
    await placeSceneInTime(ctx, s1, { afterId: null });
    const s4 = (await createScene(ctx, chapterId, "New scene")).id;
    const timeline = await getTimeline(ctx, bookId);
    expect(timeline.entries.map((e) => e.id)).toEqual([s1]);
    expect(timeline.unplaced.map((e) => e.id)).toEqual([s2, s3, s4]);
    expect(await getSceneStoryTime(ctx, s4)).toMatchObject({ placed: false, order: null });
  });

  it("keeps labels as the author's words, never dates (they don't order anything)", async () => {
    await placeSceneInTime(ctx, s1, { afterId: null, label: "2024-03-01" });
    await placeSceneInTime(ctx, s2, { afterId: null, label: "1999-01-01" });
    // Placed first, so first — whatever the label looks like.
    expect(await storyOrder()).toEqual(["The letter (1999-01-01)", "The storm (2024-03-01)"]);
    await setStoryTimeLabel(ctx, s1, { label: "Unknown" });
    expect((await getSceneStoryTime(ctx, s1)).label).toBe("Unknown");
  });

  it("changes a label only from what the author saw", async () => {
    await placeSceneInTime(ctx, s1, { afterId: null, label: "Day 1" });
    await setStoryTimeLabel(ctx, s1, { label: "Day 2", expected: "Day 1" });
    await expect(
      setStoryTimeLabel(ctx, s1, { label: "Day 3", expected: "Day 1" }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect((await getSceneStoryTime(ctx, s1)).label).toBe("Day 2");
    await expect(setStoryTimeLabel(ctx, s2, { label: "Day 9" })).rejects.toBeInstanceOf(RuleError);
  });

  it("takes a scene out of story time without touching anything else", async () => {
    await placeSceneInTime(ctx, s1, { afterId: null });
    await placeSceneInTime(ctx, s2, { afterId: s1 });
    await removeSceneFromTime(ctx, s1);
    expect(await storyOrder()).toEqual(["The letter"]);
    expect(await db.scene.count({ where: { id: s1, deletedAt: null } })).toBe(1);
  });

  it("never changes the manuscript text", async () => {
    await saveSceneContent(ctx, {
      sceneId: s1,
      content: doc("Rain on the glass."),
      baseVersion: 0,
    });
    const before = await db.scene.findUniqueOrThrow({ where: { id: s1 } });
    const revisions = await db.contentRevision.count();
    await placeSceneInTime(ctx, s1, { afterId: null, label: "Day 1" });
    await setStoryTimeLabel(ctx, s1, { label: "Day 2" });
    await placeSceneInTime(ctx, s1, { afterId: null });
    await removeSceneFromTime(ctx, s1);
    const after = await db.scene.findUniqueOrThrow({ where: { id: s1 } });
    expect([after.content, after.contentText, after.version, after.position]).toEqual([
      before.content,
      before.contentText,
      before.version,
      before.position,
    ]);
    expect(await db.contentRevision.count()).toBe(revisions);
  });

  it("keeps every change in the scene's Story History", async () => {
    await placeSceneInTime(ctx, s2, { afterId: null });
    await placeSceneInTime(ctx, s1, { afterId: s2, label: "Day 1" });
    await setStoryTimeLabel(ctx, s1, { label: "Day 2" });
    await placeSceneInTime(ctx, s1, { afterId: null });
    await removeSceneFromTime(ctx, s1);
    const history = (await listStoryTimeHistory(ctx, s1)).reverse();
    expect(history.map((h) => [h.change.action, h.after?.title ?? null])).toEqual([
      ["placed", "The letter"],
      ["label", null],
      ["moved", null],
      ["unplaced", null],
    ]);
    expect(history[1].change).toMatchObject({ previousLabel: "Day 1", label: "Day 2" });
    // A record, not earlier text.
    expect(await listFieldHistory(ctx, s1)).toEqual([]);
  });
});

describe("Story Time: timeline events", () => {
  it("creates, edits, moves, trashes and restores events among the scenes", async () => {
    await placeSceneInTime(ctx, s1, { afterId: null, label: "Day 1" });
    await placeSceneInTime(ctx, s2, { afterId: s1, label: "Day 3" });
    const wreck = await createTimelineEvent(ctx, {
      ownerId: bookId,
      title: "The shipwreck",
      label: "Day 2",
      afterId: s1,
    });
    const ending = await createTimelineEvent(ctx, { ownerId: bookId, title: "The funeral" });
    expect(await storyOrder()).toEqual([
      "The storm (Day 1)",
      "The shipwreck (Day 2)",
      "The letter (Day 3)",
      "The funeral",
    ]);

    await updateTimelineEvent(ctx, wreck.id, {
      title: "The wreck",
      label: "Day 2, dawn",
      description: "The Marigold goes down.",
    });
    await updateTimelineEvent(ctx, wreck.id, {
      title: "The wreck",
      description: "The Marigold goes down with all hands.",
    });
    expect((await listFieldHistory(ctx, wreck.id)).map((h) => h.value)).toEqual([
      "The Marigold goes down.",
    ]);
    await moveTimelineEvent(ctx, ending.id, null);
    expect((await storyOrder())[0]).toBe("The funeral");

    await trashTimelineEvent(ctx, ending.id);
    expect(await storyOrder()).not.toContain("The funeral");
    await restoreFromTrash(ctx, "TIMELINE_EVENT", ending.id);
    expect((await storyOrder())[0]).toBe("The funeral");

    const view = await getTimelineEvent(ctx, wreck.id);
    expect(view).toMatchObject({ title: "The wreck", label: "Day 2, dawn" });
    expect(view.timelineHref).toBe(`/timeline/${bookId}`);
  });

  it("refuses a stale event form", async () => {
    const e = await createTimelineEvent(ctx, { ownerId: bookId, title: "Wreck" });
    const { updatedAt } = await getTimelineEvent(ctx, e.id);
    await updateTimelineEvent(ctx, e.id, { title: "Wreck 2" }, { expectedUpdatedAt: updatedAt });
    await expect(
      updateTimelineEvent(ctx, e.id, { title: "Wreck 3" }, { expectedUpdatedAt: updatedAt }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("is a story object: found, searched, connected, and in the audit", async () => {
    const e = await createTimelineEvent(ctx, { ownerId: bookId, title: "Lighthouse fire" });
    expect(await resolveNode(ctx, e.id)).toMatchObject({
      kind: "TIMELINE_EVENT",
      href: `/timeline/events/${e.id}`,
    });
    expect((await search(ctx, { query: "lighthouse" })).map((r) => r.node.id)).toContain(e.id);
    const note = await createNote(ctx, { title: "Fire research" });
    await connect(ctx, { sourceId: note.id, targetId: e.id, kind: "about" });
    expect((await listConnections(ctx, e.id)).map((c) => c.other.title)).toEqual(["Fire research"]);
    expect(await auditGraph(ctx)).toEqual([]);
  });
});

describe("Story Time: series timelines and series changes", () => {
  async function seriesWithTwoBooks() {
    const series = await createSeries(ctx, { title: "Crown" });
    const b1 = await createBook(ctx, { title: "Book One", seriesId: series.id });
    const b2 = await createBook(ctx, { title: "Book Two", seriesId: series.id });
    const c1 = await createChapter(ctx, b1.id);
    const c2 = await createChapter(ctx, b2.id);
    const a = (await createScene(ctx, c1.id, "One A")).id;
    const b = (await createScene(ctx, c2.id, "Two A")).id;
    return { series, b1, b2, a, b };
  }

  it("interleaves the scenes of a series' books in one timeline", async () => {
    const { series, b1, a, b } = await seriesWithTwoBooks();
    await placeSceneInTime(ctx, b, { afterId: null, label: "Before the war" });
    await placeSceneInTime(ctx, a, { afterId: b });
    await createTimelineEvent(ctx, { ownerId: series.id, title: "The war", afterId: b });
    expect(await storyOrder(series.id)).toEqual(["Two A (Before the war)", "The war", "One A"]);
    // A book of the series opens the series' timeline.
    expect((await getTimeline(ctx, b1.id)).owner).toMatchObject({ id: series.id, kind: "SERIES" });
    expect((await listTimelines(ctx)).map((t) => t.title)).toEqual(["Crown", "Harbour Lights"]);
  });

  it("moving a book into or out of a series is reviewed (Red) and never silently rearranged", async () => {
    const { series, b2, a, b } = await seriesWithTwoBooks();
    await placeSceneInTime(ctx, a, { afterId: null });
    await placeSceneInTime(ctx, b, { afterId: null }); // Two A before One A
    const prologue = await createTimelineEvent(ctx, { ownerId: series.id, title: "Prologue" });

    // Leaving: listed, approval required; the book keeps its own order.
    const leave = await previewBookSeries(ctx, b2.id, null);
    const group = leave.groups.find((g) => g.key === "STORY_TIME")!;
    expect(group.count).toBe(1);
    expect(group.items.map((i) => i.title)).toEqual(["Two A"]);
    await expect(setBookSeries(ctx, b2.id, null)).rejects.toThrow(/Review/);
    expect((await getTimeline(ctx, b2.id)).owner.id).toBe(series.id); // nothing changed
    await setBookSeries(ctx, b2.id, null, leave.token);
    expect(await storyOrder(b2.id)).toEqual(["Two A"]);
    expect(await storyOrder(series.id)).toEqual(["One A", "Prologue"]);

    // Joining (here: the standalone "Harbour Lights"): placed after what is
    // there, in its own order, once approved.
    await placeSceneInTime(ctx, s2, { afterId: null, label: "First" });
    await placeSceneInTime(ctx, s1, { afterId: s2, label: "Second" });
    const join = await previewBookSeries(ctx, bookId, series.id);
    expect(join.groups.find((g) => g.key === "STORY_TIME")?.count).toBe(2);
    await expect(setBookSeries(ctx, bookId, series.id)).rejects.toThrow(/Review/);
    expect(await storyOrder(series.id)).toEqual(["One A", "Prologue"]);
    await setBookSeries(ctx, bookId, series.id, join.token);
    expect(await storyOrder(series.id)).toEqual([
      "One A",
      "Prologue",
      "The letter (First)",
      "The storm (Second)",
    ]);
    expect(prologue.id).toBeTruthy();
  });

  it("a book with nothing in Story Time changes series without a story-time review", async () => {
    const series = await createSeries(ctx, { title: "Crown" });
    const report = await previewBookSeries(ctx, bookId, series.id);
    expect(report.groups.find((g) => g.key === "STORY_TIME")?.count ?? 0).toBe(0);
    await setBookSeries(ctx, bookId, series.id);
    expect((await getTimeline(ctx, bookId)).owner.id).toBe(series.id);
  });
});

describe("Story Time: characters, access, Trash", () => {
  it("narrows a timeline to one character's scenes, by their part", async () => {
    const charlie = (await createCharacter(ctx, { name: "Charlie" })).id;
    await addParticipant(ctx, s1, { characterId: charlie, pov: true });
    await addParticipant(ctx, s3, { characterId: charlie, presence: "MENTIONED" });
    for (const s of [s3, s2, s1]) await placeSceneInTime(ctx, s, { afterId: null });
    await createTimelineEvent(ctx, { ownerId: bookId, title: "Wreck" });
    const only = async (r: "all" | "pov" | "present" | "mentioned") =>
      (await getTimeline(ctx, bookId, { characterId: charlie, role: r })).entries.map(
        (e) => e.title,
      );
    expect(await only("all")).toEqual(["The storm", "The calm", "Wreck"]);
    expect(await only("pov")).toEqual(["The storm", "Wreck"]);
    expect(await only("mentioned")).toEqual(["The calm", "Wreck"]);
  });

  it("scene story time needs manuscript edit rights; events need story-bible edit rights", async () => {
    const viewer: AuthorContext = { ...ctx, role: "VIEWER" };
    await expect(placeSceneInTime(viewer, s1, { afterId: null })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(
      createTimelineEvent(viewer, { ownerId: bookId, title: "x" }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    const scenesOnly = role("SCENES_ONLY", { manuscript: ["view", "edit"] });
    await placeSceneInTime(scenesOnly, s1, { afterId: null });
    await expect(
      createTimelineEvent(scenesOnly, { ownerId: bookId, title: "Wreck" }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    const bibleOnly = role("BIBLE_ONLY", { storyBible: ["view", "edit"] });
    await createTimelineEvent(bibleOnly, { ownerId: bookId, title: "Wreck" });
    await expect(placeSceneInTime(bibleOnly, s2, { afterId: null })).rejects.toBeInstanceOf(
      ForbiddenError,
    );

    // Another workspace can't find or place anything here.
    const other = await createAuthor("Sam");
    await expect(placeSceneInTime(other, s1, { afterId: null })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    const theirs = await createBook(other, { title: "Theirs" });
    const theirScene = (await createScene(other, (await createChapter(other, theirs.id)).id)).id;
    await expect(placeSceneInTime(ctx, s2, { afterId: theirScene })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("reads respect access", async () => {
    await placeSceneInTime(ctx, s1, { afterId: null });
    await createTimelineEvent(ctx, { ownerId: bookId, title: "Wreck" });
    const reader = role("MANUSCRIPT_READER", { storyBible: [] });
    // The scenes, not the story-bible events.
    expect(await storyOrder(bookId, reader)).toEqual(["The storm"]);
    const other = await createAuthor("Sam");
    await expect(getTimeline(other, bookId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(getSceneStoryTime(other, s1)).rejects.toBeInstanceOf(NotFoundError);
    await expect(listStoryTimeHistory(other, s1)).rejects.toBeInstanceOf(NotFoundError);
    expect(await listTimelines(other)).toEqual([]);
  });

  it("Trash hides without leaking; restore puts things back; delete forever reports", async () => {
    await placeSceneInTime(ctx, s1, { afterId: null });
    await placeSceneInTime(ctx, s2, { afterId: s1 });
    const wreck = await createTimelineEvent(ctx, { ownerId: bookId, title: "Wreck", afterId: s1 });
    await placeSceneInTime(ctx, s3, { afterId: wreck.id });
    await trashTimelineEvent(ctx, wreck.id);
    // Placed after a hidden event: shown after "an item that isn't shown".
    const [h] = await listStoryTimeHistory(ctx, s3);
    expect(h.after).toBeNull();
    expect(JSON.stringify(await listStoryTimeHistory(ctx, s3))).not.toContain("Wreck");

    // The calm was placed right after the wreck, which was before the letter.
    expect(await storyOrder()).toEqual(["The storm", "The calm", "The letter"]);
    await trashScene(ctx, s2);
    expect(await storyOrder()).toEqual(["The storm", "The calm"]);
    await restoreFromTrash(ctx, "SCENE", s2);
    expect(await storyOrder()).toEqual(["The storm", "The calm", "The letter"]);

    await trashScene(ctx, s2);
    const report = await previewDeleteForever(ctx, "SCENE", s2);
    expect(report.groups.find((g) => g.key === "STORY_TIME")?.count).toBe(1);
    await deleteForever(ctx, "SCENE", s2, report.token);
    expect(await storyOrder()).toEqual(["The storm", "The calm"]);

    // Deleting the book forever takes its events too, and says so.
    await trashBook(ctx, bookId);
    const bookReport = await previewDeleteForever(ctx, "BOOK", bookId);
    expect(
      bookReport.groups.find((g) => g.key === "TIMELINE_EVENT")?.items.map((i) => i.title),
    ).toEqual(["Wreck"]);
    await deleteForever(ctx, "BOOK", bookId, bookReport.token);
    expect(await db.timelineEvent.count()).toBe(0);
    expect(await db.sceneStoryTime.count()).toBe(0);
  });
});

describe("Story Time: backups", () => {
  it("exports format 5 and restores the same timeline; older files import without it", async () => {
    await placeSceneInTime(ctx, s2, { afterId: null, label: "Ten years earlier" });
    await placeSceneInTime(ctx, s1, { afterId: s2 });
    await createTimelineEvent(ctx, { ownerId: bookId, title: "Wreck", afterId: s2 });
    const { data } = await exportWorkspaceJson(ctx, { scope: { kind: "all" } });
    expect(data.version).toBe(5);
    const expected = await storyOrder();

    const v4 = { ...data, version: 4, timelineEvents: undefined, sceneStoryTimes: undefined };
    v4.storyNodes = data.storyNodes.filter((n) => n.kind !== "TIMELINE_EVENT");
    for (const [file, order] of [
      [data, expected],
      [v4, []],
    ] as const) {
      await resetDatabase();
      const other = await createAuthor("Jane");
      const upload = {
        sourceId: "authoros-json",
        filename: "b.json",
        bytes: new TextEncoder().encode(JSON.stringify(file)),
      };
      const review = await reviewImport(other, upload);
      expect(review.errors).toEqual([]);
      await runImport(other, upload, { token: review.token! });
      expect(await storyOrder(bookId, other)).toEqual(order);
      expect(await auditGraph(other)).toEqual([]);
    }
  });
});
