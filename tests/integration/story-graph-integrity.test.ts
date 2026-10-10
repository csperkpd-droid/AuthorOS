import { beforeEach, describe, expect, it } from "vitest";

import type { StoryNodeKind } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { createEvent, setDeadline, trashEvent } from "@/modules/calendar";
import { createCharacter, trashCharacter } from "@/modules/characters";
import { connect, listConnections } from "@/modules/connections";
import { exportWorkspaceJson } from "@/modules/exports";
import { applyIdentityMove, previewIdentityMove } from "@/modules/impact";
import { reviewImport, runImport } from "@/modules/imports";
import { createIdea, trashIdea } from "@/modules/ideas";
import { createBook, createSeries, trashBook, trashSeries } from "@/modules/library";
import {
  createChapter,
  createPart,
  createScene,
  trashChapter,
  trashPart,
  trashScene,
} from "@/modules/manuscript";
import { createNote, trashNote } from "@/modules/notes";
import { archivePenName, createPenName, restorePenName } from "@/modules/pen-names";
import { createRelationship, trashRelationship } from "@/modules/relationships";
import {
  auditGraph,
  resolveNode,
  searchNodes,
  STORY_KINDS,
  storyObjectType,
} from "@/modules/story-graph";
import {
  addBeat,
  assignScene,
  createOutline,
  deleteBeat,
  previewDeleteBeat,
  trashOutline,
} from "@/modules/structure";
import { createTask, trashTask } from "@/modules/tasks";
import { deleteForever, listTrash, previewDeleteForever, restoreFromTrash } from "@/modules/trash";
import { addParticipant } from "@/modules/participation";
import { createTimelineEvent, placeSceneInTime, trashTimelineEvent } from "@/modules/timeline";
import { addTrope, createTrope, trashTrope } from "@/modules/tropes";
import { setScenePlace } from "@/modules/setting";
import { createPlace, createWorldEntry, trashPlace, trashWorldEntry } from "@/modules/world";
import type { AuthorContext } from "@/server/context";

import { createAuthor, resetDatabase } from "../support/db";

/**
 * The Story Graph integrity audit: for every kind in the Story Object
 * Registry, what the registry says it supports actually works: found,
 * searched, connected, exported, imported, trashed and restored (or
 * archived), deleted with Change Impact, and the graph has no orphaned or
 * rule-breaking references afterwards. A new kind fails here until it
 * supports everything its registry entry claims.
 */

let ctx: AuthorContext;

beforeEach(async () => {
  await resetDatabase();
  ctx = await createAuthor("Jane");
});

type World = Record<StoryNodeKind, { id: string; title: string }>;

/** One object of every kind, in one identity (exhaustive by type). */
async function world(): Promise<World> {
  const pen = await createPenName(ctx, { name: "Rose Hart" });
  const series = await createSeries(ctx, { title: "Crown of Ash", penNameId: pen.id });
  const book = await createBook(ctx, { title: "Ember Road", seriesId: series.id });
  await setDeadline(ctx, book.id, "2027-03-01");
  const part = await createPart(ctx, book.id, "Part Kindling");
  const chapter = await createChapter(ctx, book.id, { partId: part.id, title: "Chapter Sparks" });
  const scene = await createScene(ctx, chapter.id, "Scene Harbour");
  const elara = await createCharacter(ctx, { name: "Elara Vane", seriesId: series.id });
  const kael = await createCharacter(ctx, { name: "Kael Orin", seriesId: series.id });
  await addParticipant(ctx, scene.id, { characterId: elara.id, pov: true });
  const couple = await createRelationship(ctx, {
    characterIds: [elara.id, kael.id],
    type: "Romance",
  });
  const outline = await createOutline(ctx, {
    bookId: book.id,
    kind: "PLOT",
    title: "Plot Lattice",
  });
  const beat = await addBeat(ctx, outline.id, { title: "Beat Turning point", targetPercent: null });
  await assignScene(ctx, beat.id, scene.id);
  const note = await createNote(ctx, { title: "Note Lighthouse" });
  const idea = await createIdea(ctx, { title: "Idea Tidewater" });
  const task = await createTask(ctx, { title: "Task Outline revisions" });
  const event = await createEvent(ctx, { title: "Event Writers retreat", startsOn: "2027-01-10" });
  const happening = await createTimelineEvent(ctx, { ownerId: series.id, title: "Shipwreck" });
  await placeSceneInTime(ctx, scene.id, { afterId: happening.id, label: "Day 1" });
  const trope = await createTrope(ctx, { name: "Trope Slowburn" });
  await addTrope(ctx, book.id, { tropeId: trope.id });
  const harbour = await createPlace(ctx, { name: "Place Saltmarsh", seriesId: series.id });
  await setScenePlace(ctx, scene.id, harbour.id);
  const guild = await createWorldEntry(ctx, {
    name: "Guild Lanternwrights",
    entryType: "Organization",
    seriesId: series.id,
  });
  return {
    PEN_NAME: { id: pen.id, title: "Rose Hart" },
    SERIES: { id: series.id, title: "Crown of Ash" },
    BOOK: { id: book.id, title: "Ember Road" },
    PART: { id: part.id, title: "Part Kindling" },
    CHAPTER: { id: chapter.id, title: "Chapter Sparks" },
    SCENE: { id: scene.id, title: "Scene Harbour" },
    CHARACTER: { id: elara.id, title: "Elara Vane" },
    RELATIONSHIP: { id: couple.id, title: "Elara Vane & Kael Orin" },
    OUTLINE: { id: outline.id, title: "Plot Lattice" },
    NOTE: { id: note.id, title: "Note Lighthouse" },
    IDEA: { id: idea.id, title: "Idea Tidewater" },
    TASK: { id: task.id, title: "Task Outline revisions" },
    EVENT: { id: event.id, title: "Event Writers retreat" },
    TIMELINE_EVENT: { id: happening.id, title: "Shipwreck" },
    TROPE: { id: trope.id, title: "Trope Slowburn" },
    BEAT: { id: beat.id, title: "Beat Turning point" },
    PLACE: { id: harbour.id, title: "Place Saltmarsh" },
    WORLD_ENTRY: { id: guild.id, title: "Guild Lanternwrights" },
  };
}

const TRASH: Record<StoryNodeKind, ((ctx: AuthorContext, id: string) => Promise<void>) | null> = {
  PEN_NAME: null, // archived, not trashed
  SERIES: trashSeries,
  BOOK: trashBook,
  PART: trashPart,
  CHAPTER: trashChapter,
  SCENE: trashScene,
  CHARACTER: trashCharacter,
  RELATIONSHIP: trashRelationship,
  OUTLINE: trashOutline,
  NOTE: trashNote,
  IDEA: trashIdea,
  TASK: trashTask,
  EVENT: trashEvent,
  TIMELINE_EVENT: trashTimelineEvent,
  TROPE: trashTrope,
  BEAT: null, // removed from its structure with Change Impact, never trashed
  PLACE: trashPlace,
  WORLD_ENTRY: trashWorldEntry,
};

describe("Story Graph integrity, for every kind in the registry", () => {
  it("each kind is found, searched, connected and exported; nothing is orphaned", async () => {
    const w = await world();
    for (const kind of STORY_KINDS) {
      const { id, title } = w[kind];
      const node = await resolveNode(ctx, id);
      expect(node?.kind, `${kind} found`).toBe(kind);
      const hits = await searchNodes(ctx, { query: title.split(" ")[0], kinds: [kind] });
      expect(
        hits.map((h) => h.id),
        `${kind} searched`,
      ).toContain(id);
      if (storyObjectType(kind).connectable) {
        // Notes can be about anything; a note itself is linked from an idea.
        const [sourceId, linkKind] =
          kind === "NOTE" ? [w.IDEA.id, "inspired"] : [w.NOTE.id, "about"];
        await connect(ctx, { sourceId, targetId: id, kind: linkKind });
        expect((await listConnections(ctx, id)).length, `${kind} connected`).toBeGreaterThan(0);
      }
    }
    const { data } = await exportWorkspaceJson(ctx, { scope: { kind: "all" } });
    for (const kind of STORY_KINDS) {
      const { bundle } = storyObjectType(kind);
      expect(data.storyNodes, `${kind} node exported`).toContainEqual({ id: w[kind].id, kind });
      expect(
        (data[bundle] as { id: string }[]).map((r) => r.id),
        `${kind} row exported`,
      ).toContain(w[kind].id);
    }
    expect(await auditGraph(ctx)).toEqual([]);
  });

  it("each kind is imported back with its id (restore into another installation)", async () => {
    const w = await world();
    const { data } = await exportWorkspaceJson(ctx, { scope: { kind: "all" }, kind: "archive" });
    await resetDatabase();
    const other = await createAuthor("Sam");
    const bytes = new TextEncoder().encode(JSON.stringify(data));
    const file = { sourceId: "authoros-json", filename: "backup.json", bytes };
    const review = await reviewImport(other, file);
    expect(review.conflicts).toEqual([]);
    await runImport(other, file, { token: review.token! });
    for (const kind of STORY_KINDS)
      expect((await resolveNode(other, w[kind].id))?.kind, `${kind} imported`).toBe(kind);
    expect(await auditGraph(other)).toEqual([]);
  });

  it("each kind is trashed and restored (or archived and restored)", async () => {
    const w = await world();
    for (const kind of STORY_KINDS) {
      const { id } = w[kind];
      const trash = TRASH[kind];
      if (storyObjectType(kind).lifecycle === "remove") {
        expect(trash).toBeNull();
        continue;
      }
      if (storyObjectType(kind).lifecycle === "archive") {
        expect(trash).toBeNull();
        await archivePenName(ctx, id);
        expect(await resolveNode(ctx, id), `${kind} archived stays findable`).not.toBeNull();
        await restorePenName(ctx, id);
        continue;
      }
      await trash!(ctx, id);
      expect(await resolveNode(ctx, id), `${kind} hidden when trashed`).toBeNull();
      expect(
        (await listTrash(ctx)).map((t) => t.id),
        `${kind} in the Trash`,
      ).toContain(id);
      await restoreFromTrash(ctx, kind, id);
      expect(await resolveNode(ctx, id), `${kind} restored`).not.toBeNull();
    }
    expect(await auditGraph(ctx)).toEqual([]);
  });

  it.each(STORY_KINDS.filter((k) => storyObjectType(k).lifecycle === "trash"))(
    "%s is deleted forever through Change Impact, leaving no orphans",
    async (kind) => {
      const w = await world();
      const { id } = w[kind];
      await TRASH[kind]!(ctx, id);
      const report = await previewDeleteForever(ctx, kind, id);
      expect(report.groups.find((g) => g.key === kind)?.items.map((i) => i.id)).toContain(id);
      await deleteForever(ctx, kind, id, report.token);
      expect(await db.storyNode.count({ where: { id } })).toBe(0);
      expect(await auditGraph(ctx)).toEqual([]);
    },
  );

  it("a beat (no Trash of its own) is removed through Change Impact, leaving no orphans", async () => {
    const w = await world();
    await connect(ctx, { sourceId: w.NOTE.id, targetId: w.BEAT.id, kind: "about" });
    const report = await previewDeleteBeat(ctx, w.BEAT.id);
    expect(report.groups.find((g) => g.key === "PLACEMENTS")?.count).toBe(1);
    expect(report.groups.find((g) => g.key === "LINKS")?.count).toBe(1);
    await deleteBeat(ctx, w.BEAT.id, report.token);
    expect(await db.storyNode.count({ where: { id: w.BEAT.id } })).toBe(0);
    expect(await db.beatAssignment.count({ where: { beatId: w.BEAT.id } })).toBe(0);
    expect(await resolveNode(ctx, w.SCENE.id)).not.toBeNull();
    expect(await resolveNode(ctx, w.NOTE.id)).not.toBeNull();
    expect(await auditGraph(ctx)).toEqual([]);
  });

  it("deleting a structure forever names its beats, which go with it", async () => {
    const w = await world();
    await trashOutline(ctx, w.OUTLINE.id);
    const report = await previewDeleteForever(ctx, "OUTLINE", w.OUTLINE.id);
    expect(report.groups.find((g) => g.key === "BEAT")?.items.map((i) => i.id)).toEqual([
      w.BEAT.id,
    ]);
    await deleteForever(ctx, "OUTLINE", w.OUTLINE.id, report.token);
    expect(await db.storyNode.count({ where: { id: w.BEAT.id } })).toBe(0);
    expect(await auditGraph(ctx)).toEqual([]);
  });

  it("moving a book's identity moves what belongs to it and keeps the graph consistent", async () => {
    const pen = await createPenName(ctx, { name: "Rose Hart" });
    const book = await createBook(ctx, { title: "Standalone" });
    const chapter = await createChapter(ctx, book.id);
    const scene = await createScene(ctx, chapter.id, "Opening");
    const mara = await createCharacter(ctx, { name: "Mara" });
    await addParticipant(ctx, scene.id, { characterId: mara.id });
    const move = { kind: "BOOK" as const, id: book.id, toPenNameId: pen.id };
    const report = await previewIdentityMove(ctx, move);
    await applyIdentityMove(ctx, move, report.token);
    expect((await resolveNode(ctx, mara.id))?.penNameId).toBe(pen.id);
    expect(await auditGraph(ctx)).toEqual([]);
  });

  it("the audit reports rule-breaking references", async () => {
    const w = await world();
    // Simulate drift the services prevent: a series beat planned outside the series.
    const other = await createBook(ctx, { title: "Elsewhere" });
    const arc = await createOutline(ctx, {
      seriesId: w.SERIES.id,
      kind: "ROMANCE",
      relationshipId: w.RELATIONSHIP.id,
      title: "Arc",
    });
    const beat = await db.beat.findFirst({ where: { outlineId: arc.id } });
    const beatId = beat?.id ?? (await addBeat(ctx, arc.id, { title: "b", targetPercent: null })).id;
    await db.beat.update({ where: { id: beatId }, data: { bookId: other.id } });
    expect((await auditGraph(ctx)).map((i) => i.check)).toEqual([
      "series beat planned for a book outside the series",
    ]);
  });

  it("every kind's table has its two story-node triggers", async () => {
    const triggers = await db.$queryRaw<{ tgname: string }[]>`
      SELECT tgname FROM pg_trigger WHERE NOT tgisinternal`;
    const names = new Set(triggers.map((t) => t.tgname));
    for (const kind of STORY_KINDS) {
      const { table } = storyObjectType(kind);
      expect(names, `${table}_node_kind`).toContain(`${table}_node_kind`);
      expect(names, `${table}_delete_node`).toContain(`${table}_delete_node`);
    }
  });
});
