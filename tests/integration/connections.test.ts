import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { ConflictError, NotFoundError, RuleError } from "@/lib/errors";
import { createCharacter, trashCharacter } from "@/modules/characters";
import { connect, disconnect, listConnections, updateConnection } from "@/modules/connections";
import { createIdea } from "@/modules/ideas";
import { createBook, trashBook } from "@/modules/library";
import { createChapter, createScene, trashChapter } from "@/modules/manuscript";
import { createNote, listNotes } from "@/modules/notes";
import { createRelationship } from "@/modules/relationships";
import { resolveNodes, searchNodes } from "@/modules/story-graph";
import { deleteForever, restoreFromTrash } from "@/modules/trash";
import type { AuthorContext } from "@/server/context";

import { createAuthor, resetDatabase } from "../support/db";

let ctx: AuthorContext;
let bookId: string;
let chapterId: string;
let sceneId: string;
let mara: string;
let theo: string;

beforeEach(async () => {
  await resetDatabase();
  ctx = await createAuthor();
  bookId = (await createBook(ctx, { title: "The Long Night" })).id;
  chapterId = (await createChapter(ctx, bookId, { title: "Arrival" })).id;
  sceneId = (await createScene(ctx, chapterId, "Storm")).id;
  mara = (await createCharacter(ctx, { name: "Mara", role: "PROTAGONIST" })).id;
  theo = (await createCharacter(ctx, { name: "Theo" })).id;
});

const headings = async (nodeId: string) =>
  (await listConnections(ctx, nodeId)).map(
    (c) => `${c.heading}: ${c.other.title}${c.attribute ? ` (${c.attribute})` : ""}`,
  );

describe("universal connections", () => {
  it("connects a character to a scene with a role, readable from both ends", async () => {
    await connect(ctx, { sourceId: mara, targetId: sceneId, kind: "appears_in", attribute: "POV" });
    expect(await headings(mara)).toEqual(["Appears in: Storm (POV)"]);
    expect(await headings(sceneId)).toEqual(["Characters: Mara (POV)"]);

    const [view] = await listConnections(ctx, sceneId);
    expect(view.other).toMatchObject({ kind: "CHARACTER", href: `/characters/${mara}` });
  });

  it("accepts a directed kind offered from the target's side and stores it source → target", async () => {
    await connect(ctx, { sourceId: sceneId, targetId: theo, kind: "appears_in" });
    const row = await db.connection.findFirstOrThrow({ where: { kind: "appears_in" } });
    expect([row.sourceId, row.targetId]).toEqual([theo, sceneId]);
    expect(row.attributes).toEqual({ role: "PRESENT" });
  });

  it("keeps one point-of-view character per scene, handing POV over", async () => {
    await connect(ctx, { sourceId: mara, targetId: sceneId, kind: "appears_in", attribute: "POV" });
    const theoLink = await connect(ctx, { sourceId: theo, targetId: sceneId, kind: "appears_in" });
    await updateConnection(ctx, theoLink.id, { attribute: "POV" });
    expect((await headings(sceneId)).sort()).toEqual([
      "Characters: Mara (PRESENT)",
      "Characters: Theo (POV)",
    ]);

    // The database refuses a second POV even if the service were bypassed.
    await expect(
      db.connection.updateMany({
        where: { sourceId: mara },
        data: { attributes: { role: "POV" } },
      }),
    ).rejects.toThrow(/unique/i);
  });

  it("rejects kinds that don't fit, bad attributes, self-links and duplicates", async () => {
    await expect(
      connect(ctx, { sourceId: mara, targetId: bookId, kind: "appears_in" }),
    ).rejects.toBeInstanceOf(RuleError);
    await expect(
      connect(ctx, { sourceId: mara, targetId: sceneId, kind: "nope" }),
    ).rejects.toBeInstanceOf(RuleError);
    await expect(
      connect(ctx, { sourceId: mara, targetId: sceneId, kind: "appears_in", attribute: "VILLAIN" }),
    ).rejects.toBeInstanceOf(RuleError);
    await expect(
      connect(ctx, { sourceId: mara, targetId: mara, kind: "related" }),
    ).rejects.toBeInstanceOf(RuleError);

    await connect(ctx, { sourceId: mara, targetId: sceneId, kind: "appears_in" });
    await expect(
      connect(ctx, { sourceId: mara, targetId: sceneId, kind: "appears_in" }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("stores undirected links once per pair, whichever side starts", async () => {
    await connect(ctx, { sourceId: mara, targetId: theo, kind: "related", label: "Old friends" });
    await expect(
      connect(ctx, { sourceId: theo, targetId: mara, kind: "related" }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(await headings(theo)).toEqual(["Related to: Mara"]);
    expect((await listConnections(ctx, mara))[0].label).toBe("Old friends");
  });

  it("connects any kinds of story object generically", async () => {
    const idea = await createIdea(ctx, { title: "A lighthouse keeper who can't swim" });
    const note = await createNote(ctx, { title: "Research: lighthouses" });
    const rel = await createRelationship(ctx, {
      characterId: mara,
      otherCharacterId: theo,
      type: "Rivals",
    });

    await connect(ctx, { sourceId: note.id, targetId: rel.id, kind: "about" });
    await connect(ctx, { sourceId: note.id, targetId: chapterId, kind: "about" });
    await connect(ctx, { sourceId: idea.id, targetId: mara, kind: "inspired" });
    await connect(ctx, {
      sourceId: rel.id,
      targetId: sceneId,
      kind: "develops_in",
      note: "First argument",
    });
    await connect(ctx, { sourceId: bookId, targetId: idea.id, kind: "related" });

    expect((await headings(note.id)).sort()).toEqual(["About: Arrival", "About: Mara & Theo"]);
    expect(await headings(mara)).toEqual(["Inspired by: A lighthouse keeper who can't swim"]);
    expect(await headings(sceneId)).toEqual(["Relationship moments: Mara & Theo"]);
    expect((await listConnections(ctx, rel.id)).map((c) => c.note)).toContain("First argument");
  });

  it("creates a note already about something, atomically", async () => {
    const note = await createNote(ctx, { title: "Scene beats", aboutId: sceneId });
    expect(await headings(note.id)).toEqual(["About: Storm"]);
    expect((await listNotes(ctx, { aboutId: sceneId })).map((n) => n.id)).toEqual([note.id]);

    // An invalid target leaves no half-created note behind.
    const before = await db.note.count();
    await expect(
      createNote(ctx, { title: "Orphan", aboutId: crypto.randomUUID() }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(await db.note.count()).toBe(before);
  });

  it("hides links to trashed objects and brings them back on restore", async () => {
    await connect(ctx, { sourceId: mara, targetId: sceneId, kind: "appears_in" });
    await trashChapter(ctx, chapterId);
    expect(await listConnections(ctx, mara)).toEqual([]);
    await restoreFromTrash(ctx, "CHAPTER", chapterId);
    expect(await headings(mara)).toEqual(["Appears in: Storm (PRESENT)"]);

    await trashBook(ctx, bookId);
    expect(await listConnections(ctx, mara)).toEqual([]);
  });

  it("deletes links with either end when it is deleted forever", async () => {
    const link = await connect(ctx, { sourceId: mara, targetId: sceneId, kind: "appears_in" });
    await trashCharacter(ctx, mara);
    await deleteForever(ctx, "CHARACTER", mara);
    expect(await db.connection.count({ where: { id: link.id } })).toBe(0);
    expect(await db.storyNode.count({ where: { id: mara } })).toBe(0);
  });

  it("disconnects without touching the connected objects", async () => {
    const link = await connect(ctx, { sourceId: mara, targetId: sceneId, kind: "appears_in" });
    await disconnect(ctx, link.id);
    expect(await listConnections(ctx, sceneId)).toEqual([]);
    expect(await db.character.count({ where: { id: mara } })).toBe(1);
  });

  it("isolates workspaces, in the service and in the database", async () => {
    const stranger = await createAuthor("Stranger");
    const theirs = (await createCharacter(stranger, { name: "Spy" })).id;

    await expect(
      connect(ctx, { sourceId: mara, targetId: theirs, kind: "related" }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(listConnections(stranger, mara)).rejects.toBeInstanceOf(NotFoundError);
    const link = await connect(ctx, { sourceId: mara, targetId: sceneId, kind: "appears_in" });
    await expect(disconnect(stranger, link.id)).rejects.toBeInstanceOf(NotFoundError);

    await expect(
      db.connection.create({
        data: { workspaceId: ctx.workspaceId, sourceId: mara, targetId: theirs, kind: "related" },
      }),
    ).rejects.toThrow(/foreign key/i);
  });
});

describe("story graph resolution and search", () => {
  it("resolves nodes of every kind to titles and links, skipping trashed and foreign ones", async () => {
    const note = await createNote(ctx, { title: "Lighthouse facts" });
    const rel = await createRelationship(ctx, {
      characterId: theo,
      otherCharacterId: mara,
      type: "Siblings",
    });
    const stranger = await createAuthor("Stranger");
    const foreign = (await createCharacter(stranger, { name: "Spy" })).id;
    await trashCharacter(ctx, theo);

    const map = await resolveNodes(ctx, [
      bookId,
      chapterId,
      sceneId,
      mara,
      theo,
      note.id,
      rel.id,
      foreign,
    ]);
    expect([...map.values()].map((n) => `${n.kind}:${n.title}`).sort()).toEqual([
      "BOOK:The Long Night",
      "CHAPTER:Arrival",
      "CHARACTER:Mara",
      "NOTE:Lighthouse facts",
      "SCENE:Storm",
    ]);
    expect(map.get(sceneId)?.context).toBe("The Long Night › Arrival");
  });

  it("searches across kinds by title, prefix matches first", async () => {
    await createNote(ctx, { title: "Storm research" });
    await createCharacter(ctx, { name: "Stormy", aliases: "Storm" });
    const results = await searchNodes(ctx, {
      query: "storm",
      kinds: ["SCENE", "NOTE", "CHARACTER", "BOOK"],
    });
    expect(results.map((r) => `${r.kind}:${r.title}`)).toEqual([
      "SCENE:Storm",
      "NOTE:Storm research",
      "CHARACTER:Stormy",
    ]);
  });
});
