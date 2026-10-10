import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { ConflictError, NotFoundError, RuleError } from "@/lib/errors";
import { createCharacter } from "@/modules/characters";
import { connect, listConnections } from "@/modules/connections";
import { exportWorkspaceJson } from "@/modules/exports";
import { listFieldHistory, listSettingHistory } from "@/modules/history";
import { applyIdentityMove, previewIdentityMove } from "@/modules/impact";
import { reviewImport, runImport } from "@/modules/imports";
import { createBook, createSeries, previewBookSeries, setBookSeries } from "@/modules/library";
import {
  createChapter,
  createScene,
  getSceneForEditor,
  saveSceneContent,
  trashScene,
} from "@/modules/manuscript";
import { createPenName } from "@/modules/pen-names";
import { search } from "@/modules/search";
import {
  listPlaceScenes,
  listScenePlaces,
  removeScenePlace,
  setSceneInNewPlace,
  setScenePlace,
} from "@/modules/setting";
import { auditGraph, resolveNode } from "@/modules/story-graph";
import { deleteForever, previewDeleteForever, restoreFromTrash } from "@/modules/trash";
import {
  createPlace,
  createWorldEntry,
  getPlace,
  getWorldEntry,
  listPlaces,
  listWorldEntryTypes,
  trashPlace,
  updatePlace,
  updateWorldEntry,
} from "@/modules/world";
import type { AuthorContext } from "@/server/context";

import { createAuthor, resetDatabase } from "../support/db";

/**
 * M15 World objects (decision 113): places and world entries are story
 * objects of one pen name (optionally one of its series); a scene's setting
 * is a dedicated relationship, the author's statement, kept in the scene's
 * Story History.
 */

let ctx: AuthorContext;
let bookId: string;
let chapterId: string;
let sceneA: string;
let sceneB: string;

const doc = (text: string) => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

beforeEach(async () => {
  await resetDatabase();
  ctx = await createAuthor("Jane");
  bookId = (await createBook(ctx, { title: "Harbour Lights" })).id;
  chapterId = (await createChapter(ctx, bookId, { title: "Arrival" })).id;
  sceneA = (await createScene(ctx, chapterId, "The storm")).id;
  sceneB = (await createScene(ctx, chapterId, "The calm")).id;
});

const titles = (nodes: { title: string }[]) => nodes.map((n) => n.title);

describe("places and world entries", () => {
  it("are created, edited with summary history, and refuse stale forms", async () => {
    const { id } = await createPlace(ctx, { name: "Saltmarsh", summary: "A grey harbour." });
    const before = await getPlace(ctx, id);
    await updatePlace(
      ctx,
      id,
      { name: "Saltmarsh Quay", summary: "A grey harbour, at dusk." },
      { expectedUpdatedAt: before.updatedAt.toISOString() },
    );
    expect((await getPlace(ctx, id)).name).toBe("Saltmarsh Quay");
    expect((await listFieldHistory(ctx, id)).map((r) => r.value)).toEqual(["A grey harbour."]);
    await expect(
      updatePlace(
        ctx,
        id,
        { name: "Old form", summary: null },
        { expectedUpdatedAt: before.updatedAt.toISOString() },
      ),
    ).rejects.toBeInstanceOf(ConflictError);

    const guild = await createWorldEntry(ctx, {
      name: "Lanternwrights",
      entryType: "  Guild ",
      summary: "Keepers of the lamps.",
    });
    const entry = await getWorldEntry(ctx, guild.id);
    expect(entry.entryType).toBe("Guild");
    await updateWorldEntry(ctx, guild.id, { name: "Lanternwrights", entryType: "Organization" });
    expect((await getWorldEntry(ctx, guild.id)).entryType).toBe("Organization");
    expect((await listFieldHistory(ctx, guild.id)).map((r) => r.value)).toEqual([
      "Keepers of the lamps.",
    ]);
    // Suggestions first, then the author's own types, without repeats.
    await createWorldEntry(ctx, { name: "The Brass Key", entryType: "artifact" });
    expect(await listWorldEntryTypes(ctx)).toEqual(["Organization", "Item", "artifact"]);
  });

  it("are found by name, never across workspaces", async () => {
    const place = await createPlace(ctx, { name: "Saltmarsh" });
    const entry = await createWorldEntry(ctx, { name: "Lanternwrights", entryType: "Item" });
    const hits = async (who: AuthorContext, query: string) =>
      (await search(who, { query })).map((r) => r.node.id);
    expect(await hits(ctx, "Saltmarsh")).toContain(place.id);
    expect(await hits(ctx, "Lanternwrights")).toContain(entry.id);

    const other = await createAuthor("Sam");
    expect(await hits(other, "Saltmarsh")).toEqual([]);
    expect(await resolveNode(other, place.id)).toBeNull();
    await expect(getPlace(other, place.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("link within their pen name only", async () => {
    const entry = await createWorldEntry(ctx, {
      name: "Lanternwrights",
      entryType: "Organization",
    });
    const mara = await createCharacter(ctx, { name: "Mara" });
    await connect(ctx, { sourceId: entry.id, targetId: mara.id, kind: "related" });
    expect(titles((await listConnections(ctx, entry.id)).map((c) => c.other))).toEqual(["Mara"]);

    const rose = await createPenName(ctx, { name: "Rose" });
    const elsewhere = await createCharacter(ctx, { name: "Theo", penNameId: rose.id });
    await expect(
      connect(ctx, { sourceId: entry.id, targetId: elsewhere.id, kind: "related" }),
    ).rejects.toBeInstanceOf(RuleError);
  });
});

describe("Scene Setting", () => {
  it("sets scenes in a place, lists them in order, and keeps every change in the scene's history", async () => {
    const harbour = await createPlace(ctx, { name: "Saltmarsh" });
    const lighthouse = await createPlace(ctx, { name: "The lighthouse" });
    await setScenePlace(ctx, sceneB, harbour.id);
    await setScenePlace(ctx, sceneA, harbour.id);
    await setScenePlace(ctx, sceneA, lighthouse.id);

    expect(titles(await listPlaceScenes(ctx, harbour.id))).toEqual(["The storm", "The calm"]);
    expect(titles(await listScenePlaces(ctx, sceneA))).toEqual(["Saltmarsh", "The lighthouse"]);
    expect((await listPlaces(ctx)).map((p) => [p.name, p.sceneCount])).toEqual([
      ["Saltmarsh", 2],
      ["The lighthouse", 1],
    ]);
    await expect(setScenePlace(ctx, sceneA, harbour.id)).rejects.toBeInstanceOf(ConflictError);

    await removeScenePlace(ctx, sceneA, lighthouse.id);
    expect(titles(await listScenePlaces(ctx, sceneA))).toEqual(["Saltmarsh"]);
    const history = await listSettingHistory(ctx, sceneA);
    expect(history.map((h) => [h.place?.name, h.change])).toEqual([
      ["The lighthouse", "REMOVED"],
      ["The lighthouse", "SET"],
      ["Saltmarsh", "SET"],
    ]);
    // A record, not earlier text: not in the scene's text field history.
    expect(await listFieldHistory(ctx, sceneA)).toEqual([]);
    expect(await auditGraph(ctx)).toEqual([]);
  });

  it("never touches the scene's text", async () => {
    const { id: placeId } = await setSceneInNewPlace(ctx, sceneA, "  Saltmarsh ");
    const before = (await getSceneForEditor(ctx, sceneA)).scene;
    await saveSceneContent(ctx, {
      sceneId: sceneA,
      content: doc("Rain on the quay."),
      baseVersion: before.version,
    });
    const saved = (await getSceneForEditor(ctx, sceneA)).scene;
    await removeScenePlace(ctx, sceneA, placeId);
    await setScenePlace(ctx, sceneA, placeId);
    const after = (await getSceneForEditor(ctx, sceneA)).scene;
    expect(after.content).toEqual(saved.content);
    expect(after.version).toBe(saved.version);
    expect((await getPlace(ctx, placeId)).name).toBe("Saltmarsh");
  });

  it("keeps identities apart: same pen name, and a series' places only in its books", async () => {
    const rose = await createPenName(ctx, { name: "Rose" });
    const foreign = await createPlace(ctx, { name: "Elsewhere", penNameId: rose.id });
    await expect(setScenePlace(ctx, sceneA, foreign.id)).rejects.toBeInstanceOf(RuleError);

    const series = await createSeries(ctx, { title: "Crown of Ash" });
    const capital = await createPlace(ctx, { name: "Ashgate", seriesId: series.id });
    await expect(setScenePlace(ctx, sceneA, capital.id)).rejects.toBeInstanceOf(RuleError);

    // A place created from a scene joins the scene's pen name and series.
    const ember = await createBook(ctx, { title: "Ember", seriesId: series.id });
    const ch = await createChapter(ctx, ember.id, { title: "One" });
    const s = await createScene(ctx, ch.id, "Smoke");
    await setScenePlace(ctx, s.id, capital.id);
    const { id } = await setSceneInNewPlace(ctx, s.id, "The ash road");
    expect((await getPlace(ctx, id)).series?.id).toBe(series.id);

    // Its series can't change while scenes outside the new series are set there.
    const plain = await createPlace(ctx, { name: "Harbour" });
    await setScenePlace(ctx, sceneA, plain.id);
    await expect(
      updatePlace(ctx, plain.id, { name: "Harbour", seriesId: series.id }),
    ).rejects.toBeInstanceOf(RuleError);
    // Nor its pen name while it is linked.
    await expect(
      updatePlace(ctx, plain.id, { name: "Harbour", penNameId: rose.id }),
    ).rejects.toBeInstanceOf(RuleError);
    // Unlinked, it may change pen name.
    const loose = await createPlace(ctx, { name: "Nowhere" });
    await updatePlace(ctx, loose.id, { name: "Nowhere", penNameId: rose.id });
    expect((await getPlace(ctx, loose.id)).penNameId).toBe(rose.id);
    expect(await auditGraph(ctx)).toEqual([]);
  });

  it("follows the Trash: hidden while trashed, back when restored, never removed", async () => {
    const harbour = await createPlace(ctx, { name: "Saltmarsh" });
    await setScenePlace(ctx, sceneA, harbour.id);
    await setScenePlace(ctx, sceneB, harbour.id);

    await trashScene(ctx, sceneB);
    expect(titles(await listPlaceScenes(ctx, harbour.id))).toEqual(["The storm"]);
    expect((await listPlaces(ctx))[0].sceneCount).toBe(1);
    await restoreFromTrash(ctx, "SCENE", sceneB);
    expect(titles(await listPlaceScenes(ctx, harbour.id))).toEqual(["The storm", "The calm"]);

    await trashPlace(ctx, harbour.id);
    expect(await listScenePlaces(ctx, sceneA)).toEqual([]);
    expect(await db.sceneSetting.count({ where: { placeId: harbour.id } })).toBe(2);
    await restoreFromTrash(ctx, "PLACE", harbour.id);
    expect(titles(await listScenePlaces(ctx, sceneA))).toEqual(["Saltmarsh"]);
    expect(await auditGraph(ctx)).toEqual([]);
  });

  it("deleting a place forever lists its scene settings; the scenes stay", async () => {
    const harbour = await createPlace(ctx, { name: "Saltmarsh" });
    await setScenePlace(ctx, sceneA, harbour.id);
    await setScenePlace(ctx, sceneB, harbour.id);
    await trashPlace(ctx, harbour.id);
    const report = await previewDeleteForever(ctx, "PLACE", harbour.id);
    const settings = report.groups.find((g) => g.key === "SETTINGS");
    expect(settings?.count).toBe(2);
    expect(settings?.items.map((i) => i.title).sort()).toEqual(["The calm", "The storm"]);
    await deleteForever(ctx, "PLACE", harbour.id, report.token);
    expect(await db.sceneSetting.count()).toBe(0);
    expect(await db.scene.count({ where: { id: { in: [sceneA, sceneB] } } })).toBe(2);
    expect(await auditGraph(ctx)).toEqual([]);
  });
});

describe("Change Impact", () => {
  it("a book moving to another pen name takes its places and linked world entries along", async () => {
    const harbour = await createPlace(ctx, { name: "Saltmarsh" });
    await setScenePlace(ctx, sceneA, harbour.id);
    const guild = await createWorldEntry(ctx, {
      name: "Lanternwrights",
      entryType: "Organization",
    });
    await connect(ctx, { sourceId: guild.id, targetId: harbour.id, kind: "related" });
    const unrelated = await createPlace(ctx, { name: "Nowhere" });
    const rose = await createPenName(ctx, { name: "Rose" });

    const move = { kind: "BOOK" as const, id: bookId, toPenNameId: rose.id };
    const report = await previewIdentityMove(ctx, move);
    expect(report.blockers).toEqual([]);
    expect(report.groups.find((g) => g.key === "WORLD")?.items.map((i) => i.title)).toEqual([
      "Lanternwrights",
      "Saltmarsh",
    ]);
    await applyIdentityMove(ctx, move, report.token);
    expect((await getPlace(ctx, harbour.id)).penNameId).toBe(rose.id);
    expect((await getWorldEntry(ctx, guild.id)).penNameId).toBe(rose.id);
    expect((await getPlace(ctx, unrelated.id)).penNameId).not.toBe(rose.id);
    expect(await auditGraph(ctx)).toEqual([]);
  });

  it("a place of another series blocks the move; nothing moves", async () => {
    const series = await createSeries(ctx, { title: "Crown of Ash" });
    const capital = await createPlace(ctx, { name: "Ashgate", seriesId: series.id });
    const harbour = await createPlace(ctx, { name: "Saltmarsh" });
    await setScenePlace(ctx, sceneA, harbour.id);
    await connect(ctx, { sourceId: harbour.id, targetId: capital.id, kind: "related" });
    const rose = await createPenName(ctx, { name: "Rose" });
    const report = await previewIdentityMove(ctx, {
      kind: "BOOK",
      id: bookId,
      toPenNameId: rose.id,
    });
    expect(report.blockers.map((b) => b.title)).toEqual(["Ashgate"]);
    await expect(
      applyIdentityMove(ctx, { kind: "BOOK", id: bookId, toPenNameId: rose.id }, report.token),
    ).rejects.toBeInstanceOf(RuleError);
    expect((await getPlace(ctx, harbour.id)).penNameId).not.toBe(rose.id);
  });

  it("a book can't leave a series while its scenes are set in that series' places", async () => {
    const series = await createSeries(ctx, { title: "Crown of Ash" });
    const ember = await createBook(ctx, { title: "Ember", seriesId: series.id });
    const ch = await createChapter(ctx, ember.id, { title: "One" });
    const s = await createScene(ctx, ch.id, "Smoke");
    const capital = await createPlace(ctx, { name: "Ashgate", seriesId: series.id });
    await setScenePlace(ctx, s.id, capital.id);
    const report = await previewBookSeries(ctx, ember.id, null);
    expect(report.blockers.map((b) => b.title)).toEqual(["Ashgate"]);
    await expect(setBookSeries(ctx, ember.id, null, report.token)).rejects.toBeInstanceOf(
      RuleError,
    );
    expect(titles(await listScenePlaces(ctx, s.id))).toEqual(["Ashgate"]);
  });
});

describe("backups (format 8)", () => {
  const file = (data: unknown) => ({
    sourceId: "authoros-json",
    filename: "b.json",
    bytes: new TextEncoder().encode(JSON.stringify(data)),
  });

  it("export world objects and scene settings, and restore them with their ids", async () => {
    const harbour = await createPlace(ctx, { name: "Saltmarsh", summary: "Grey." });
    await setScenePlace(ctx, sceneA, harbour.id);
    const guild = await createWorldEntry(ctx, { name: "Lanternwrights", entryType: "Guild" });
    await connect(ctx, { sourceId: guild.id, targetId: harbour.id, kind: "related" });
    const { data } = await exportWorkspaceJson(ctx, { scope: { kind: "all" } });
    expect(data.version).toBe(8);
    expect(data.places).toEqual([expect.objectContaining({ id: harbour.id, name: "Saltmarsh" })]);
    expect(data.worldEntries).toEqual([
      expect.objectContaining({ id: guild.id, entryType: "Guild" }),
    ]);
    expect(data.sceneSettings).toEqual([
      expect.objectContaining({ sceneId: sceneA, placeId: harbour.id }),
    ]);

    await resetDatabase();
    const other = await createAuthor("Jane");
    const review = await reviewImport(other, file(data));
    expect(review.errors).toEqual([]);
    expect(review.conflicts).toEqual([]);
    await runImport(other, file(data), { token: review.token! });
    expect((await getPlace(other, harbour.id)).summary).toBe("Grey.");
    expect((await getWorldEntry(other, guild.id)).entryType).toBe("Guild");
    expect(titles(await listPlaceScenes(other, harbour.id))).toEqual(["The storm"]);
    expect(await auditGraph(other)).toEqual([]);

    // Importing the same file again has nothing to add.
    const again = await reviewImport(other, file(data));
    expect(again.canImport).toBe(false);
    expect(again.summary).toMatch(/already here/);
    expect(await db.sceneSetting.count()).toBe(1);
  });

  it("older files (format 7) still import, without world objects", async () => {
    const { data } = await exportWorkspaceJson(ctx, { scope: { kind: "all" } });
    const old: Record<string, unknown> = { ...data, version: 7 };
    delete old.places;
    delete old.worldEntries;
    delete old.sceneSettings;
    await resetDatabase();
    const other = await createAuthor("Jane");
    const review = await reviewImport(other, file(old));
    expect(review.errors).toEqual([]);
    await runImport(other, file(old), { token: review.token! });
    expect(titles(await listScenePlaces(other, sceneA))).toEqual([]);
    expect(await auditGraph(other)).toEqual([]);
  });

  it("refuse a file whose scene is set in a place of another pen name", async () => {
    const rose = await createPenName(ctx, { name: "Rose" });
    const foreign = await createPlace(ctx, { name: "Elsewhere", penNameId: rose.id });
    const { data } = await exportWorkspaceJson(ctx, { scope: { kind: "all" } });
    const bad = { ...data, sceneSettings: [{ sceneId: sceneA, placeId: foreign.id }] };
    await resetDatabase();
    const other = await createAuthor("Jane");
    const review = await reviewImport(other, file(bad));
    expect(review.errors.join(" ")).toContain("another pen name");
  });
});
