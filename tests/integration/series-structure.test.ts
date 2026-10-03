import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { NotFoundError, RuleError } from "@/lib/errors";
import { createCharacter } from "@/modules/characters";
import { createBook, createSeries } from "@/modules/library";
import { createChapter, createScene } from "@/modules/manuscript";
import { createRelationship } from "@/modules/relationships";
import {
  addBeat,
  assignScene,
  createOutline,
  deleteTemplate,
  getOutline,
  listOutlines,
  listTemplates,
  renameTemplate,
  saveAsTemplate,
  seriesRomance,
  setArcRole,
  updateBeat,
} from "@/modules/structure";
import type { AuthorContext } from "@/server/context";

import { createAuthor, resetDatabase } from "../support/db";

let ctx: AuthorContext;
let seriesId: string;
let books: string[];
/** One scene per book, in series order. */
let scenes: string[];
let kaelElara: string;

const ROMANCING = "00000000-0000-7000-8000-000000000a04";

beforeEach(async () => {
  await resetDatabase();
  ctx = await createAuthor();
  seriesId = (await createSeries(ctx, { title: "Crown of Ash" })).id;
  books = [];
  scenes = [];
  for (const title of ["Ember", "Flame", "Ash"]) {
    const book = await createBook(ctx, { title, seriesId });
    books.push(book.id);
    const chapter = await createChapter(ctx, book.id);
    scenes.push((await createScene(ctx, chapter.id, `${title} opening`)).id);
  }
  const kael = await createCharacter(ctx, { name: "Kael", seriesId });
  const elara = await createCharacter(ctx, { name: "Elara", seriesId });
  kaelElara = (
    await createRelationship(ctx, {
      characterId: kael.id,
      otherCharacterId: elara.id,
      type: "Romance",
    })
  ).id;
});

async function seriesArc() {
  const arc = await createOutline(ctx, {
    seriesId,
    kind: "ROMANCE",
    relationshipId: kaelElara,
    title: "Kael + Elara",
  });
  const plan: [string, number][] = [
    ["Meet", 0],
    ["Trust", 0],
    ["First Kiss", 1],
    ["Separation", 2],
    ["HEA", 2],
  ];
  const beats: Record<string, string> = {};
  for (const [title, book] of plan) {
    beats[title] = (
      await addBeat(ctx, arc.id, { title, targetPercent: null, bookId: books[book] })
    ).id;
  }
  return { arc, beats };
}

describe("series structures", () => {
  it("span the series: beats planned per book, placed in scenes of different books", async () => {
    const { arc, beats } = await seriesArc();
    await assignScene(ctx, beats.Meet, scenes[0]);
    await assignScene(ctx, beats["First Kiss"], scenes[1]);
    // A beat may span books.
    await assignScene(ctx, beats.Separation, scenes[1]);
    await assignScene(ctx, beats.Separation, scenes[2]);

    const outline = await getOutline(ctx, arc.id);
    expect(outline.series?.title).toBe("Crown of Ash");
    expect(outline.books.map((b) => [b.title, b.number])).toEqual([
      ["Ember", 1],
      ["Flame", 2],
      ["Ash", 3],
    ]);
    expect(outline.bookScenes.map((s) => s.bookTitle)).toEqual(["Ember", "Flame", "Ash"]);
    const separation = outline.beats.find((b) => b.title === "Separation")!;
    expect(separation.bookId).toBe(books[2]);
    expect(separation.scenes.map((s) => [s.bookNumber, s.title, s.percent])).toEqual([
      [2, "Flame opening", 50],
      [3, "Ash opening", 50],
    ]);
  });

  it("only use scenes and books of their own series", async () => {
    const { arc, beats } = await seriesArc();
    const loose = await createBook(ctx, { title: "Standalone" });
    const looseScene = (await createScene(ctx, (await createChapter(ctx, loose.id)).id)).id;
    await expect(assignScene(ctx, beats.Meet, looseScene)).rejects.toThrow(/this series’ books/);
    await expect(
      addBeat(ctx, arc.id, { title: "Elsewhere", targetPercent: null, bookId: loose.id }),
    ).rejects.toBeInstanceOf(RuleError);
    await updateBeat(ctx, beats.Meet, { title: "Meet", targetPercent: 2, bookId: books[1] });
    expect((await getOutline(ctx, arc.id)).beats[0].bookId).toBe(books[1]);

    // Book structures can't plan beats per book.
    const bookArc = await createOutline(ctx, { bookId: books[0], kind: "PLOT" });
    await expect(
      addBeat(ctx, bookArc.id, { title: "x", targetPercent: null, bookId: books[0] }),
    ).rejects.toBeInstanceOf(RuleError);
  });

  it("show on every book of the series alongside the book's own structures", async () => {
    const { arc } = await seriesArc();
    const own = await createOutline(ctx, { bookId: books[1], kind: "PLOT" });
    const forBook2 = await listOutlines(ctx, { bookId: books[1] });
    expect(forBook2.map((o) => o.id).sort()).toEqual([arc.id, own.id].sort());
    const forSeries = await listOutlines(ctx, { seriesId });
    expect(forSeries.map((o) => o.id).sort()).toEqual([arc.id, own.id].sort());
    expect(forSeries.find((o) => o.id === arc.id)?.series?.title).toBe("Crown of Ash");
  });

  it("refuse a book and a series at once, or neither", async () => {
    await expect(
      createOutline(ctx, { bookId: books[0], seriesId, kind: "PLOT" }),
    ).rejects.toThrow();
    await expect(createOutline(ctx, { kind: "PLOT" })).rejects.toThrow();
    // The database enforces it too.
    const { arc } = await seriesArc();
    await expect(
      db.outline.update({ where: { id: arc.id }, data: { bookId: books[0] } }),
    ).rejects.toThrow(/outlines_book_or_series/);
  });
});

describe("Series Romance Center", () => {
  it("shows each relationship's progression across the series' books", async () => {
    const { arc, beats } = await seriesArc();
    await assignScene(ctx, beats.Meet, scenes[0]);
    await assignScene(ctx, beats.Separation, scenes[1]); // happens earlier than planned

    // A secondary couple with a book-only arc in book 2.
    const finn = await createCharacter(ctx, { name: "Finn", seriesId });
    const ivy = await createCharacter(ctx, { name: "Ivy", seriesId });
    const finnIvy = await createRelationship(ctx, {
      characterId: finn.id,
      otherCharacterId: ivy.id,
      type: "Romance",
    });
    const side = await createOutline(ctx, {
      bookId: books[1],
      kind: "ROMANCE",
      relationshipId: finnIvy.id,
      arcRole: "SECONDARY",
    });
    await addBeat(ctx, side.id, { title: "Banter", targetPercent: null });

    const center = await seriesRomance(ctx, seriesId);
    expect(center.books.map((b) => b.title)).toEqual(["Ember", "Flame", "Ash"]);
    expect(center.relationships.map((r) => [r.relationship.title, r.arcRole])).toEqual([
      [expect.any(String), "MAIN"],
      [expect.any(String), "SECONDARY"],
    ]);
    const main = center.relationships[0];
    expect(main.arcs.map((a) => [a.id, a.seriesWide])).toEqual([[arc.id, true]]);
    const cells = main.books.map((b) => b.beats.map((c) => `${c.title}${c.placed ? "✓" : ""}`));
    expect(cells).toEqual([["Meet✓", "Trust"], ["First Kiss", "Separation✓"], ["HEA"]]);
    expect(center.relationships[1].books[1].beats.map((c) => c.title)).toEqual(["Banter"]);

    await setArcRole(ctx, side.id, "MAIN");
    expect((await seriesRomance(ctx, seriesId)).relationships.map((r) => r.arcRole)).toEqual([
      "MAIN",
      "MAIN",
    ]);
  });
});

describe("saving structures as templates", () => {
  it("copies beats, keeping each beat's book number for series templates", async () => {
    const { arc } = await seriesArc();
    const template = await saveAsTemplate(ctx, arc.id, { name: "My Romantasy Arc" });
    const listed = (await listTemplates(ctx)).find((t) => t.id === template.id)!;
    expect(listed).toMatchObject({
      builtIn: false,
      forSeries: true,
      kind: "ROMANCE",
      beatCount: 5,
    });

    // Applied to another series: brand-new structure, beats planned to its books.
    const other = (await createSeries(ctx, { title: "Second Saga" })).id;
    const o1 = await createBook(ctx, { title: "One", seriesId: other });
    const o2 = await createBook(ctx, { title: "Two", seriesId: other });
    const a = await createCharacter(ctx, { name: "A", seriesId: other });
    const b = await createCharacter(ctx, { name: "B", seriesId: other });
    const rel = await createRelationship(ctx, {
      characterId: a.id,
      otherCharacterId: b.id,
      type: "Romance",
    });
    const copy = await createOutline(ctx, {
      seriesId: other,
      kind: "ROMANCE",
      relationshipId: rel.id,
      templateId: template.id,
    });
    const copied = await getOutline(ctx, copy.id);
    expect(copied.title).toBe("A & B: My Romantasy Arc");
    expect(copied.beats.map((x) => [x.title, x.bookId])).toEqual([
      ["Meet", o1.id],
      ["Trust", o1.id],
      ["First Kiss", o2.id],
      // The template has a third book; this series has two.
      ["Separation", null],
      ["HEA", null],
    ]);

    // Nothing is shared: editing the copy changes neither the template nor the original.
    await updateBeat(ctx, copied.beats[0].id, { title: "Meet-cute", targetPercent: null });
    const beatsOfTemplate = await db.templateBeat.findMany({ where: { templateId: template.id } });
    expect(beatsOfTemplate.map((x) => x.title)).toContain("Meet");
    expect((await getOutline(ctx, arc.id)).beats[0].title).toBe("Meet");
  });

  it("applies a book template to a book; templates can be renamed and deleted, built-ins not", async () => {
    const plot = await createOutline(ctx, {
      bookId: books[0],
      kind: "ROMANCE",
      relationshipId: kaelElara,
      templateId: ROMANCING,
    });
    const t = await saveAsTemplate(ctx, plot.id, { name: "Mine", description: "Tweaked" });
    expect((await listTemplates(ctx)).find((x) => x.id === t.id)?.forSeries).toBe(false);
    const applied = await createOutline(ctx, {
      bookId: books[1],
      kind: "ROMANCE",
      relationshipId: kaelElara,
      templateId: t.id,
    });
    expect((await getOutline(ctx, applied.id)).beats).toHaveLength(18);

    await renameTemplate(ctx, t.id, { name: "Mine, renamed" });
    await expect(renameTemplate(ctx, ROMANCING, { name: "Hijack" })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(deleteTemplate(ctx, ROMANCING)).rejects.toBeInstanceOf(NotFoundError);
    await deleteTemplate(ctx, t.id);
    // Structures made from it keep their beats.
    const after = await getOutline(ctx, applied.id);
    expect(after.beats).toHaveLength(18);
    expect(after.template).toBeNull();
  });

  it("keeps templates private to their workspace", async () => {
    const { arc } = await seriesArc();
    const t = await saveAsTemplate(ctx, arc.id, { name: "Secret" });
    const stranger = await createAuthor("Stranger");
    expect((await listTemplates(stranger)).some((x) => x.id === t.id)).toBe(false);
    const theirBook = await createBook(stranger, { title: "Theirs" });
    await expect(
      createOutline(stranger, { bookId: theirBook.id, kind: "CUSTOM", templateId: t.id }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
