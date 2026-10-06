import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { ConflictError, NotFoundError, RuleError } from "@/lib/errors";
import { createCharacter } from "@/modules/characters";
import {
  createFieldDefinition,
  deleteFieldDefinition,
  fieldContext,
  fieldScopeOptions,
  getFieldValues,
  listFieldDefinitions,
  renameFieldDefinition,
  setFieldValue,
} from "@/modules/fields";
import { createBook, createSeries } from "@/modules/library";
import { createChapter, createScene } from "@/modules/manuscript";
import { getRevision, listRevisions, restoreRevision, saveVersion } from "@/modules/history";
import { createIdea } from "@/modules/ideas";
import { createNote, getNote, saveNoteBody } from "@/modules/notes";
import { createPenName, getDefaultPenName } from "@/modules/pen-names";
import { addParticipant } from "@/modules/participation";
import type { AuthorContext } from "@/server/context";

import { createAuthor, resetDatabase } from "../support/db";

let ctx: AuthorContext;
beforeEach(async () => {
  await resetDatabase();
  ctx = await createAuthor();
});

const doc = (text: string) => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

describe("note history", () => {
  it("checkpoints, saves named versions and restores, like scenes", async () => {
    const { id } = await createNote(ctx, { title: "Research" });
    await saveNoteBody(ctx, { noteId: id, content: doc("first version"), baseVersion: 0 });
    await saveNoteBody(ctx, { noteId: id, content: doc("second version"), baseVersion: 1 });
    expect((await listRevisions(ctx, id)).map((r) => [r.source, r.excerpt])).toEqual([
      ["AUTOSAVE", "first version"],
    ]);

    const named = await saveVersion(ctx, id, "Before rewrite");
    await saveNoteBody(ctx, { noteId: id, content: doc("a rewrite"), baseVersion: 2 });
    await restoreRevision(ctx, named!.id);

    const note = await getNote(ctx, id);
    expect(note.body).toEqual(doc("second version"));
    expect(note.version).toBe(4);
    const revisions = await listRevisions(ctx, id);
    expect(revisions[0]).toMatchObject({ source: "BEFORE_RESTORE", excerpt: "a rewrite" });
    expect((await getRevision(ctx, named!.id)).label).toBe("Before rewrite");
  });

  it("never silently overwrites", async () => {
    const { id } = await createNote(ctx, { title: "N" });
    await saveNoteBody(ctx, { noteId: id, content: doc("tab one"), baseVersion: 0 });
    await expect(
      saveNoteBody(ctx, { noteId: id, content: doc("tab two"), baseVersion: 0 }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("keeps history only for versioned kinds and only in the author's workspace", async () => {
    const idea = await createIdea(ctx, { title: "Idea" });
    await expect(listRevisions(ctx, idea.id)).rejects.toBeInstanceOf(NotFoundError);
    const { id } = await createNote(ctx, { title: "N" });
    const v = await saveVersion(ctx, id, "x");
    const stranger = await createAuthor("Stranger");
    await expect(getRevision(stranger, v!.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(restoreRevision(stranger, v!.id)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("custom fields", () => {
  it("defines fields per kind, stores values on story objects, and clears empty values", async () => {
    const mara = await createCharacter(ctx, { name: "Mara" });
    const field = await createFieldDefinition(ctx, {
      nodeKind: "CHARACTER",
      label: "Love language",
    });
    await createFieldDefinition(ctx, { nodeKind: "CHARACTER", label: "Zodiac sign" });
    await expect(
      createFieldDefinition(ctx, { nodeKind: "CHARACTER", label: "love LANGUAGE" }),
    ).rejects.toBeInstanceOf(ConflictError);

    await setFieldValue(ctx, mara.id, field.id, "Acts of service");
    expect(await getFieldValues(ctx, mara.id)).toEqual({ [field.id]: "Acts of service" });
    await setFieldValue(ctx, mara.id, field.id, "  ");
    expect(await getFieldValues(ctx, mara.id)).toEqual({});

    await renameFieldDefinition(ctx, field.id, "Love languages");
    const defs = await listFieldDefinitions(ctx, {
      nodeKind: "CHARACTER",
      context: await fieldContext(ctx, mara.id),
    });
    expect(defs.map((d) => d.label)).toEqual(["Love languages", "Zodiac sign"]);
  });

  it("only applies fields to their kind and identity", async () => {
    const jane = (await getDefaultPenName(ctx)).id;
    const rose = (await createPenName(ctx, { name: "Rose" })).id;
    const roseOnly = await createFieldDefinition(ctx, {
      nodeKind: "CHARACTER",
      label: "Magic type",
      penNameId: rose,
    });
    const janeChar = await createCharacter(ctx, { name: "Jo", penNameId: jane });
    const roseChar = await createCharacter(ctx, { name: "Ivy", penNameId: rose });
    const note = await createNote(ctx, { title: "N" });

    await setFieldValue(ctx, roseChar.id, roseOnly.id, "Fire");
    await expect(setFieldValue(ctx, janeChar.id, roseOnly.id, "Fire")).rejects.toBeInstanceOf(
      RuleError,
    );
    await expect(setFieldValue(ctx, note.id, roseOnly.id, "Fire")).rejects.toBeInstanceOf(
      RuleError,
    );
    expect(
      await listFieldDefinitions(ctx, {
        nodeKind: "CHARACTER",
        context: await fieldContext(ctx, janeChar.id),
      }),
    ).toEqual([]);
    const forRose = await listFieldDefinitions(ctx, {
      nodeKind: "CHARACTER",
      context: await fieldContext(ctx, roseChar.id),
    });
    expect(forRose.map((d) => [d.label, d.scope])).toEqual([["Magic type", "Rose"]]);
  });

  it("scopes fields to a series or a book, and offers the pen name first", async () => {
    const saga = await createSeries(ctx, { title: "Saga" });
    const book1 = await createBook(ctx, { title: "Saga 1", seriesId: saga.id });
    const loose = await createBook(ctx, { title: "Loose" });
    const hero = await createCharacter(ctx, { name: "Hero", seriesId: saga.id });
    const other = await createCharacter(ctx, { name: "Other" });
    const chapter = await createChapter(ctx, book1.id);
    const scene = await createScene(ctx, chapter.id);
    await addParticipant(ctx, scene.id, { characterId: hero.id });

    const options = await fieldScopeOptions(ctx, await fieldContext(ctx, hero.id));
    expect(options.map((o) => o.label)).toEqual([
      "This pen name (Test Author)",
      "All pen names",
      "This series (Saga)",
      "Book: Saga 1",
    ]);

    const bySeries = await createFieldDefinition(ctx, {
      nodeKind: "CHARACTER",
      label: "House",
      seriesId: saga.id,
    });
    const byBook = await createFieldDefinition(ctx, {
      nodeKind: "CHARACTER",
      label: "Book 1 secret",
      bookId: book1.id,
    });
    await createFieldDefinition(ctx, {
      nodeKind: "CHARACTER",
      label: "Elsewhere",
      bookId: loose.id,
    });
    await expect(
      createFieldDefinition(ctx, {
        nodeKind: "CHARACTER",
        label: "Both",
        seriesId: saga.id,
        bookId: book1.id,
      }),
    ).rejects.toThrow();
    // The same name may exist once per scope.
    await createFieldDefinition(ctx, { nodeKind: "CHARACTER", label: "House" });

    const heroFields = await listFieldDefinitions(ctx, {
      nodeKind: "CHARACTER",
      context: await fieldContext(ctx, hero.id),
    });
    expect(heroFields.map((d) => d.scope).sort()).toEqual([
      "All pen names",
      "Book: Saga 1",
      "Series: Saga",
    ]);
    await setFieldValue(ctx, hero.id, bySeries.id, "Ravenhold");
    await setFieldValue(ctx, hero.id, byBook.id, "Is a prince");
    await expect(setFieldValue(ctx, other.id, bySeries.id, "x")).rejects.toBeInstanceOf(RuleError);
    await expect(setFieldValue(ctx, other.id, byBook.id, "x")).rejects.toBeInstanceOf(RuleError);
  });

  it("deleting a field removes its values everywhere", async () => {
    const mara = await createCharacter(ctx, { name: "Mara" });
    const field = await createFieldDefinition(ctx, { nodeKind: "CHARACTER", label: "Pet" });
    await setFieldValue(ctx, mara.id, field.id, "A cat called Fog");
    await deleteFieldDefinition(ctx, field.id);
    expect(await db.nodeFieldValue.count()).toBe(0);
  });
});
