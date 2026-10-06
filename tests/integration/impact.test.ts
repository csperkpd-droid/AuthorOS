import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { ConflictError, RuleError } from "@/lib/errors";
import { createCharacter, getCharacter } from "@/modules/characters";
import { createFieldDefinition, getFieldValues, setFieldValue } from "@/modules/fields";
import { applyIdentityMove, previewIdentityMove, type IdentityMove } from "@/modules/impact";
import { createBook, createSeries, getBook, getSeries } from "@/modules/library";
import { createChapter, createScene } from "@/modules/manuscript";
import { createNote } from "@/modules/notes";
import { createPenName, getDefaultPenName } from "@/modules/pen-names";
import { createRelationship } from "@/modules/relationships";
import { createOutline } from "@/modules/structure";
import { addParticipant } from "@/modules/participation";
import type { AuthorContext } from "@/server/context";

import { createAuthor, resetDatabase } from "../support/db";

let ctx: AuthorContext;
let jane: string; // default pen name
let rose: string;

beforeEach(async () => {
  await resetDatabase();
  ctx = await createAuthor("Jane");
  jane = (await getDefaultPenName(ctx)).id;
  rose = (await createPenName(ctx, { name: "Rose" })).id;
});

async function sceneIn(bookId: string) {
  return (await createScene(ctx, (await createChapter(ctx, bookId)).id)).id;
}

const group = (report: Awaited<ReturnType<typeof previewIdentityMove>>, key: string) =>
  report.groups.find((g) => g.key === key);
const titles = (report: Awaited<ReturnType<typeof previewIdentityMove>>, key: string) =>
  group(report, key)?.items.map((i) => i.title) ?? [];

describe("moving a standalone book to another pen name", () => {
  it("reports and moves its characters, relationships, structures and fields together", async () => {
    const book = await createBook(ctx, { title: "Harbour Lights" });
    const scene = await sceneIn(book.id);
    const mara = await createCharacter(ctx, { name: "Mara" });
    const theo = await createCharacter(ctx, { name: "Theo" });
    // Theo isn't in a scene, but is Mara's love interest: he comes too.
    await addParticipant(ctx, scene, { characterId: mara.id });
    const rel = await createRelationship(ctx, {
      characterId: mara.id,
      otherCharacterId: theo.id,
      type: "Romance",
    });
    const arc = await createOutline(ctx, {
      bookId: book.id,
      kind: "ROMANCE",
      relationshipId: rel.id,
    });
    const unrelated = await createCharacter(ctx, { name: "Bystander" });
    const note = await createNote(ctx, { title: "Research", aboutId: mara.id });
    const magic = await createFieldDefinition(ctx, {
      nodeKind: "CHARACTER",
      label: "Magic",
      penNameId: jane,
    });
    await setFieldValue(ctx, mara.id, magic.id, "Tides");

    const move: IdentityMove = { kind: "BOOK", id: book.id, toPenNameId: rose };
    const report = await previewIdentityMove(ctx, move);
    expect(report.title).toBe("Move “Harbour Lights” to Rose?");
    expect(report.blockers).toEqual([]);
    expect(titles(report, "BOOK")).toEqual(["Harbour Lights"]);
    expect(group(report, "BOOK")?.detail).toBe("1 chapter · 1 scene");
    expect(titles(report, "CHARACTER")).toEqual(["Mara", "Theo"]);
    expect(titles(report, "RELATIONSHIP")).toEqual(["Mara & Theo"]);
    expect(group(report, "OUTLINE")?.items.map((i) => i.id)).toEqual([arc.id]);
    expect(titles(report, "FIELD")).toEqual(["Magic"]);
    expect(group(report, "SHARED")?.count).toBe(1);
    expect(report.summary).toBe(
      "This will affect 6 items: 1 book, 2 characters, 1 relationship, 1 structure, 1 custom field.",
    );

    // Nothing has changed yet.
    expect((await getCharacter(ctx, mara.id)).penNameId).toBe(jane);

    await applyIdentityMove(ctx, move, report.token);
    expect((await getBook(ctx, book.id)).penName.id).toBe(rose);
    expect((await getCharacter(ctx, mara.id)).penNameId).toBe(rose);
    expect((await getCharacter(ctx, theo.id)).penNameId).toBe(rose);
    expect((await getCharacter(ctx, unrelated.id)).penNameId).toBe(jane);
    // The pen-limited field was copied to Rose and the value kept.
    const values = await getFieldValues(ctx, mara.id);
    const [fieldId] = Object.keys(values);
    expect(values[fieldId]).toBe("Tides");
    const copied = await db.fieldDefinition.findUniqueOrThrow({ where: { id: fieldId } });
    expect([copied.label, copied.penNameId]).toEqual(["Magic", rose]);
    // The shared note still links to Mara.
    expect(await db.connection.count({ where: { sourceId: note.id, targetId: mara.id } })).toBe(1);
  });

  it("is blocked by links to other work of the old pen name, and moves nothing", async () => {
    const book = await createBook(ctx, { title: "Book A" });
    const other = await createBook(ctx, { title: "Book B" });
    const mara = await createCharacter(ctx, { name: "Mara" });
    await addParticipant(ctx, await sceneIn(book.id), { characterId: mara.id });
    await addParticipant(ctx, await sceneIn(other.id), { characterId: mara.id });

    const move: IdentityMove = { kind: "BOOK", id: book.id, toPenNameId: rose };
    const report = await previewIdentityMove(ctx, move);
    expect(report.blockers).toHaveLength(1);
    expect(report.blockers[0].title).toBe("Book B › Scene 1");
    expect(report.blockers[0].reason).toMatch(/Linked to “Mara”/);
    await expect(applyIdentityMove(ctx, move, report.token)).rejects.toBeInstanceOf(RuleError);
    expect((await getBook(ctx, book.id)).penName.id).toBe(jane);
    expect((await getCharacter(ctx, mara.id)).penNameId).toBe(jane);
  });

  it("refuses a stale review", async () => {
    const book = await createBook(ctx, { title: "Book A" });
    const scene = await sceneIn(book.id);
    const move: IdentityMove = { kind: "BOOK", id: book.id, toPenNameId: rose };
    const report = await previewIdentityMove(ctx, move);
    // Someone adds a character to the book after the review.
    const late = await createCharacter(ctx, { name: "Late" });
    await addParticipant(ctx, scene, { characterId: late.id });
    await expect(applyIdentityMove(ctx, move, report.token)).rejects.toBeInstanceOf(ConflictError);
    expect((await getBook(ctx, book.id)).penName.id).toBe(jane);
  });

  it("only applies to standalone books, and to a different, active pen name", async () => {
    const series = await createSeries(ctx, { title: "Saga" });
    const inSeries = await createBook(ctx, { title: "Saga 1", seriesId: series.id });
    await expect(
      previewIdentityMove(ctx, { kind: "BOOK", id: inSeries.id, toPenNameId: rose }),
    ).rejects.toThrow(/series’ pen name/);
    const loose = await createBook(ctx, { title: "Loose" });
    await expect(
      previewIdentityMove(ctx, { kind: "BOOK", id: loose.id, toPenNameId: jane }),
    ).rejects.toThrow(/already belongs/);
  });
});

describe("moving a series to another pen name", () => {
  it("moves its books, its own characters and characters appearing in it", async () => {
    const series = await createSeries(ctx, { title: "Saga" });
    const b1 = await createBook(ctx, { title: "Saga 1", seriesId: series.id });
    const b2 = await createBook(ctx, { title: "Saga 2", seriesId: series.id });
    const hero = await createCharacter(ctx, { name: "Hero", seriesId: series.id });
    const guest = await createCharacter(ctx, { name: "Guest" }); // not tied to the series
    await addParticipant(ctx, await sceneIn(b2.id), { characterId: guest.id });
    const arc = await createOutline(ctx, { seriesId: series.id, kind: "PLOT" });

    const move: IdentityMove = { kind: "SERIES", id: series.id, toPenNameId: rose };
    const report = await previewIdentityMove(ctx, move);
    expect(titles(report, "SERIES")).toEqual(["Saga"]);
    expect(titles(report, "BOOK")).toEqual(["Saga 1", "Saga 2"]);
    expect(titles(report, "CHARACTER")).toEqual(["Guest", "Hero"]);
    expect(group(report, "OUTLINE")?.items.map((i) => i.id)).toEqual([arc.id]);

    await applyIdentityMove(ctx, move, report.token);
    expect((await getSeries(ctx, series.id)).penName.id).toBe(rose);
    expect((await getBook(ctx, b1.id)).penName.id).toBe(rose);
    expect((await getCharacter(ctx, hero.id)).penNameId).toBe(rose);
    expect((await getCharacter(ctx, guest.id)).penNameId).toBe(rose);
  });
});
