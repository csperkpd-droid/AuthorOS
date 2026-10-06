import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { ConflictError, RuleError } from "@/lib/errors";
import { createCharacter, updateCharacter } from "@/modules/characters";
import { createFieldDefinition, setFieldValue } from "@/modules/fields";
import { createBook, createSeries, previewBookSeries, setBookSeries } from "@/modules/library";
import {
  createChapter,
  createPart,
  createScene,
  dissolvePart,
  previewDissolvePart,
} from "@/modules/manuscript";
import { createNote } from "@/modules/notes";
import { addParticipant } from "@/modules/participation";
import {
  createRelationship,
  previewRelationshipMembers,
  setMemberRole,
  setRelationshipMembers,
} from "@/modules/relationships";
import {
  addBeat,
  assignScene,
  createOutline,
  deleteBeat,
  getOutline,
  previewDeleteBeat,
} from "@/modules/structure";
import type { AuthorContext } from "@/server/context";

import { createAuthor, resetDatabase } from "../support/db";

let ctx: AuthorContext;

beforeEach(async () => {
  await resetDatabase();
  ctx = await createAuthor("Jane");
});

const group = (report: { groups: { key: string; count: number }[] }, key: string) =>
  report.groups.find((g) => g.key === key)?.count ?? 0;

async function seriesWithArc() {
  const series = await createSeries(ctx, { title: "Crown" });
  const [book1, book2] = await Promise.all(
    ["Ember", "Ash"].map((title) => createBook(ctx, { title, seriesId: series.id })),
  );
  const chapter = await createChapter(ctx, book2.id);
  const scene = await createScene(ctx, chapter.id, "Reunion");
  const [a, b] = await Promise.all(
    ["Elara", "Kael"].map(async (name) => (await createCharacter(ctx, { name })).id),
  );
  const couple = await createRelationship(ctx, { characterIds: [a, b], type: "Romance" });
  const arc = await createOutline(ctx, {
    seriesId: series.id,
    kind: "ROMANCE",
    relationshipId: couple.id,
    title: "Elara + Kael",
  });
  const beat = await addBeat(ctx, arc.id, {
    title: "Second chance",
    targetPercent: null,
    bookId: book2.id,
  });
  await assignScene(ctx, beat.id, scene.id);
  return { series, book1, book2, scene, arc, beat, a, b, couple };
}

describe("a book leaving its series (Change Impact)", () => {
  it("shows the series beats and placements it takes the book out of, then applies exactly that", async () => {
    const s = await seriesWithArc();
    const report = await previewBookSeries(ctx, s.book2.id, null);
    expect(report.summary).toBe("This will affect 2 items: 1 beat, 1 beat placement.");
    expect(report.groups.find((g) => g.key === "PLACEMENTS")?.items[0].title).toBe(
      "Reunion on Elara + Kael › Second chance",
    );

    // Never silently: without the review it is refused.
    await expect(setBookSeries(ctx, s.book2.id, null)).rejects.toThrow(/Review what this/);
    await expect(setBookSeries(ctx, s.book2.id, null, "stale")).rejects.toBeInstanceOf(
      ConflictError,
    );
    await setBookSeries(ctx, s.book2.id, null, report.token);

    const arc = await getOutline(ctx, s.arc.id);
    expect(arc.beats).toHaveLength(1); // the beat stays in the series arc
    expect(arc.beats[0]).toMatchObject({ bookId: null, scenes: [] });
    expect(await db.scene.count({ where: { id: s.scene.id } })).toBe(1); // the scene stays
    expect((await db.book.findUniqueOrThrow({ where: { id: s.book2.id } })).seriesId).toBeNull();
  });

  it("joining a series affects nothing and needs no review; series characters in its scenes block leaving", async () => {
    const s = await seriesWithArc();
    const other = await createSeries(ctx, { title: "Thorns" });
    const loose = await createBook(ctx, { title: "Loose" });
    const join = await previewBookSeries(ctx, loose.id, other.id);
    expect(join.summary).toBe("This doesn’t affect anything else.");
    await setBookSeries(ctx, loose.id, other.id);

    const rowan = await createCharacter(ctx, { name: "Rowan", seriesId: s.series.id });
    await addParticipant(ctx, s.scene.id, { characterId: rowan.id });
    const blocked = await previewBookSeries(ctx, s.book2.id, other.id);
    expect(blocked.blockers.map((b) => b.title)).toEqual(["Rowan"]);
    await expect(setBookSeries(ctx, s.book2.id, other.id, blocked.token)).rejects.toThrow(
      /Rowan belongs to “Crown”/,
    );
  });
});

describe("other consequential operations are reviewed", () => {
  it("removing relationship members lists them, their roles and the arcs that continue", async () => {
    const s = await seriesWithArc();
    const rowan = (await createCharacter(ctx, { name: "Rowan" })).id;
    await setRelationshipMembers(ctx, s.couple.id, [s.a, s.b, rowan]); // adding: no review
    await setMemberRole(ctx, s.couple.id, rowan, "Rival");
    const report = await previewRelationshipMembers(ctx, s.couple.id, [s.a, s.b]);
    expect(report.summary).toBe("This will affect 2 items: 1 member, 1 structure.");
    expect(report.groups[0].items[0]).toMatchObject({
      title: "Rowan",
      note: "role “Rival” removed",
    });
    await expect(setRelationshipMembers(ctx, s.couple.id, [s.a, s.b])).rejects.toBeInstanceOf(
      RuleError,
    );
    await setRelationshipMembers(ctx, s.couple.id, [s.a, s.b], report.token);
    expect(await db.relationshipMember.count({ where: { relationshipId: s.couple.id } })).toBe(2);
  });

  it("removing a beat shows its scene placements; the scenes stay", async () => {
    const s = await seriesWithArc();
    const report = await previewDeleteBeat(ctx, s.beat.id);
    expect(group(report, "PLACEMENTS")).toBe(1);
    await expect(deleteBeat(ctx, s.beat.id)).rejects.toBeInstanceOf(RuleError);
    await deleteBeat(ctx, s.beat.id, report.token);
    expect(await db.scene.count({ where: { id: s.scene.id } })).toBe(1);
    // An unplaced beat affects nothing else.
    const empty = await addBeat(ctx, s.arc.id, { title: "Spare", targetPercent: null });
    await deleteBeat(ctx, empty.id);
  });

  it("removing a part keeps its chapters and shows the links and values that go with it", async () => {
    const book = await createBook(ctx, { title: "Ember" });
    const part = await createPart(ctx, book.id);
    const chapter = await createChapter(ctx, book.id, { partId: part.id });
    await createNote(ctx, { title: "Act one notes", aboutId: part.id });
    const field = await createFieldDefinition(ctx, { nodeKind: "PART", label: "Theme" });
    await setFieldValue(ctx, part.id, field.id, "Loss");
    const report = await previewDissolvePart(ctx, part.id);
    expect(report.summary).toBe("This will affect 2 items: 1 link, 1 field value.");
    await expect(dissolvePart(ctx, part.id)).rejects.toBeInstanceOf(RuleError);
    await dissolvePart(ctx, part.id, report.token);
    expect((await db.chapter.findUniqueOrThrow({ where: { id: chapter.id } })).partId).toBeNull();
    expect(await db.note.count()).toBe(1); // the note stays; only the link went
  });

  it("a character can't change series while appearing in scenes outside it", async () => {
    const s = await seriesWithArc();
    const other = await createSeries(ctx, { title: "Thorns" });
    const rowan = await createCharacter(ctx, { name: "Rowan", seriesId: s.series.id });
    await addParticipant(ctx, s.scene.id, { characterId: rowan.id });
    await expect(
      updateCharacter(ctx, rowan.id, { name: "Rowan", seriesId: other.id }),
    ).rejects.toThrow(/appears in 1 scene outside that series/);
  });
});
