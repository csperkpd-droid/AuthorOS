import { beforeEach, describe, expect, it } from "vitest";

import { RuleError } from "@/lib/errors";
import {
  createCharacter,
  getCharacter,
  listCharacters,
  updateCharacter,
} from "@/modules/characters";
import { connect } from "@/modules/connections";
import { createBook, createSeries } from "@/modules/library";
import { applyIdentityMove, previewIdentityMove } from "@/modules/impact";
import { createChapter, createScene } from "@/modules/manuscript";
import { createNote } from "@/modules/notes";
import { createPenName, getDefaultPenName, setActiveIdentity } from "@/modules/pen-names";
import { createRelationship, listRelationships } from "@/modules/relationships";
import { searchNodes } from "@/modules/story-graph";
import { findPrimaryMembership } from "@/modules/workspaces";
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

async function sceneIn(book: { id: string }) {
  return (await createScene(ctx, (await createChapter(ctx, book.id)).id)).id;
}

describe("characters belong to an identity", () => {
  it("are created under a series' pen name, a chosen pen name, or the active identity", async () => {
    const roseSeries = await createSeries(ctx, { title: "Harbour Town", penNameId: rose });
    const inSeries = await createCharacter(ctx, { name: "Mara", seriesId: roseSeries.id });
    expect((await getCharacter(ctx, inSeries.id)).penNameId).toBe(rose);

    const chosen = await createCharacter(ctx, { name: "Ivy", penNameId: rose });
    expect((await getCharacter(ctx, chosen.id)).penNameId).toBe(rose);

    const byDefault = await createCharacter(ctx, { name: "Jo" });
    expect((await getCharacter(ctx, byDefault.id)).penNameId).toBe(jane);

    await setActiveIdentity(ctx, rose);
    const active = { ...ctx, ...(await findPrimaryMembership(ctx.userId))! };
    const writingAsRose = await createCharacter(active, { name: "Pip" });
    expect((await getCharacter(ctx, writingAsRose.id)).penNameId).toBe(rose);

    await expect(
      createCharacter(ctx, { name: "Clash", seriesId: roseSeries.id, penNameId: jane }),
    ).rejects.toBeInstanceOf(RuleError);
  });

  it("are listed per identity, or all together", async () => {
    await createCharacter(ctx, { name: "Mara", penNameId: rose });
    await createCharacter(ctx, { name: "Mara", penNameId: jane }); // same name, different worlds
    expect((await listCharacters(ctx, { penNameId: rose })).map((c) => c.penNameId)).toEqual([
      rose,
    ]);
    expect(await listCharacters(ctx, { penNameId: jane })).toHaveLength(1);
    expect(await listCharacters(ctx)).toHaveLength(2);
  });

  it("move with their series when the series changes pen name", async () => {
    const series = await createSeries(ctx, { title: "Saga" });
    const c = await createCharacter(ctx, { name: "Hero", seriesId: series.id });
    const move = { kind: "SERIES" as const, id: series.id, toPenNameId: rose };
    const report = await previewIdentityMove(ctx, move);
    await applyIdentityMove(ctx, move, report.token);
    expect((await getCharacter(ctx, c.id)).penNameId).toBe(rose);
  });

  it("can't change identity once linked to other work", async () => {
    const c = await createCharacter(ctx, { name: "Hero" });
    await updateCharacter(ctx, c.id, { name: "Hero", penNameId: rose });
    expect((await getCharacter(ctx, c.id)).penNameId).toBe(rose);

    const roseBook = await createBook(ctx, { title: "Rose book", penNameId: rose });
    await connect(ctx, { sourceId: c.id, targetId: await sceneIn(roseBook), kind: "appears_in" });
    await expect(
      updateCharacter(ctx, c.id, { name: "Hero", penNameId: jane }),
    ).rejects.toBeInstanceOf(RuleError);
  });
});

describe("nothing crosses identities", () => {
  it("refuses connections between objects of different pen names", async () => {
    const roseChar = await createCharacter(ctx, { name: "Mara", penNameId: rose });
    const janeBook = await createBook(ctx, { title: "Jane book" });
    await expect(
      connect(ctx, {
        sourceId: roseChar.id,
        targetId: await sceneIn(janeBook),
        kind: "appears_in",
      }),
    ).rejects.toBeInstanceOf(RuleError);
    await expect(
      connect(ctx, { sourceId: roseChar.id, targetId: janeBook.id, kind: "related" }),
    ).rejects.toBeInstanceOf(RuleError);
  });

  it("keeps a series' characters within that series' books", async () => {
    const saga = await createSeries(ctx, { title: "Saga" });
    const book1 = await createBook(ctx, { title: "Saga 1", seriesId: saga.id });
    const standalone = await createBook(ctx, { title: "Standalone" });
    const hero = await createCharacter(ctx, { name: "Hero", seriesId: saga.id });
    await connect(ctx, { sourceId: hero.id, targetId: await sceneIn(book1), kind: "appears_in" });
    await expect(
      connect(ctx, { sourceId: hero.id, targetId: await sceneIn(standalone), kind: "appears_in" }),
    ).rejects.toBeInstanceOf(RuleError);

    // An identity-level character (no series) can appear in any of that identity's books.
    const drifter = await createCharacter(ctx, { name: "Drifter" });
    await connect(ctx, {
      sourceId: drifter.id,
      targetId: await sceneIn(book1),
      kind: "appears_in",
    });
    await connect(ctx, {
      sourceId: drifter.id,
      targetId: await sceneIn(standalone),
      kind: "appears_in",
    });
  });

  it("refuses relationships between characters of different pen names", async () => {
    const a = await createCharacter(ctx, { name: "A", penNameId: rose });
    const b = await createCharacter(ctx, { name: "B", penNameId: jane });
    await expect(
      createRelationship(ctx, { characterId: a.id, otherCharacterId: b.id, type: "x" }),
    ).rejects.toBeInstanceOf(RuleError);
    const c = await createCharacter(ctx, { name: "C", penNameId: rose });
    await createRelationship(ctx, { characterId: a.id, otherCharacterId: c.id, type: "Rivals" });
    expect(await listRelationships(ctx, { penNameId: rose })).toHaveLength(1);
    expect(await listRelationships(ctx, { penNameId: jane })).toHaveLength(0);
  });

  it("lets shared objects (notes) link to any identity, and scopes search", async () => {
    const roseChar = await createCharacter(ctx, { name: "Mara", penNameId: rose });
    const janeChar = await createCharacter(ctx, { name: "Mara", penNameId: jane });
    const note = await createNote(ctx, { title: "Names I like" });
    await connect(ctx, { sourceId: note.id, targetId: roseChar.id, kind: "about" });
    await connect(ctx, { sourceId: note.id, targetId: janeChar.id, kind: "about" });

    const found = await searchNodes(ctx, {
      query: "Mara",
      kinds: ["CHARACTER", "NOTE"],
      penNameId: rose,
    });
    expect(found.map((f) => f.id)).toEqual([roseChar.id]);
    expect(await searchNodes(ctx, { query: "Mara", kinds: ["CHARACTER"] })).toHaveLength(2);
  });
});
