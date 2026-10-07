import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { ConflictError, NotFoundError, RuleError } from "@/lib/errors";
import { createCharacter } from "@/modules/characters";
import { connect, listConnections } from "@/modules/connections";
import { createBook, createSeries } from "@/modules/library";
import { createChapter, createScene, trashScene } from "@/modules/manuscript";
import { createNote } from "@/modules/notes";
import { createPenName } from "@/modules/pen-names";
import { createRelationship } from "@/modules/relationships";
import {
  addBeat,
  assignScene,
  beatsForScene,
  createOutline,
  deleteBeat,
  getOutline,
  listOutlines,
  listTemplates,
  moveBeat,
  trashOutline,
  unassignScene,
  updateBeat,
} from "@/modules/structure";
import { deleteForever, listTrash, restoreFromTrash } from "@/modules/trash";
import type { AuthorContext } from "@/server/context";

import { createAuthor, resetDatabase } from "../support/db";

let ctx: AuthorContext;
let bookId: string;
let scenes: string[];
let mara: string;
let theo: string;
let romanceRel: string;

const SAVE_THE_CAT = "00000000-0000-7000-8000-000000000a02";
const ROMANCING = "00000000-0000-7000-8000-000000000a04";
const POSITIVE_ARC = "00000000-0000-7000-8000-000000000a05";

beforeEach(async () => {
  await resetDatabase();
  ctx = await createAuthor();
  bookId = (await createBook(ctx, { title: "Harbour Lights" })).id;
  const ch1 = await createChapter(ctx, bookId);
  const ch2 = await createChapter(ctx, bookId);
  scenes = [];
  for (const ch of [ch1, ch1, ch2, ch2]) scenes.push((await createScene(ctx, ch.id)).id);
  mara = (await createCharacter(ctx, { name: "Mara" })).id;
  theo = (await createCharacter(ctx, { name: "Theo" })).id;
  romanceRel = (
    await createRelationship(ctx, { characterId: mara, otherCharacterId: theo, type: "Romance" })
  ).id;
});

const beatId = async (outlineId: string, title: string) =>
  (await getOutline(ctx, outlineId)).beats.find((b) => b.title === title)!.id;

describe("templates", () => {
  it("offers the built-in beat sheets", async () => {
    const templates = await listTemplates(ctx);
    expect(templates.map((t) => [t.name, t.kind, t.beatCount])).toEqual(
      expect.arrayContaining([
        ["Save the Cat", "PLOT", 15],
        ["Three-Act Structure", "PLOT", 8],
        ["Hero's Journey", "PLOT", 12],
        ["Romancing the Beat", "ROMANCE", 18],
        ["Positive Change Arc", "CHARACTER_ARC", 12],
      ]),
    );
    expect((await listTemplates(ctx, { kind: "ROMANCE" })).every((t) => t.kind === "ROMANCE")).toBe(
      true,
    );
  });
});

describe("outlines", () => {
  it("applies a template to a book, copying its beats in order", async () => {
    const { id } = await createOutline(ctx, { bookId, kind: "PLOT", templateId: SAVE_THE_CAT });
    const outline = await getOutline(ctx, id);
    expect(outline.title).toBe("Save the Cat");
    expect(outline.beats.map((b) => b.title).slice(0, 4)).toEqual([
      "Opening Image",
      "Theme Stated",
      "Setup",
      "Catalyst",
    ]);
    expect(outline.beats).toHaveLength(15);
    expect(outline.bookScenes).toHaveLength(4);
  });

  it("makes romance arcs belong to a relationship and character arcs to a character", async () => {
    await expect(
      createOutline(ctx, { bookId, kind: "ROMANCE", templateId: ROMANCING }),
    ).rejects.toBeInstanceOf(RuleError);
    const romance = await createOutline(ctx, {
      bookId,
      kind: "ROMANCE",
      templateId: ROMANCING,
      relationshipId: romanceRel,
    });
    expect((await getOutline(ctx, romance.id)).title).toBe("Mara & Theo: Romancing the Beat");

    const arc = await createOutline(ctx, {
      bookId,
      kind: "CHARACTER_ARC",
      templateId: POSITIVE_ARC,
      characterId: mara,
    });
    expect((await getOutline(ctx, arc.id)).character?.name).toBe("Mara");

    expect((await listOutlines(ctx, { relationshipId: romanceRel })).map((o) => o.id)).toEqual([
      romance.id,
    ]);
    expect((await listOutlines(ctx, { characterId: mara })).map((o) => o.id)).toEqual([arc.id]);

    // The database enforces the owner rule too.
    const node = await db.storyNode.create({
      data: { workspaceId: ctx.workspaceId, kind: "OUTLINE" },
    });
    await expect(
      db.outline.create({
        data: { id: node.id, workspaceId: ctx.workspaceId, bookId, kind: "ROMANCE", title: "x" },
      }),
    ).rejects.toThrow(/outlines_owner_matches_kind/);
  });

  it("refuses owners from another pen name or series", async () => {
    const other = await createPenName(ctx, { name: "Other" });
    const otherBook = await createBook(ctx, { title: "Other book", penNameId: other.id });
    await expect(
      createOutline(ctx, { bookId: otherBook.id, kind: "ROMANCE", relationshipId: romanceRel }),
    ).rejects.toBeInstanceOf(RuleError);

    const series = await createSeries(ctx, { title: "Saga" });
    const seriesChar = await createCharacter(ctx, { name: "Saga hero", seriesId: series.id });
    await expect(
      createOutline(ctx, { bookId, kind: "CHARACTER_ARC", characterId: seriesChar.id }),
    ).rejects.toBeInstanceOf(RuleError);
  });

  it("supports custom structures with the author's own beats", async () => {
    const { id } = await createOutline(ctx, {
      bookId,
      kind: "SUBPLOT",
      title: "The smuggling subplot",
    });
    const first = await addBeat(ctx, id, { title: "Crates found", targetPercent: "" });
    const second = await addBeat(ctx, id, { title: "The chase", targetPercent: 60 });
    await addBeat(ctx, id, { title: "Arrests", targetPercent: 90 });
    await moveBeat(ctx, second.id, null);
    await updateBeat(ctx, first.id, {
      title: "Crates found",
      description: "Under the pier",
      targetPercent: 30,
    });
    await expect(updateBeat(ctx, first.id, { title: "x", targetPercent: 120 })).rejects.toThrow();

    const outline = await getOutline(ctx, id);
    expect(outline.beats.map((b) => `${b.title}:${b.targetPercent}`)).toEqual([
      "The chase:60",
      "Crates found:30",
      "Arrests:90",
    ]);
    await deleteBeat(ctx, second.id);
    expect((await getOutline(ctx, id)).beats).toHaveLength(2);
  });
});

describe("beat → scene placements", () => {
  it("lets one scene carry beats of many structures without copying it", async () => {
    const plot = await createOutline(ctx, { bookId, kind: "PLOT", templateId: SAVE_THE_CAT });
    const romance = await createOutline(ctx, {
      bookId,
      kind: "ROMANCE",
      templateId: ROMANCING,
      relationshipId: romanceRel,
    });
    const arc = await createOutline(ctx, {
      bookId,
      kind: "CHARACTER_ARC",
      templateId: POSITIVE_ARC,
      characterId: mara,
    });
    const sceneCount = await db.scene.count();

    await assignScene(ctx, await beatId(plot.id, "Catalyst"), scenes[1]);
    await assignScene(ctx, await beatId(romance.id, "Meet"), scenes[1]);
    await assignScene(ctx, await beatId(arc.id, "Inciting Event"), scenes[1]);

    const beats = await beatsForScene(ctx, scenes[1]);
    expect(beats.map((b) => `${b.kind}:${b.beatTitle}`).sort()).toEqual([
      "CHARACTER_ARC:Inciting Event",
      "PLOT:Catalyst",
      "ROMANCE:Meet",
    ]);
    expect(await db.scene.count()).toBe(sceneCount);
  });

  it("lets one beat span several scenes, listed in reading order with their place in the book", async () => {
    const plot = await createOutline(ctx, { bookId, kind: "PLOT", templateId: SAVE_THE_CAT });
    const funAndGames = await beatId(plot.id, "Fun and Games");
    await assignScene(ctx, funAndGames, scenes[3]);
    await assignScene(ctx, funAndGames, scenes[1]);
    await expect(assignScene(ctx, funAndGames, scenes[1])).rejects.toBeInstanceOf(ConflictError);

    const beat = (await getOutline(ctx, plot.id)).beats.find((b) => b.id === funAndGames)!;
    expect(beat.scenes.map((s) => [s.id, s.percent])).toEqual([
      [scenes[1], 38],
      [scenes[3], 88],
    ]);
    expect((await listOutlines(ctx, { bookId }))[0]).toMatchObject({
      beatCount: 15,
      placedCount: 1,
    });

    await unassignScene(ctx, funAndGames, scenes[1]);
    expect(
      (await getOutline(ctx, plot.id)).beats.find((b) => b.id === funAndGames)!.scenes,
    ).toHaveLength(1);
  });

  it("only places beats in scenes of the structure's own book", async () => {
    const plot = await createOutline(ctx, { bookId, kind: "PLOT", templateId: SAVE_THE_CAT });
    const otherBook = await createBook(ctx, { title: "Other" });
    const otherScene = await createScene(ctx, (await createChapter(ctx, otherBook.id)).id);
    await expect(
      assignScene(ctx, await beatId(plot.id, "Catalyst"), otherScene.id),
    ).rejects.toBeInstanceOf(RuleError);
  });

  it("hides placements of trashed scenes and brings them back", async () => {
    const plot = await createOutline(ctx, { bookId, kind: "PLOT", templateId: SAVE_THE_CAT });
    const catalyst = await beatId(plot.id, "Catalyst");
    await assignScene(ctx, catalyst, scenes[0]);
    await trashScene(ctx, scenes[0]);
    expect((await getOutline(ctx, plot.id)).beats.find((b) => b.id === catalyst)!.scenes).toEqual(
      [],
    );
    expect((await listOutlines(ctx, { bookId }))[0].placedCount).toBe(0);
    await restoreFromTrash(ctx, "SCENE", scenes[0]);
    expect(
      (await getOutline(ctx, plot.id)).beats.find((b) => b.id === catalyst)!.scenes,
    ).toHaveLength(1);
  });
});

describe("structures as story objects", () => {
  it("can be the subject of notes and other connections", async () => {
    const romance = await createOutline(ctx, {
      bookId,
      kind: "ROMANCE",
      relationshipId: romanceRel,
    });
    const note = await createNote(ctx, { title: "Arc thoughts", aboutId: romance.id });
    expect((await listConnections(ctx, romance.id)).map((c) => c.other.id)).toEqual([note.id]);
    await connect(ctx, { sourceId: romance.id, targetId: scenes[2], kind: "related" });
  });

  it("goes to the Trash, comes back, and deletes forever with its beats and placements", async () => {
    const plot = await createOutline(ctx, { bookId, kind: "PLOT", templateId: SAVE_THE_CAT });
    await assignScene(ctx, await beatId(plot.id, "Catalyst"), scenes[0]);
    await trashOutline(ctx, plot.id);
    await expect(getOutline(ctx, plot.id)).rejects.toBeInstanceOf(NotFoundError);
    expect(await beatsForScene(ctx, scenes[0])).toEqual([]);
    expect((await listTrash(ctx)).map((t) => [t.kind, t.context])).toEqual([
      ["OUTLINE", "Harbour Lights"],
    ]);

    await restoreFromTrash(ctx, "OUTLINE", plot.id);
    expect(await beatsForScene(ctx, scenes[0])).toHaveLength(1);

    await trashOutline(ctx, plot.id);
    await deleteForever(ctx, "OUTLINE", plot.id);
    expect(await db.beat.count()).toBe(0);
    expect(await db.beatAssignment.count()).toBe(0);
    expect(await db.storyNode.count({ where: { id: plot.id } })).toBe(0);
    expect(await db.scene.count({ where: { id: scenes[0] } })).toBe(1);
  });

  it("isolates workspaces", async () => {
    const plot = await createOutline(ctx, { bookId, kind: "PLOT", templateId: SAVE_THE_CAT });
    const stranger = await createAuthor("Stranger");
    await expect(getOutline(stranger, plot.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(createOutline(stranger, { bookId, kind: "PLOT" })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    const catalyst = await beatId(plot.id, "Catalyst");
    await expect(assignScene(stranger, catalyst, scenes[0])).rejects.toBeInstanceOf(NotFoundError);
  });
});
