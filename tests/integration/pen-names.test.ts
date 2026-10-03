import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { RuleError } from "@/lib/errors";
import { createBook, createSeries, listLibrary } from "@/modules/library";
import {
  archivePenName,
  createPenName,
  getActivePenName,
  getDefaultPenName,
  getPenNameForNewWork,
  listIdentities,
  listPenNames,
  restorePenName,
  setActiveIdentity,
  setDefaultPenName,
  updatePenName,
} from "@/modules/pen-names";
import { findPrimaryMembership } from "@/modules/workspaces";
import type { AuthorContext } from "@/server/context";

import { createAuthor, resetDatabase } from "../support/db";

let ctx: AuthorContext;

beforeEach(async () => {
  await resetDatabase();
  ctx = await createAuthor("Jane Austen");
});

/** Re-reads the context the way requireAuthorContext would. */
async function refresh(c: AuthorContext): Promise<AuthorContext> {
  const m = await findPrimaryMembership(c.userId);
  return { ...c, ...m! };
}

describe("pen names", () => {
  it("creates, edits and lists pen names with the default first", async () => {
    const mystery = await createPenName(ctx, { name: "  J. A. Mystery  ", bio: "" });
    expect(mystery).toMatchObject({ name: "J. A. Mystery", bio: null, isDefault: false });

    await updatePenName(ctx, mystery.id, { name: "Jay Mystery", bio: "Cosy crime." });
    const names = await listPenNames(ctx);
    expect(names.map((p) => p.name)).toEqual(["Jane Austen", "Jay Mystery"]);
    expect(names[1].bio).toBe("Cosy crime.");
  });

  it("validates input", async () => {
    await expect(createPenName(ctx, { name: "   " })).rejects.toThrow();
  });

  it("switches the default", async () => {
    const other = await createPenName(ctx, { name: "Other" });
    await setDefaultPenName(ctx, other.id);
    expect((await getDefaultPenName(ctx)).id).toBe(other.id);
    expect((await listPenNames(ctx)).filter((p) => p.isDefault)).toHaveLength(1);
  });

  it("will not archive the default, and will not make an archived name default", async () => {
    const def = await getDefaultPenName(ctx);
    await expect(archivePenName(ctx, def.id)).rejects.toBeInstanceOf(RuleError);

    const other = await createPenName(ctx, { name: "Other" });
    await archivePenName(ctx, other.id);
    await expect(setDefaultPenName(ctx, other.id)).rejects.toBeInstanceOf(RuleError);
  });

  it("archives and restores, keeping the work attributed", async () => {
    const other = await createPenName(ctx, { name: "Other" });
    const book = await createBook(ctx, { title: "Kept", penNameId: other.id });

    await archivePenName(ctx, other.id);
    expect((await listPenNames(ctx)).map((p) => p.name)).toEqual(["Jane Austen"]);
    expect(await listPenNames(ctx, { includeArchived: true })).toHaveLength(2);
    const all = await listLibrary(ctx, { penNameId: null });
    expect(all.standalone.find((b) => b.id === book.id)?.penName.name).toBe("Other");

    // Archived names can't receive new work.
    await expect(createBook(ctx, { title: "New", penNameId: other.id })).rejects.toBeInstanceOf(
      RuleError,
    );

    await restorePenName(ctx, other.id);
    await createBook(ctx, { title: "New", penNameId: other.id });
  });

  it("reports how much work each identity holds", async () => {
    const other = await createPenName(ctx, { name: "Other" });
    const series = await createSeries(ctx, { title: "Saga", penNameId: other.id });
    await createBook(ctx, { title: "One", seriesId: series.id });
    await createBook(ctx, { title: "Two", penNameId: other.id });
    await createBook(ctx, { title: "Mine" });

    const identities = await listIdentities(ctx);
    expect(identities.map((i) => [i.name, i.seriesCount, i.bookCount])).toEqual([
      ["Jane Austen", 0, 1],
      ["Other", 1, 2],
    ]);
  });
});

describe("active identity", () => {
  it("defaults to all identities and new work goes to the default pen name", async () => {
    expect(ctx.activePenNameId).toBeNull();
    expect(await getActivePenName(ctx)).toBeNull();
    expect((await getPenNameForNewWork(ctx)).name).toBe("Jane Austen");
  });

  it("switches identity; new work and the library follow it", async () => {
    const other = await createPenName(ctx, { name: "Other" });
    await createBook(ctx, { title: "Jane's book" });

    await setActiveIdentity(ctx, other.id);
    ctx = await refresh(ctx);
    expect(ctx.activePenNameId).toBe(other.id);

    const book = await createBook(ctx, { title: "Other's book" });
    const lib = await listLibrary(ctx, { penNameId: ctx.activePenNameId });
    expect(lib.standalone.map((b) => b.id)).toEqual([book.id]);

    await setActiveIdentity(ctx, null);
    ctx = await refresh(ctx);
    expect((await listLibrary(ctx, { penNameId: null })).standalone).toHaveLength(2);
  });

  it("falls back to all identities when the active one is archived", async () => {
    const other = await createPenName(ctx, { name: "Other" });
    await setActiveIdentity(ctx, other.id);
    await archivePenName(ctx, other.id);
    ctx = await refresh(ctx);
    expect(ctx.activePenNameId).toBeNull();
  });

  it("rejects switching to an archived or foreign pen name", async () => {
    const other = await createPenName(ctx, { name: "Other" });
    await archivePenName(ctx, other.id);
    await expect(setActiveIdentity(ctx, other.id)).rejects.toBeInstanceOf(RuleError);

    const stranger = await createAuthor("Stranger");
    const theirs = await getDefaultPenName(stranger);
    await expect(setActiveIdentity(ctx, theirs.id)).rejects.toThrow("not found");
  });
});

describe("database guarantees", () => {
  it("allows only one default pen name per workspace", async () => {
    await expect(
      db.penName.create({
        data: { workspaceId: ctx.workspaceId, name: "Second", isDefault: true },
      }),
    ).rejects.toThrow(/unique/i);
  });

  it("never lets the default pen name be archived", async () => {
    const def = await getDefaultPenName(ctx);
    await expect(
      db.penName.update({ where: { id: def.id }, data: { archivedAt: new Date() } }),
    ).rejects.toThrow(/pen_names_default_not_archived/);
  });
});
