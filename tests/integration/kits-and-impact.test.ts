import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { ConflictError, NotFoundError, RuleError } from "@/lib/errors";
import { createCharacter, trashCharacter } from "@/modules/characters";
import {
  createFieldDefinition,
  deleteFieldDefinition,
  previewDeleteField,
  setFieldValue,
} from "@/modules/fields";
import { saveContent } from "@/modules/history";
import { createBook, createSeries, trashBook } from "@/modules/library";
import { createChapter, createScene } from "@/modules/manuscript";
import { createNote } from "@/modules/notes";
import { createRelationship } from "@/modules/relationships";
import { addParticipant } from "@/modules/participation";
import {
  applyKit,
  assignScene,
  addBeat,
  createKit,
  createOutline,
  deleteKit,
  deleteTemplate,
  getKit,
  getOutline,
  listKits,
  listOutlines,
  previewDeleteTemplate,
  saveAsTemplate,
  saveStructuresAsKit,
  updateKit,
} from "@/modules/structure";
import {
  deleteForever,
  emptyTrash,
  listTrash,
  previewDeleteForever,
  previewEmptyTrash,
} from "@/modules/trash";
import type { AuthorContext } from "@/server/context";

import { createAuthor, resetDatabase } from "../support/db";

let ctx: AuthorContext;

const SAVE_THE_CAT = "00000000-0000-7000-8000-000000000a02";
const ROMANCING = "00000000-0000-7000-8000-000000000a04";
const POSITIVE_ARC = "00000000-0000-7000-8000-000000000a05";

const doc = (text: string) => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

beforeEach(async () => {
  await resetDatabase();
  ctx = await createAuthor();
});

describe("template kits", () => {
  it("apply several templates at once, asking which relationships and characters", async () => {
    const book = await createBook(ctx, { title: "Ember" });
    const [elara, kael, rowan] = await Promise.all(
      ["Elara", "Kael", "Rowan"].map(async (name) => (await createCharacter(ctx, { name })).id),
    );
    const group = await createRelationship(ctx, {
      characterIds: [elara, kael, rowan],
      type: "Romance",
    });
    const pair = await createRelationship(ctx, { characterIds: [elara, kael], type: "Romance" });

    const kit = await createKit(ctx, {
      name: "My Romantasy Book Kit",
      templateIds: [SAVE_THE_CAT, ROMANCING, POSITIVE_ARC],
    });
    const full = await getKit(ctx, kit.id);
    const [plot, romance, arc] = full.items;
    expect([plot, romance, arc].map((i) => i.template.kind)).toEqual([
      "PLOT",
      "ROMANCE",
      "CHARACTER_ARC",
    ]);

    const result = await applyKit(ctx, {
      kitId: kit.id,
      bookId: book.id,
      owners: {
        // One romance arc for the group, one for the pair within it.
        [romance.id]: { relationshipIds: [group.id, pair.id] },
        [arc.id]: { characterIds: [] }, // skipped
      },
    });
    expect(result.created).toHaveLength(3);
    expect(result.skipped).toEqual([arc.id]);
    const titles = (await listOutlines(ctx, { bookId: book.id })).map((o) => o.title).sort();
    expect(titles).toEqual([
      "Elara & Kael: Romancing the Beat",
      "Elara, Kael & Rowan: Romancing the Beat",
      "Save the Cat",
    ]);
  });

  it("are all or nothing, and never share live records", async () => {
    const book = await createBook(ctx, { title: "Ember" });
    const other = await createBook(ctx, { title: "Elsewhere" });
    const hero = (await createCharacter(ctx, { name: "Hero" })).id;
    const kit = await createKit(ctx, { name: "Kit", templateIds: [SAVE_THE_CAT, POSITIVE_ARC] });
    const arcItem = (await getKit(ctx, kit.id)).items[1];
    // A bad owner fails the whole kit: nothing is created.
    await expect(
      applyKit(ctx, {
        kitId: kit.id,
        bookId: book.id,
        owners: { [arcItem.id]: { characterIds: [crypto.randomUUID()] } },
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(await listOutlines(ctx, { bookId: book.id })).toEqual([]);

    const first = await applyKit(ctx, {
      kitId: kit.id,
      bookId: book.id,
      owners: { [arcItem.id]: { characterIds: [hero] } },
    });
    const second = await applyKit(ctx, {
      kitId: kit.id,
      bookId: other.id,
      owners: { [arcItem.id]: { characterIds: [hero] } },
    });
    const a = await getOutline(ctx, first.created[0]);
    const b = await getOutline(ctx, second.created[0]);
    expect(a.beats.map((x) => x.title)).toEqual(b.beats.map((x) => x.title));
    expect(new Set([...a.beats, ...b.beats].map((x) => x.id)).size).toBe(a.beats.length * 2);
  });

  it("can be saved from a book's structures, edited and deleted (templates stay)", async () => {
    const book = await createBook(ctx, { title: "Ember" });
    await createOutline(ctx, { bookId: book.id, kind: "PLOT", templateId: SAVE_THE_CAT });
    const custom = await createOutline(ctx, {
      bookId: book.id,
      kind: "CUSTOM",
      title: "Worldbuilding",
    });
    await addBeat(ctx, custom.id, { title: "Magic system", targetPercent: null });

    const kit = await saveStructuresAsKit(ctx, { bookId: book.id, name: "Romantasy" });
    const saved = await getKit(ctx, kit.id);
    expect(saved.items.map((i) => [i.template.name, i.template._count.beats])).toEqual([
      ["Romantasy: Save the Cat", 15],
      ["Romantasy: Worldbuilding", 1],
    ]);
    await updateKit(ctx, kit.id, {
      name: "Romantasy v2",
      templateIds: [saved.items[1].template.id],
    });
    expect((await listKits(ctx)).map((k) => [k.name, k.items.length])).toEqual([
      ["Romantasy v2", 1],
    ]);
    await deleteKit(ctx, kit.id);
    expect(await db.structureTemplate.count({ where: { workspaceId: ctx.workspaceId } })).toBe(2);
    await expect(
      saveStructuresAsKit(ctx, {
        bookId: (await createBook(ctx, { title: "Empty" })).id,
        name: "x",
      }),
    ).rejects.toBeInstanceOf(RuleError);
  });
});

describe("Change Impact before deleting", () => {
  it("deleting a template lists where it's used; its structures keep their beats", async () => {
    const book = await createBook(ctx, { title: "Ember" });
    const source = await createOutline(ctx, {
      bookId: book.id,
      kind: "PLOT",
      templateId: SAVE_THE_CAT,
    });
    const template = await saveAsTemplate(ctx, source.id, { name: "Mine" });
    const made = await createOutline(ctx, {
      bookId: book.id,
      kind: "PLOT",
      templateId: template.id,
    });
    await createKit(ctx, { name: "Kit", templateIds: [template.id, SAVE_THE_CAT] });

    const report = await previewDeleteTemplate(ctx, template.id);
    expect(report.summary).toBe("This will affect 1 item: 1 kit.");
    expect(report.groups.find((g) => g.key === "MADE")?.items.map((i) => i.id)).toEqual([made.id]);

    await createKit(ctx, { name: "Another", templateIds: [template.id] });
    await expect(deleteTemplate(ctx, template.id, report.token)).rejects.toBeInstanceOf(
      ConflictError,
    );
    await deleteTemplate(ctx, template.id, (await previewDeleteTemplate(ctx, template.id)).token);
    expect((await getOutline(ctx, made.id)).beats).toHaveLength(15);
    expect((await listKits(ctx)).map((k) => [k.name, k.items.length])).toEqual([
      ["Another", 0],
      ["Kit", 1],
    ]);
  });

  it("deleting a field in use lists the items, how many, and the values lost", async () => {
    const mara = await createCharacter(ctx, { name: "Mara" });
    const theo = await createCharacter(ctx, { name: "Theo" });
    const field = await createFieldDefinition(ctx, {
      nodeKind: "CHARACTER",
      label: "Love language",
    });
    await setFieldValue(ctx, mara.id, field.id, "Acts of service");
    await setFieldValue(ctx, theo.id, field.id, "Quality time");

    const report = await previewDeleteField(ctx, field.id);
    expect(report.summary).toBe("This will affect 2 items: 2 values.");
    expect(report.groups[0].items.map((i) => [i.title, i.note])).toEqual([
      ["Mara", "“Acts of service”"],
      ["Theo", "“Quality time”"],
    ]);
    await deleteFieldDefinition(ctx, field.id, report.token);
    expect(await db.nodeFieldValue.count()).toBe(0);
  });

  it("deleting forever reports everything inside, dependent and linked", async () => {
    const series = await createSeries(ctx, { title: "Crown" });
    const book = await createBook(ctx, { title: "Ember", seriesId: series.id });
    const chapter = await createChapter(ctx, book.id);
    const scene = await createScene(ctx, chapter.id);
    await saveContent(ctx, { nodeId: scene.id, content: doc("one"), baseVersion: 0 });
    await saveContent(ctx, { nodeId: scene.id, content: doc("one two"), baseVersion: 1 });
    const hero = await createCharacter(ctx, { name: "Hero", seriesId: series.id });
    await addParticipant(ctx, scene.id, { characterId: hero.id });
    const note = await createNote(ctx, { title: "Research", aboutId: scene.id });
    const arc = await createOutline(ctx, {
      seriesId: series.id,
      kind: "PLOT",
      templateId: SAVE_THE_CAT,
    });
    const beat = (await getOutline(ctx, arc.id)).beats[0];
    await assignScene(ctx, beat.id, scene.id);
    await createFieldDefinition(ctx, {
      nodeKind: "CHARACTER",
      label: "House",
      seriesId: series.id,
    });

    const { trashSeries } = await import("@/modules/library");
    await trashSeries(ctx, series.id);
    const report = await previewDeleteForever(ctx, "SERIES", series.id);
    const counts = Object.fromEntries(report.groups.map((g) => [g.key, g.count]));
    expect(counts).toMatchObject({
      SERIES: 1,
      BOOK: 1,
      CHAPTER: 1,
      SCENE: 1,
      OUTLINE: 1,
      PLACEMENTS: 1,
      FIELDS: 1,
      APPEARANCES: 1, // Hero was in the scene; Hero stays
      LINKS: 1, // the note stays
      KEPT_CHARACTERS: 1,
    });
    expect(report.summary).toMatch(
      /^This will affect \d+ items: 1 series, 1 book, 1 chapter, 1 scene, 1 structure/,
    );
    expect(report.groups.find((g) => g.key === "LINKS")?.items.map((i) => i.title)).toEqual([
      "Research",
    ]);
    expect(report.groups.find((g) => g.key === "APPEARANCES")?.items.map((i) => i.title)).toEqual([
      "Hero",
    ]);
    expect(report.groups.find((g) => g.key === "KEPT_CHARACTERS")?.affected).toBe(false);

    await deleteForever(ctx, "SERIES", series.id, report.token);
    expect(await db.scene.count()).toBe(0);
    expect(await db.note.count({ where: { id: note.id } })).toBe(1);
    expect((await db.character.findUniqueOrThrow({ where: { id: hero.id } })).seriesId).toBeNull();
  });

  it("deleting a character forever reports the relationships and arcs it ends", async () => {
    const [a, b, c] = await Promise.all(
      ["A", "B", "C"].map(async (name) => (await createCharacter(ctx, { name })).id),
    );
    const book = await createBook(ctx, { title: "Book" });
    const group = await createRelationship(ctx, { characterIds: [a, b, c], type: "Romance" });
    await createRelationship(ctx, { characterIds: [b, c], type: "Rivals" });
    await createOutline(ctx, { bookId: book.id, kind: "ROMANCE", relationshipId: group.id });
    await trashCharacter(ctx, a);
    const report = await previewDeleteForever(ctx, "CHARACTER", a);
    expect(report.groups.find((g) => g.key === "RELATIONSHIP")?.items.map((i) => i.title)).toEqual([
      "A, B & C",
    ]);
    expect(report.groups.find((g) => g.key === "OUTLINE")?.count).toBe(1);
  });

  it("emptying the Trash reports the total, and refuses a stale review", async () => {
    const book = await createBook(ctx, { title: "Gone" });
    await createChapter(ctx, book.id);
    await trashBook(ctx, book.id);
    const report = await previewEmptyTrash(ctx);
    expect(report.summary).toBe("This will affect 2 items: 1 book, 1 chapter.");
    const other = await createBook(ctx, { title: "Also gone" });
    await trashBook(ctx, other.id);
    await expect(emptyTrash(ctx, report.token)).rejects.toBeInstanceOf(ConflictError);
    expect(await emptyTrash(ctx, (await previewEmptyTrash(ctx)).token)).toBe(2);
    expect(await listTrash(ctx)).toEqual([]);
  });
});
