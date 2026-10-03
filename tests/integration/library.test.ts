import { beforeEach, describe, expect, it } from "vitest";

import { NotFoundError, RuleError } from "@/lib/errors";
import {
  createBook,
  createSeries,
  getBook,
  getSeries,
  listLibrary,
  moveBookInSeries,
  setBookSeries,
  trashBook,
  trashSeries,
  updateBook,
  updateSeries,
} from "@/modules/library";
import { createPenName, getDefaultPenName } from "@/modules/pen-names";
import type { AuthorContext } from "@/server/context";

import { createAuthor, resetDatabase } from "../support/db";

let ctx: AuthorContext;

beforeEach(async () => {
  await resetDatabase();
  ctx = await createAuthor("Jane Austen");
});

describe("series and books", () => {
  it("creates standalone books under the default pen name", async () => {
    const { id } = await createBook(ctx, { title: "Emma", subtitle: "", status: "DRAFTING" });
    const book = await getBook(ctx, id);
    expect(book).toMatchObject({
      title: "Emma",
      subtitle: null,
      status: "DRAFTING",
      seriesId: null,
    });
    expect(book.penName.name).toBe("Jane Austen");
  });

  it("keeps books in series order and lets them be reordered", async () => {
    const series = await createSeries(ctx, { title: "Bath Mysteries" });
    const one = await createBook(ctx, { title: "One", seriesId: series.id });
    const two = await createBook(ctx, { title: "Two", seriesId: series.id });
    const three = await createBook(ctx, { title: "Three", seriesId: series.id });
    const titles = async () => (await getSeries(ctx, series.id)).books.map((b) => b.title);

    expect(await titles()).toEqual(["One", "Two", "Three"]);
    await moveBookInSeries(ctx, three.id, null);
    expect(await titles()).toEqual(["Three", "One", "Two"]);
    await moveBookInSeries(ctx, three.id, two.id);
    expect(await titles()).toEqual(["One", "Two", "Three"]);
    await moveBookInSeries(ctx, one.id, two.id);
    expect(await titles()).toEqual(["Two", "One", "Three"]);
  });

  it("books in a series always share the series' pen name", async () => {
    const other = await createPenName(ctx, { name: "Other" });
    const series = await createSeries(ctx, { title: "Saga", penNameId: other.id });
    const def = await getDefaultPenName(ctx);

    await expect(
      createBook(ctx, { title: "Clash", seriesId: series.id, penNameId: def.id }),
    ).rejects.toBeInstanceOf(RuleError);

    const book = await createBook(ctx, { title: "Book 1", seriesId: series.id });
    expect((await getBook(ctx, book.id)).penName.id).toBe(other.id);
    await expect(
      updateBook(ctx, book.id, { title: "Book 1", targetWordCount: null, penNameId: def.id }),
    ).rejects.toBeInstanceOf(RuleError);

    // The series' pen name changes only through a reviewed Change Impact
    // (see impact.test.ts), never as a side effect of editing details.
    await expect(
      updateSeries(ctx, series.id, { title: "Saga", penNameId: def.id }),
    ).rejects.toThrow(/Change pen name/);
    await updateSeries(ctx, series.id, { title: "Saga Renamed" });
    expect((await getBook(ctx, book.id)).penName.id).toBe(other.id);
  });

  it("moves books into and out of a series of the same pen name", async () => {
    const other = await createPenName(ctx, { name: "Other" });
    const theirs = await createSeries(ctx, { title: "Their saga", penNameId: other.id });
    const mine = await createSeries(ctx, { title: "My saga" });
    const book = await createBook(ctx, { title: "Loose" });

    // Joining another identity's series would move story data: refused here.
    await expect(setBookSeries(ctx, book.id, theirs.id)).rejects.toThrow(/another pen name/);

    await setBookSeries(ctx, book.id, mine.id);
    let b = await getBook(ctx, book.id);
    expect(b.seriesId).toBe(mine.id);

    await setBookSeries(ctx, book.id, null);
    b = await getBook(ctx, book.id);
    expect(b.seriesId).toBeNull();
    expect(b.seriesPosition).toBeNull();
  });

  it("edits book details, deadline included, but not the pen name directly", async () => {
    const other = await createPenName(ctx, { name: "Other" });
    const book = await createBook(ctx, { title: "Loose" });
    await expect(
      updateBook(ctx, book.id, { title: "Loose", targetWordCount: null, penNameId: other.id }),
    ).rejects.toThrow(/Change pen name/);

    await updateBook(ctx, book.id, {
      title: "Loose",
      targetWordCount: "80000",
      dueOn: "2027-01-31",
    });
    let b = await getBook(ctx, book.id);
    expect(b.targetWordCount).toBe(80000);
    expect(b.dueOn?.toISOString().slice(0, 10)).toBe("2027-01-31");
    // Absent leaves the deadline alone; empty clears it.
    await updateBook(ctx, book.id, { title: "Loose", targetWordCount: "80000" });
    expect((await getBook(ctx, book.id)).dueOn).not.toBeNull();
    await updateBook(ctx, book.id, { title: "Loose", targetWordCount: "80000", dueOn: "" });
    b = await getBook(ctx, book.id);
    expect(b.dueOn).toBeNull();
  });

  it("filters the library by identity", async () => {
    const other = await createPenName(ctx, { name: "Other" });
    await createSeries(ctx, { title: "Their Saga", penNameId: other.id });
    await createBook(ctx, { title: "Mine" });
    const def = await getDefaultPenName(ctx);

    const mine = await listLibrary(ctx, { penNameId: def.id });
    expect(mine.series).toHaveLength(0);
    expect(mine.standalone.map((b) => b.title)).toEqual(["Mine"]);
    const all = await listLibrary(ctx, { penNameId: null });
    expect(all.series).toHaveLength(1);
  });

  it("hides trashed books, and books of trashed series", async () => {
    const series = await createSeries(ctx, { title: "Saga" });
    const inSeries = await createBook(ctx, { title: "In series", seriesId: series.id });
    const loose = await createBook(ctx, { title: "Loose" });

    await trashBook(ctx, loose.id);
    await trashSeries(ctx, series.id);

    const lib = await listLibrary(ctx, { penNameId: null });
    expect(lib.series).toHaveLength(0);
    expect(lib.standalone).toHaveLength(0);
    await expect(getBook(ctx, inSeries.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("isolates workspaces", async () => {
    const book = await createBook(ctx, { title: "Private" });
    const stranger = await createAuthor("Stranger");
    await expect(getBook(stranger, book.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(trashBook(stranger, book.id)).rejects.toBeInstanceOf(NotFoundError);
    const series = await createSeries(ctx, { title: "Mine" });
    await expect(
      createBook(stranger, { title: "Sneaky", seriesId: series.id }),
    ).rejects.toBeInstanceOf(NotFoundError);
    const myPen = await getDefaultPenName(ctx);
    await expect(
      createBook(stranger, { title: "Sneaky", penNameId: myPen.id }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
