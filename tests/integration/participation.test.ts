import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { WorkspaceRole } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { ConflictError, ForbiddenError, NotFoundError, RuleError } from "@/lib/errors";
import {
  createCharacter,
  getCharacter,
  listCharacters,
  trashCharacter,
} from "@/modules/characters";
import { exportWorkspaceJson } from "@/modules/exports";
import { listFieldHistory, listParticipationHistory, restoreFieldValue } from "@/modules/history";
import { reviewImport, runImport } from "@/modules/imports";
import { createBook, createSeries } from "@/modules/library";
import { createChapter, createScene, saveSceneContent } from "@/modules/manuscript";
import {
  addNewCharacterToScene,
  addParticipant,
  listCharacterScenes,
  listParticipants,
  removeParticipant,
  setPointOfView,
  updateParticipant,
} from "@/modules/participation";
import { createPenName } from "@/modules/pen-names";
import { search } from "@/modules/search";
import { auditGraph } from "@/modules/story-graph";
import { deleteForever, previewDeleteForever, restoreFromTrash } from "@/modules/trash";
import type { AuthorContext } from "@/server/context";
import { ROLE_GRANTS } from "@/server/policy";

import { createAuthor, resetDatabase } from "../support/db";

/**
 * M11 Scene Participation (decision 106): a character's relationship to a
 * scene, with Present / Mentioned and at most one point of view.
 */

let ctx: AuthorContext;
let bookId: string;
let sceneId: string;
let charlie: string;
let mara: string;
let bell: string;

const doc = (text: string) => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

beforeEach(async () => {
  await resetDatabase();
  ctx = await createAuthor("Jane");
  bookId = (await createBook(ctx, { title: "Harbour Lights" })).id;
  const chapter = await createChapter(ctx, bookId, { title: "Arrival" });
  sceneId = (await createScene(ctx, chapter.id, "The storm")).id;
  [charlie, mara, bell] = await Promise.all(
    ["Charlie", "Mara", "Bell"].map(async (name) => (await createCharacter(ctx, { name })).id),
  );
});

afterEach(() => {
  delete (ROLE_GRANTS as Record<string, unknown>).MANUSCRIPT_READER;
});

/** "Name: presence, POV" for every visible participant. */
const cast = async (as: AuthorContext = ctx) =>
  (await listParticipants(as, sceneId)).map(
    (p) => `${p.character.title}: ${p.presence}${p.pov ? ", POV" : ""}`,
  );

describe("Scene Participation: roles", () => {
  it("adds a character as present (1)", async () => {
    await addParticipant(ctx, sceneId, { characterId: charlie, presence: "PRESENT" });
    expect(await cast()).toEqual(["Charlie: PRESENT"]);
  });

  it("adds a character as mentioned (2)", async () => {
    await addParticipant(ctx, sceneId, { characterId: mara, presence: "MENTIONED" });
    expect(await cast()).toEqual(["Mara: MENTIONED"]);
  });

  it("assigns the point of view, when adding or later (3)", async () => {
    await addParticipant(ctx, sceneId, { characterId: charlie, pov: true });
    expect(await cast()).toEqual(["Charlie: PRESENT, POV"]);

    await updateParticipant(ctx, sceneId, charlie, { pov: false });
    await addParticipant(ctx, sceneId, { characterId: mara });
    await updateParticipant(ctx, sceneId, mara, { pov: true });
    expect(await cast()).toEqual(["Mara: PRESENT, POV", "Charlie: PRESENT"]);
  });

  it("refuses a second point of view, and changes nothing (4)", async () => {
    await addParticipant(ctx, sceneId, { characterId: charlie, pov: true });
    await addParticipant(ctx, sceneId, { characterId: mara });

    await expect(addParticipant(ctx, sceneId, { characterId: bell, pov: true })).rejects.toThrow(
      /already told from Charlie’s point of view/,
    );
    await expect(updateParticipant(ctx, sceneId, mara, { pov: true })).rejects.toBeInstanceOf(
      RuleError,
    );
    // A new character asked for as the point of view isn't even created.
    const characters = await db.character.count();
    await expect(
      addNewCharacterToScene(ctx, sceneId, { name: "Dana", pov: true }),
    ).rejects.toBeInstanceOf(RuleError);
    expect(await db.character.count()).toBe(characters);
    // Nobody's point of view was replaced or removed.
    expect(await cast()).toEqual(["Charlie: PRESENT, POV", "Mara: PRESENT"]);

    // The database refuses it too, even if the service were bypassed.
    await expect(
      db.sceneParticipation.update({
        where: { sceneId_characterId: { sceneId, characterId: mara } },
        data: { isPov: true },
      }),
    ).rejects.toThrow(/unique/i);
  });

  it("changes the point of view only as an explicit choice (5)", async () => {
    await addParticipant(ctx, sceneId, { characterId: charlie, pov: true });
    await addParticipant(ctx, sceneId, { characterId: mara, presence: "MENTIONED" });

    // The author must have seen who has it now.
    await expect(
      setPointOfView(ctx, sceneId, { characterId: mara, expected: null }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(await cast()).toEqual(["Charlie: PRESENT, POV", "Mara: MENTIONED"]);

    await setPointOfView(ctx, sceneId, { characterId: mara, expected: charlie });
    // Charlie stays in the scene as they were; Mara keeps being mentioned.
    expect(await cast()).toEqual(["Mara: MENTIONED, POV", "Charlie: PRESENT"]);

    // Giving it to someone not yet in the scene adds them as present.
    await setPointOfView(ctx, sceneId, { characterId: bell, expected: mara });
    expect(await cast()).toEqual(["Bell: PRESENT, POV", "Charlie: PRESENT", "Mara: MENTIONED"]);
  });

  it("lets point of view and present go together (6)", async () => {
    await addParticipant(ctx, sceneId, { characterId: charlie, presence: "PRESENT", pov: true });
    const [p] = await listParticipants(ctx, sceneId);
    expect(p).toMatchObject({ presence: "PRESENT", pov: true });
    // Changing the presence keeps the point of view.
    await updateParticipant(ctx, sceneId, charlie, { presence: "MENTIONED" });
    await updateParticipant(ctx, sceneId, charlie, { presence: "PRESENT" });
    expect(await cast()).toEqual(["Charlie: PRESENT, POV"]);
  });

  it("doesn't treat mentioned as present (7)", async () => {
    await addParticipant(ctx, sceneId, { characterId: mara, presence: "MENTIONED" });
    expect(await listCharacterScenes(ctx, mara, { role: "present" })).toEqual([]);
    expect(
      (await listCharacterScenes(ctx, mara, { role: "mentioned" })).map((s) => s.scene.id),
    ).toEqual([sceneId]);
  });

  it("removes a character from a scene, leaving both untouched (8)", async () => {
    await addParticipant(ctx, sceneId, { characterId: charlie, pov: true });
    await removeParticipant(ctx, sceneId, charlie);
    expect(await cast()).toEqual([]);
    expect((await getCharacter(ctx, charlie)).name).toBe("Charlie");
    await expect(removeParticipant(ctx, sceneId, charlie)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("never changes the scene's text (9)", async () => {
    await saveSceneContent(ctx, {
      sceneId,
      content: doc("Charlie watched the harbour."),
      baseVersion: 0,
    });
    const before = await db.scene.findUniqueOrThrow({ where: { id: sceneId } });
    const revisions = await db.contentRevision.count();

    await addParticipant(ctx, sceneId, { characterId: charlie, pov: true });
    await addParticipant(ctx, sceneId, { characterId: mara, presence: "MENTIONED" });
    await setPointOfView(ctx, sceneId, { characterId: mara, expected: charlie });
    await updateParticipant(ctx, sceneId, charlie, { presence: "MENTIONED" });
    await removeParticipant(ctx, sceneId, charlie);

    const after = await db.scene.findUniqueOrThrow({ where: { id: sceneId } });
    expect(after.content).toEqual(before.content);
    expect(after.contentText).toBe("Charlie watched the harbour.");
    expect(after.version).toBe(before.version);
    expect(after.wordCount).toBe(before.wordCount);
    expect(await db.contentRevision.count()).toBe(revisions);
  });
});

describe("Scene Participation: access", () => {
  it("refuses changes from anyone who can't edit the scene (10)", async () => {
    await addParticipant(ctx, sceneId, { characterId: charlie, pov: true });
    const viewer: AuthorContext = { ...ctx, role: "VIEWER" };
    await expect(addParticipant(viewer, sceneId, { characterId: mara })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(
      updateParticipant(viewer, sceneId, charlie, { pov: false }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      setPointOfView(viewer, sceneId, { characterId: mara, expected: charlie }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(removeParticipant(viewer, sceneId, charlie)).rejects.toBeInstanceOf(
      ForbiddenError,
    );

    // Another workspace can't find the scene or the character at all.
    const other = await createAuthor("Sam");
    const theirs = (await createCharacter(other, { name: "Spy" })).id;
    await expect(addParticipant(other, sceneId, { characterId: theirs })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(addParticipant(ctx, sceneId, { characterId: theirs })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(removeParticipant(other, sceneId, charlie)).rejects.toBeInstanceOf(NotFoundError);
    expect(await cast()).toEqual(["Charlie: PRESENT, POV"]);
  });

  it("keeps identities apart: no character of another pen name or series", async () => {
    const rose = await createPenName(ctx, { name: "Rose Hart" });
    const roseCharacter = (await createCharacter(ctx, { name: "Rosa", penNameId: rose.id })).id;
    await expect(addParticipant(ctx, sceneId, { characterId: roseCharacter })).rejects.toThrow(
      /another pen name/,
    );
    const series = await createSeries(ctx, { title: "Crown" });
    const seriesCharacter = (await createCharacter(ctx, { name: "Kael", seriesId: series.id })).id;
    await expect(addParticipant(ctx, sceneId, { characterId: seriesCharacter })).rejects.toThrow(
      /series/,
    );
  });

  it("reads respect access (11)", async () => {
    await addParticipant(ctx, sceneId, { characterId: charlie, pov: true });
    // May read the manuscript, not the story bible: the scene, but no characters.
    (ROLE_GRANTS as Record<string, unknown>).MANUSCRIPT_READER = {
      identity: [],
      manuscript: ["view"],
      storyBible: [],
      structure: [],
      planning: [],
      workspace: [],
    };
    const reader: AuthorContext = { ...ctx, role: "MANUSCRIPT_READER" as WorkspaceRole };
    expect(await listParticipants(reader, sceneId)).toEqual([]);
    expect(
      (await listParticipationHistory(reader, sceneId)).every((c) => c.character === null),
    ).toBe(true);
    await expect(listCharacterScenes(reader, charlie)).rejects.toBeInstanceOf(NotFoundError);

    const noAccess: AuthorContext = { ...ctx, role: "NO_ACCESS" as WorkspaceRole };
    await expect(listParticipants(noAccess, sceneId)).rejects.toBeInstanceOf(NotFoundError);
    const other = await createAuthor("Sam");
    await expect(listParticipants(other, sceneId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(listCharacterScenes(other, charlie)).rejects.toBeInstanceOf(NotFoundError);
    expect(
      await search(other, { query: "", participant: { characterId: charlie, role: "all" } }).catch(
        (e: unknown) => e,
      ),
    ).toBeInstanceOf(NotFoundError);
  });
});

describe("Scene Participation: history, graph, search, lifecycle", () => {
  it("records every change in the scene's Story History (12)", async () => {
    await addParticipant(ctx, sceneId, { characterId: charlie, presence: "PRESENT" });
    await addParticipant(ctx, sceneId, { characterId: mara, presence: "MENTIONED" });
    await updateParticipant(ctx, sceneId, charlie, { pov: true });
    await updateParticipant(ctx, sceneId, mara, { presence: "PRESENT" });
    await setPointOfView(ctx, sceneId, { characterId: mara, expected: charlie });
    await updateParticipant(ctx, sceneId, mara, { pov: false });
    await removeParticipant(ctx, sceneId, charlie);

    const history = (await listParticipationHistory(ctx, sceneId)).reverse();
    expect(history.map((h) => [h.character?.name, h.from, h.to])).toEqual([
      ["Charlie", null, { presence: "PRESENT", pov: false }], // added
      ["Mara", null, { presence: "MENTIONED", pov: false }], // added
      ["Charlie", { presence: "PRESENT", pov: false }, { presence: "PRESENT", pov: true }], // POV assigned
      ["Mara", { presence: "MENTIONED", pov: false }, { presence: "PRESENT", pov: false }], // changed
      ["Charlie", { presence: "PRESENT", pov: true }, { presence: "PRESENT", pov: false }], // POV handed…
      ["Mara", { presence: "PRESENT", pov: false }, { presence: "PRESENT", pov: true }], // …over
      ["Mara", { presence: "PRESENT", pov: true }, { presence: "PRESENT", pov: false }], // POV removed
      ["Charlie", { presence: "PRESENT", pov: false }, null], // removed
    ]);
    // A record, not earlier text: not in the text history, and not restorable.
    expect(await listFieldHistory(ctx, sceneId)).toEqual([]);
    const entry = await db.fieldRevision.findFirstOrThrow({ where: { nodeId: sceneId } });
    await expect(restoreFieldValue(ctx, entry.id)).rejects.toBeInstanceOf(RuleError);
  });

  it("is part of the Story Graph, from both ends (13)", async () => {
    const chapter = await db.chapter.findFirstOrThrow({ where: { bookId } });
    const later = (await createScene(ctx, chapter.id, "The calm")).id;
    await addParticipant(ctx, sceneId, { characterId: charlie, pov: true });
    await addParticipant(ctx, later, { characterId: charlie, presence: "MENTIONED" });

    const scenes = await listCharacterScenes(ctx, charlie);
    expect(scenes.map((s) => [s.scene.title, s.presence, s.pov])).toEqual([
      ["The storm", "PRESENT", true],
      ["The calm", "MENTIONED", false],
    ]);
    expect(scenes[0].scene).toMatchObject({
      kind: "SCENE",
      href: expect.stringContaining(sceneId),
    });
    expect((await listCharacters(ctx)).find((c) => c.id === charlie)?.sceneCount).toBe(2);
    expect(await auditGraph(ctx)).toEqual([]);
  });

  it("search finds the scenes where a character is POV, present, mentioned or any (14)", async () => {
    const chapter = await db.chapter.findFirstOrThrow({ where: { bookId } });
    const calm = (await createScene(ctx, chapter.id, "The calm")).id;
    const letter = (await createScene(ctx, chapter.id, "The letter")).id;
    await addParticipant(ctx, sceneId, { characterId: charlie, pov: true });
    await addParticipant(ctx, calm, { characterId: charlie });
    await addParticipant(ctx, letter, { characterId: charlie, presence: "MENTIONED" });
    await saveSceneContent(ctx, { sceneId: calm, content: doc("Quiet water."), baseVersion: 0 });

    const titles = async (role: "all" | "pov" | "present" | "mentioned", query = "") =>
      (await search(ctx, { query, participant: { characterId: charlie, role } }))
        .map((r) => r.node.title)
        .sort();
    expect(await titles("all")).toEqual(["The calm", "The letter", "The storm"]);
    expect(await titles("pov")).toEqual(["The storm"]);
    expect(await titles("present")).toEqual(["The calm", "The storm"]);
    expect(await titles("mentioned")).toEqual(["The letter"]);
    // Words narrow the character's scenes.
    expect(await titles("all", "quiet")).toEqual(["The calm"]);
    expect(await titles("mentioned", "quiet")).toEqual([]);
  });

  it("trash and delete don't leak, and never invent anyone (15)", async () => {
    await addParticipant(ctx, sceneId, { characterId: charlie, pov: true });
    await addParticipant(ctx, sceneId, { characterId: mara, presence: "MENTIONED" });

    await trashCharacter(ctx, charlie);
    // Hidden everywhere, history included; nobody replaces Charlie.
    expect(await cast()).toEqual(["Mara: MENTIONED"]);
    const history = await listParticipationHistory(ctx, sceneId);
    expect(history.filter((h) => h.character === null)).toHaveLength(1);
    expect(JSON.stringify(history)).not.toContain("Charlie");
    // The hidden point of view still holds, without naming anyone.
    const refusal = await addParticipant(ctx, sceneId, { characterId: bell, pov: true }).catch(
      (e: Error) => e,
    );
    expect(refusal).toBeInstanceOf(RuleError);
    expect((refusal as Error).message).not.toContain("Charlie");

    // Restoring brings everything back as it was.
    await restoreFromTrash(ctx, "CHARACTER", charlie);
    expect(await cast()).toEqual(["Charlie: PRESENT, POV", "Mara: MENTIONED"]);

    // Deleting forever says what goes, then removes only the appearance.
    await trashCharacter(ctx, charlie);
    const report = await previewDeleteForever(ctx, "CHARACTER", charlie);
    const group = report.groups.find((g) => g.key === "APPEARANCES");
    expect(group?.count).toBe(1);
    expect(group?.items.map((i) => i.title)).toEqual(["The storm"]);
    await deleteForever(ctx, "CHARACTER", charlie, report.token);
    expect(await cast()).toEqual(["Mara: MENTIONED"]);
    expect(await db.sceneParticipation.count({ where: { characterId: charlie } })).toBe(0);
    // The scene has no point of view now; nobody was made POV in Charlie's place.
    expect((await listParticipants(ctx, sceneId)).some((p) => p.pov)).toBe(false);
    expect(await db.scene.count({ where: { id: sceneId } })).toBe(1);
  });
});

describe("Scene Participation: backups", () => {
  it("exports it and restores it; older backups' appearances are upgraded", async () => {
    await addParticipant(ctx, sceneId, { characterId: charlie, pov: true });
    await addParticipant(ctx, sceneId, { characterId: mara, presence: "MENTIONED" });
    const { data } = await exportWorkspaceJson(ctx, { scope: { kind: "all" } });
    expect(data.version).toBe(8);

    // The same backup as an older (version 3) file: appearances as connections.
    const v3 = {
      ...data,
      version: 3,
      sceneParticipations: undefined,
      connections: [
        ...data.connections,
        ...data.sceneParticipations.map((p, i) => ({
          id: `0190a0b0-0000-7000-8000-00000000000${i}`,
          sourceId: p.characterId,
          targetId: p.sceneId,
          kind: "appears_in",
          label: null,
          note: null,
          attributes: { role: p.isPov ? "POV" : p.presence },
          createdAt: p.createdAt,
          updatedAt: p.updatedAt,
        })),
      ],
    };
    for (const file of [data, v3]) {
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
      expect(await cast(other)).toEqual(["Charlie: PRESENT, POV", "Mara: MENTIONED"]);
      expect(await db.connection.count({ where: { kind: "appears_in" } })).toBe(0);
      expect(await auditGraph(other)).toEqual([]);
    }
  });
});
