import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { ConflictError, NotFoundError, RuleError } from "@/lib/errors";
import {
  createCharacter,
  getCharacter,
  listCharacters,
  trashCharacter,
  updateCharacter,
  updateProfileField,
} from "@/modules/characters";
import { connect, listConnections } from "@/modules/connections";
import { createIdea, getIdea, listIdeas, promoteIdeaToBook, updateIdea } from "@/modules/ideas";
import { createSeries, getBook } from "@/modules/library";
import { createChapter, createScene } from "@/modules/manuscript";
import { createNote, getNote, renameNote, saveNoteBody, trashNote } from "@/modules/notes";
import { createRelationship, listRelationships, updateRelationship } from "@/modules/relationships";
import { emptyTrash, listTrash, restoreFromTrash } from "@/modules/trash";
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

describe("characters", () => {
  it("creates and edits characters, profile fields and series scope", async () => {
    const series = await createSeries(ctx, { title: "Harbour Town" });
    const { id } = await createCharacter(ctx, {
      name: " Mara Quinn ",
      aliases: "Mags, Captain ",
      role: "PROTAGONIST",
    });
    await updateCharacter(ctx, id, {
      name: "Mara Quinn",
      aliases: "Mags",
      role: "PROTAGONIST",
      seriesId: series.id,
      summary: "",
    });
    await updateProfileField(ctx, id, "goal", "Keep the light burning");
    await updateProfileField(ctx, id, "age", "34");
    await updateProfileField(ctx, id, "age", "");

    const c = await getCharacter(ctx, id);
    expect(c).toMatchObject({
      name: "Mara Quinn",
      aliases: ["Mags"],
      role: "PROTAGONIST",
      summary: null,
    });
    expect(c.series?.title).toBe("Harbour Town");
    expect(c.profile).toEqual({ goal: "Keep the light burning" });

    await expect(updateProfileField(ctx, id, "shoeSize", "9")).rejects.toThrow();
  });

  it("counts scene appearances", async () => {
    const book = await db.book.findFirst(); // none yet
    expect(book).toBeNull();
    const { id: mara } = await createCharacter(ctx, { name: "Mara" });
    const { createBook } = await import("@/modules/library");
    const b = await createBook(ctx, { title: "B" });
    const ch = await createChapter(ctx, b.id);
    for (let i = 0; i < 3; i++) {
      const s = await createScene(ctx, ch.id);
      await connect(ctx, { sourceId: mara, targetId: s.id, kind: "appears_in" });
    }
    expect((await listCharacters(ctx))[0]).toMatchObject({ name: "Mara", sceneCount: 3 });

    // Scenes in the Trash don't count.
    const { trashChapter } = await import("@/modules/manuscript");
    await trashChapter(ctx, ch.id);
    expect((await listCharacters(ctx))[0]).toMatchObject({ sceneCount: 0 });
  });

  it("trashes and restores characters with their relationships", async () => {
    const a = (await createCharacter(ctx, { name: "A" })).id;
    const b = (await createCharacter(ctx, { name: "B" })).id;
    await createRelationship(ctx, { characterId: a, otherCharacterId: b, type: "Siblings" });

    await trashCharacter(ctx, a);
    expect(await listCharacters(ctx)).toHaveLength(1);
    expect(await listRelationships(ctx)).toEqual([]);
    expect((await listTrash(ctx)).map((i) => i.kind)).toEqual(["CHARACTER"]); // the relationship isn't listed separately

    await restoreFromTrash(ctx, "CHARACTER", a);
    expect(await listRelationships(ctx)).toHaveLength(1);
  });
});

describe("relationships", () => {
  it("stores each pair once, whichever character starts", async () => {
    const a = (await createCharacter(ctx, { name: "Ada" })).id;
    const b = (await createCharacter(ctx, { name: "Ben" })).id;
    const rel = await createRelationship(ctx, {
      characterId: b,
      otherCharacterId: a,
      type: "Romance",
    });
    await expect(
      createRelationship(ctx, { characterId: a, otherCharacterId: b, type: "Rivals" }),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      createRelationship(ctx, { characterId: a, otherCharacterId: a, type: "Self" }),
    ).rejects.toBeInstanceOf(RuleError);

    await updateRelationship(ctx, rel.id, { type: "Romance", description: "Slow burn" });
    const [r] = await listRelationships(ctx, { characterId: a });
    expect(r).toMatchObject({ type: "Romance", description: "Slow burn" });
    expect(r.members.map((m) => m.name)).toEqual(["Ben", "Ada"]);
    expect(r.title).toBe("Ben & Ada");

    // One relationship per set of members is a database rule too.
    const row = await db.relationship.findUniqueOrThrow({ where: { id: rel.id } });
    expect(row.memberKey).toBe([a, b].sort().join(","));
  });

  it("is a story node that other things can connect to", async () => {
    const a = (await createCharacter(ctx, { name: "Ada" })).id;
    const b = (await createCharacter(ctx, { name: "Ben" })).id;
    const rel = await createRelationship(ctx, {
      characterId: a,
      otherCharacterId: b,
      type: "Romance",
    });
    const note = await createNote(ctx, { title: "Their arc", aboutId: rel.id });
    expect((await listConnections(ctx, rel.id)).map((c) => c.other.id)).toEqual([note.id]);
  });

  it("only links characters in the same workspace", async () => {
    const a = (await createCharacter(ctx, { name: "Ada" })).id;
    const stranger = await createAuthor("Stranger");
    const theirs = (await createCharacter(stranger, { name: "Spy" })).id;
    await expect(
      createRelationship(ctx, { characterId: a, otherCharacterId: theirs, type: "Spies" }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("notes", () => {
  it("saves note bodies with conflict protection", async () => {
    const { id } = await createNote(ctx, { title: "Research" });
    await saveNoteBody(ctx, {
      noteId: id,
      content: doc("Lighthouses use Fresnel lenses."),
      baseVersion: 0,
    });
    await expect(
      saveNoteBody(ctx, { noteId: id, content: doc("stale"), baseVersion: 0 }),
    ).rejects.toBeInstanceOf(ConflictError);
    await renameNote(ctx, id, "Lighthouse research");
    const note = await getNote(ctx, id);
    expect(note).toMatchObject({ title: "Lighthouse research", version: 1 });
    expect(note.body).toEqual(doc("Lighthouses use Fresnel lenses."));
  });

  it("goes to the Trash and back, keeping its connections", async () => {
    const { createBook } = await import("@/modules/library");
    const book = await createBook(ctx, { title: "B" });
    const { id } = await createNote(ctx, { title: "About B", aboutId: book.id });
    await trashNote(ctx, id);
    expect(await listConnections(ctx, book.id)).toEqual([]);
    await restoreFromTrash(ctx, "NOTE", id);
    expect((await listConnections(ctx, book.id)).map((c) => c.heading)).toEqual(["Notes"]);
  });
});

describe("ideas", () => {
  it("captures, edits and orders ideas (open first)", async () => {
    const a = await createIdea(ctx, { title: "First" });
    await createIdea(ctx, { title: "Second", body: "More detail" });
    await updateIdea(ctx, a.id, { title: "First, revised", status: "ARCHIVED" });
    expect((await listIdeas(ctx)).map((i) => `${i.title}:${i.status}`)).toEqual([
      "Second:OPEN",
      "First, revised:ARCHIVED",
    ]);
  });

  it("promotes an idea to a book, linked back to the idea", async () => {
    const idea = await createIdea(ctx, {
      title: "The Lighthouse",
      body: "A keeper who can't swim.",
    });
    const book = await promoteIdeaToBook(ctx, idea.id);
    expect(await getBook(ctx, book.id)).toMatchObject({
      title: "The Lighthouse",
      description: "A keeper who can't swim.",
    });
    expect((await getIdea(ctx, idea.id)).status).toBe("USED");
    expect(
      (await listConnections(ctx, book.id)).map((c) => `${c.heading}: ${c.other.title}`),
    ).toEqual(["Inspired by: The Lighthouse"]);
  });
});

describe("trash across story bible kinds", () => {
  it("lists, restores and empties every new kind", async () => {
    const c = await createCharacter(ctx, { name: "C" });
    const n = await createNote(ctx, { title: "N" });
    const i = await createIdea(ctx, { title: "I" });
    const { trashIdea } = await import("@/modules/ideas");
    await trashCharacter(ctx, c.id);
    await trashNote(ctx, n.id);
    await trashIdea(ctx, i.id);
    expect((await listTrash(ctx)).map((t) => t.kind).sort()).toEqual(["CHARACTER", "IDEA", "NOTE"]);
    expect(await emptyTrash(ctx)).toBe(3);
    expect(await db.storyNode.count({ where: { workspaceId: ctx.workspaceId } })).toBe(0);
  });
});
