import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { WorkspaceRole } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { ConflictError, ForbiddenError, NotFoundError, RuleError } from "@/lib/errors";
import { createCharacter, trashCharacter } from "@/modules/characters";
import { connect } from "@/modules/connections";
import { exportWorkspaceJson } from "@/modules/exports";
import { listFieldHistory, restoreFieldValue } from "@/modules/history";
import { reviewImport, runImport } from "@/modules/imports";
import { createBook, createSeries } from "@/modules/library";
import { createNote } from "@/modules/notes";
import { createPenName } from "@/modules/pen-names";
import { createRelationship } from "@/modules/relationships";
import { search } from "@/modules/search";
import { auditGraph, resolveNode } from "@/modules/story-graph";
import { createOutline } from "@/modules/structure";
import { previewDeleteForever, restoreFromTrash } from "@/modules/trash";
import {
  addTrope,
  createTrope,
  deleteTropeForever,
  getTrope,
  listTropes,
  removeTrope,
  restoreTrope,
  trashTrope,
  tropesOf,
  updateTrope,
} from "@/modules/tropes";
import type { AuthorContext } from "@/server/context";
import { ROLE_GRANTS } from "@/server/policy";

import { createAuthor, resetDatabase } from "../support/db";

/** M13 Tropes (decision 110): shared trope objects linked by `uses_trope`. */

let ctx: AuthorContext;
let bookId: string;

beforeEach(async () => {
  await resetDatabase();
  ctx = await createAuthor("Jane");
  bookId = (await createBook(ctx, { title: "Harbour Lights" })).id;
});

afterEach(() => {
  delete (ROLE_GRANTS as Record<string, unknown>).MANUSCRIPT_READER;
});

const names = async (nodeId: string, as = ctx) => (await tropesOf(as, nodeId)).map((t) => t.name);

describe("Tropes: objects", () => {
  it("creates a trope once per name, ignoring case and surrounding spaces", async () => {
    const a = await createTrope(ctx, { name: "Enemies to lovers" });
    const b = await createTrope(ctx, { name: "  enemies TO lovers " });
    expect(a.created).toBe(true);
    expect(b).toEqual({ id: a.id, created: false });
    expect((await listTropes(ctx)).map((t) => t.name)).toEqual(["Enemies to lovers"]);
    await expect(createTrope(ctx, { name: "   " })).rejects.toThrow(/name/);
  });

  it("restores an earlier description from its history (M13 manual-test regression)", async () => {
    const t = await createTrope(ctx, { name: "Slow burn" });
    await updateTrope(ctx, t.id, { name: "Slow burn", description: "First take." });
    await updateTrope(ctx, t.id, { name: "Slow burn", description: "Second take." });

    // The earlier version the "Earlier versions" dialog lists…
    const [earlier] = await listFieldHistory(ctx, t.id);
    expect(earlier).toMatchObject({ field: "description", value: "First take." });

    // …is restored, exactly.
    await restoreFieldValue(ctx, earlier.id);
    const restored = await getTrope(ctx, t.id);
    expect(restored.description).toBe("First take.");
    expect(restored.name).toBe("Slow burn");

    // The restore is in the existing history: the replaced value is kept as
    // "before restore", newest first, so the restore can be undone too.
    const history = await listFieldHistory(ctx, t.id);
    expect(history.map((h) => [h.field, h.value, h.source])).toEqual([
      ["description", "Second take.", "BEFORE_RESTORE"],
      ["description", "First take.", "BEFORE_EDIT"],
    ]);
    await restoreFieldValue(ctx, history[0].id);
    expect((await getTrope(ctx, t.id)).description).toBe("Second take.");

    // Restoring needs story-bible edit rights, as before.
    await expect(
      restoreFieldValue({ ...ctx, role: "VIEWER" }, history[1].id),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("renames and describes (description history), refusing a taken name and stale forms", async () => {
    const t = await createTrope(ctx, { name: "Fake dating" });
    await createTrope(ctx, { name: "Slow burn" });
    await updateTrope(ctx, t.id, { name: "Fake relationship", description: "A contract." });
    await updateTrope(ctx, t.id, {
      name: "Fake relationship",
      description: "A contract with a clause.",
    });
    expect((await listFieldHistory(ctx, t.id)).map((h) => h.value)).toEqual(["A contract."]);
    await expect(updateTrope(ctx, t.id, { name: "SLOW BURN" })).rejects.toBeInstanceOf(RuleError);

    const { updatedAt } = await getTrope(ctx, t.id);
    await updateTrope(ctx, t.id, { name: "Fake relationship" }, { expectedUpdatedAt: updatedAt });
    await expect(
      updateTrope(ctx, t.id, { name: "Fake romance" }, { expectedUpdatedAt: updatedAt }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("is a story object: found, searched, connected and in the audit", async () => {
    const t = await createTrope(ctx, { name: "Found family" });
    expect(await resolveNode(ctx, t.id)).toMatchObject({
      kind: "TROPE",
      href: `/tropes/${t.id}`,
      penNameId: null,
    });
    expect((await search(ctx, { query: "found family" })).map((r) => r.node.id)).toContain(t.id);
    const note = await createNote(ctx, { title: "Why found family works" });
    await connect(ctx, { sourceId: note.id, targetId: t.id, kind: "about" });
    expect(await auditGraph(ctx)).toEqual([]);
  });
});

describe("Tropes: links", () => {
  it("links to books, series, relationships and structures; nothing else", async () => {
    const series = await createSeries(ctx, { title: "Crown" });
    const [a, b] = await Promise.all(
      ["Mara", "Theo"].map(async (name) => (await createCharacter(ctx, { name })).id),
    );
    const couple = await createRelationship(ctx, { characterIds: [a, b], type: "Romance" });
    const arc = await createOutline(ctx, { bookId, kind: "PLOT", title: "Plot" });
    const t = await createTrope(ctx, { name: "Second chance" });
    for (const target of [bookId, series.id, couple.id, arc.id])
      await addTrope(ctx, target, { tropeId: t.id });
    // Adding it again changes nothing.
    await addTrope(ctx, bookId, { tropeId: t.id });
    expect((await getTrope(ctx, t.id)).usedIn.map((n) => n.kind).sort()).toEqual([
      "BOOK",
      "OUTLINE",
      "RELATIONSHIP",
      "SERIES",
    ]);
    expect(await db.connection.count({ where: { kind: "uses_trope" } })).toBe(4);

    // A character, a note or a scene can't use a trope.
    await expect(addTrope(ctx, a, { tropeId: t.id })).rejects.toBeInstanceOf(RuleError);
    const note = await createNote(ctx, { title: "N" });
    await expect(
      connect(ctx, { sourceId: note.id, targetId: t.id, kind: "uses_trope" }),
    ).rejects.toBeInstanceOf(RuleError);
  });

  it("adds by name (existing, common or new) and removes, leaving both objects", async () => {
    await createTrope(ctx, { name: "Slow burn" });
    await addTrope(ctx, bookId, { name: "slow BURN" });
    await addTrope(ctx, bookId, { name: "Forced proximity" });
    expect(await names(bookId)).toEqual(["Forced proximity", "Slow burn"]);
    expect(await db.trope.count()).toBe(2);
    const slow = (await listTropes(ctx)).find((t) => t.name === "Slow burn")!;
    await removeTrope(ctx, bookId, slow.id);
    expect(await names(bookId)).toEqual(["Forced proximity"]);
    expect(await db.trope.count()).toBe(2);
    await expect(removeTrope(ctx, bookId, slow.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("is shared by every pen name", async () => {
    const rose = await createPenName(ctx, { name: "Rose Hart" });
    const roseBook = await createBook(ctx, { title: "Rose book", penNameId: rose.id });
    const t = await createTrope(ctx, { name: "Small town" });
    await addTrope(ctx, bookId, { tropeId: t.id });
    await addTrope(ctx, roseBook.id, { tropeId: t.id });
    expect((await getTrope(ctx, t.id)).usedIn.map((n) => n.title).sort()).toEqual([
      "Harbour Lights",
      "Rose book",
    ]);
  });
});

describe("Tropes: access", () => {
  it("story-bible editors change tropes; viewers and other workspaces can't", async () => {
    const t = await createTrope(ctx, { name: "Heist" });
    const viewer: AuthorContext = { ...ctx, role: "VIEWER" };
    for (const change of [
      () => createTrope(viewer, { name: "X" }),
      () => updateTrope(viewer, t.id, { name: "Y" }),
      () => addTrope(viewer, bookId, { tropeId: t.id }),
      () => removeTrope(viewer, bookId, t.id),
      () => trashTrope(viewer, t.id),
      () => restoreTrope(viewer, t.id),
    ])
      await expect(change()).rejects.toBeInstanceOf(ForbiddenError);
    expect((await getTrope(viewer, t.id)).name).toBe("Heist");

    const editor: AuthorContext = { ...ctx, role: "EDITOR" };
    await addTrope(editor, bookId, { tropeId: t.id });
    await trashTrope(editor, t.id);
    await restoreTrope(editor, t.id);
    // Delete forever stays with the owner (workspace management).
    await trashTrope(editor, t.id);
    await expect(deleteTropeForever(editor, t.id, "x")).rejects.toBeInstanceOf(ForbiddenError);

    const other = await createAuthor("Sam");
    await expect(getTrope(other, t.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(addTrope(other, bookId, { tropeId: t.id })).rejects.toBeInstanceOf(NotFoundError);
    expect(await listTropes(other)).toEqual([]);
  });

  it("never names what the reader can't see", async () => {
    const t = await createTrope(ctx, { name: "Enemies to lovers" });
    const [a, b] = await Promise.all(
      ["Mara", "Theo"].map(async (name) => (await createCharacter(ctx, { name })).id),
    );
    const couple = await createRelationship(ctx, { characterIds: [a, b], type: "Rivals" });
    await addTrope(ctx, bookId, { tropeId: t.id });
    await addTrope(ctx, couple.id, { tropeId: t.id });
    await trashCharacter(ctx, a); // hides the relationship
    expect((await getTrope(ctx, t.id)).usedIn.map((n) => n.title)).toEqual(["Harbour Lights"]);

    (ROLE_GRANTS as Record<string, unknown>).MANUSCRIPT_READER = {
      identity: [],
      manuscript: ["view"],
      storyBible: [],
      structure: [],
      planning: [],
      workspace: [],
    };
    const reader = { ...ctx, role: "MANUSCRIPT_READER" as WorkspaceRole };
    await expect(listTropes(reader)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(getTrope(reader, t.id)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("Tropes: Trash and delete forever", () => {
  it("trash hides the trope and its links; restore brings them back", async () => {
    const t = await createTrope(ctx, { name: "Slow burn" });
    await addTrope(ctx, bookId, { tropeId: t.id });
    await trashTrope(ctx, t.id);
    expect(await names(bookId)).toEqual([]);
    expect(await listTropes(ctx)).toEqual([]);
    await restoreTrope(ctx, t.id);
    expect(await names(bookId)).toEqual(["Slow burn"]);
  });

  it("a trashed name can be reused; restoring then waits until the name is free", async () => {
    const old = await createTrope(ctx, { name: "Slow burn" });
    await trashTrope(ctx, old.id);
    const fresh = await createTrope(ctx, { name: "slow burn" });
    expect(fresh.created).toBe(true);
    await expect(restoreTrope(ctx, old.id)).rejects.toThrow(/already a trope called/);
    await expect(restoreFromTrash(ctx, "TROPE", old.id)).rejects.toBeInstanceOf(RuleError);
    await updateTrope(ctx, fresh.id, { name: "Slow, slow burn" });
    await restoreTrope(ctx, old.id);
    expect((await listTropes(ctx)).map((t) => t.name)).toEqual(["Slow burn", "Slow, slow burn"]);
  });

  it("deleting forever is reviewed (Red), removes the links and keeps the books", async () => {
    const t = await createTrope(ctx, { name: "Second chance" });
    await addTrope(ctx, bookId, { tropeId: t.id });
    await trashTrope(ctx, t.id);
    const report = await previewDeleteForever(ctx, "TROPE", t.id);
    expect(report.level).toBe("red");
    expect(report.groups.find((g) => g.key === "LINKS")?.items.map((i) => i.title)).toEqual([
      "Harbour Lights",
    ]);
    await expect(deleteTropeForever(ctx, t.id, "")).rejects.toThrow(/Review/);
    await deleteTropeForever(ctx, t.id, report.token);
    expect(await db.trope.count()).toBe(0);
    expect(await db.connection.count({ where: { kind: "uses_trope" } })).toBe(0);
    expect(await db.book.count({ where: { id: bookId } })).toBe(1);
  });
});

describe("Tropes: backups (format 6)", () => {
  const file = (data: unknown) => ({
    sourceId: "authoros-json",
    filename: "b.json",
    bytes: new TextEncoder().encode(JSON.stringify(data)),
  });

  async function restore(author: AuthorContext, data: unknown) {
    const review = await reviewImport(author, file(data));
    expect(review.errors).toEqual([]);
    expect(review.conflicts).toEqual([]);
    await runImport(author, file(data), { token: review.token! });
    return review;
  }

  it("exports tropes and their links, and restores them as they were", async () => {
    const t = await createTrope(ctx, { name: "Slow burn", description: "Mine is very slow." });
    await addTrope(ctx, bookId, { tropeId: t.id });
    const { data } = await exportWorkspaceJson(ctx, { scope: { kind: "all" } });
    expect(data.version).toBe(9);
    expect(data.tropes).toEqual([expect.objectContaining({ id: t.id, name: "Slow burn" })]);
    expect(data.books[0]).not.toHaveProperty("tropes");
    expect(data.connections.filter((c) => c.kind === "uses_trope")).toHaveLength(1);

    await resetDatabase();
    const other = await createAuthor("Jane");
    await restore(other, data);
    expect(await names(bookId, other)).toEqual(["Slow burn"]);
    expect((await getTrope(other, t.id)).description).toBe("Mine is very slow.");
    expect(await auditGraph(other)).toEqual([]);
  });

  it("upgrades older files: book trope text becomes tropes, merged by name; existing tropes are reused", async () => {
    const second = (await createBook(ctx, { title: "Second book" })).id;
    const { data } = await exportWorkspaceJson(ctx, { scope: { kind: "all" } });
    // The same backup as a version 5 file, with tropes as text on books.
    const v5 = {
      ...data,
      version: 5,
      tropes: undefined,
      books: data.books.map((b) => ({
        ...b,
        tropes:
          b.id === bookId
            ? ["Enemies to lovers", " slow burn ", "", "Enemies to Lovers"]
            : ["enemies to lovers", "Found family"],
      })),
    };

    await resetDatabase();
    const other = await createAuthor("Jane");
    // This workspace already has "Found family": it is reused, not doubled.
    const found = await createTrope(other, { name: "FOUND FAMILY" });
    const review = await restore(other, v5);
    expect(review.adjustments.join(" ")).toMatch(/existing trope/);
    expect((await listTropes(other)).map((t) => t.name)).toEqual([
      "Enemies to Lovers",
      "FOUND FAMILY",
      "slow burn",
    ]);
    // Three spellings used once each: the first in byte order names the trope.
    expect(await names(bookId, other)).toEqual(["Enemies to Lovers", "slow burn"]);
    expect(await names(second, other)).toEqual(["Enemies to Lovers", "FOUND FAMILY"]);
    expect((await getTrope(other, found.id)).usedIn.map((n) => n.id)).toEqual([second]);

    // Version 1-4 files go through the same chain.
    await resetDatabase();
    const third = await createAuthor("Jane");
    await restore(third, { ...v5, version: 4, sceneParticipations: undefined });
    expect(await names(bookId, third)).toEqual(["Enemies to Lovers", "slow burn"]);
  });

  it("refuses a file with the same trope twice", async () => {
    const t = await createTrope(ctx, { name: "Slow burn" });
    const { data } = await exportWorkspaceJson(ctx, { scope: { kind: "all" } });
    const twice = {
      ...data,
      tropes: [...data.tropes, { ...data.tropes[0], id: crypto.randomUUID(), name: "SLOW BURN" }],
    };
    twice.storyNodes = [...data.storyNodes, { id: twice.tropes[1].id, kind: "TROPE" }];
    const review = await reviewImport(ctx, file(twice));
    expect(review.errors.join(" ")).toMatch(/listed twice/);
    expect(t.id).toBeTruthy();
  });
});
