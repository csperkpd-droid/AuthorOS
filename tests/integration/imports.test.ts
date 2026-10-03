import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { createCharacter } from "@/modules/characters";
import { connect } from "@/modules/connections";
import { exportWorkspaceJson } from "@/modules/exports";
import { createFieldDefinition, setFieldValue } from "@/modules/fields";
import { reviewImport, runImport, type ImportReview } from "@/modules/imports";
import { createBook, createSeries } from "@/modules/library";
import { createChapter, createScene, saveSceneContent } from "@/modules/manuscript";
import { createNote, trashNote } from "@/modules/notes";
import { createPenName } from "@/modules/pen-names";
import { logWriting, setDailyGoal } from "@/modules/progress";
import { createRelationship, getRelationship, setMemberRole } from "@/modules/relationships";
import { assignScene, createKit, createOutline, getOutline } from "@/modules/structure";
import type { AuthorContext } from "@/server/context";

import { createAuthor, resetDatabase } from "../support/db";

let ctx: AuthorContext;

beforeEach(async () => {
  await resetDatabase();
  ctx = await createAuthor("Jane");
});

const doc = (text: string) => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

/** A small but complete workspace: two identities, a series romance, links, fields. */
async function seed(author: AuthorContext) {
  const rose = await createPenName(author, { name: "Rose Hart", language: "en" });
  const series = await createSeries(author, { title: "Crown" });
  const book = await createBook(author, { title: "Ember", seriesId: series.id });
  const chapter = await createChapter(author, book.id);
  const scene = await createScene(author, chapter.id, "Opening");
  await saveSceneContent(author, { sceneId: scene.id, content: doc("Ash fell."), baseVersion: 0 });
  const [a, b, c] = await Promise.all(
    ["Elara", "Kael", "Rowan"].map(
      async (name) => (await createCharacter(author, { name, seriesId: series.id })).id,
    ),
  );
  await connect(author, { sourceId: a, targetId: scene.id, kind: "appears_in", attribute: "POV" });
  const group = await createRelationship(author, { characterIds: [a, b, c], type: "Romance" });
  await setMemberRole(author, group.id, a, "Heroine");
  await setMemberRole(author, group.id, b, "Love Interest");
  const pair = await createRelationship(author, { characterIds: [a, b], type: "Rivals" });
  const arc = await createOutline(author, {
    seriesId: series.id,
    kind: "ROMANCE",
    relationshipId: group.id,
    templateId: "00000000-0000-7000-8000-000000000a04",
  });
  const beat = (await getOutline(author, arc.id)).beats[0];
  await assignScene(author, beat.id, scene.id);
  const field = await createFieldDefinition(author, { nodeKind: "CHARACTER", label: "Magic" });
  await setFieldValue(author, a, field.id, "Fire");
  const note = await createNote(author, { title: "World notes", aboutId: series.id });
  const roseBook = await createBook(author, { title: "Thorn", penNameId: rose.id });
  await createKit(author, { name: "Kit", templateIds: ["00000000-0000-7000-8000-000000000a02"] });
  await logWriting(author, { date: "2026-01-02", words: 500, bookId: book.id });
  await setDailyGoal(author, 1000);
  return {
    rose,
    series,
    book,
    chapter,
    scene,
    a,
    b,
    c,
    group,
    pair,
    arc,
    beat,
    field,
    note,
    roseBook,
  };
}

async function backup(author: AuthorContext, kind: "standard" | "archive" = "standard") {
  const { data } = await exportWorkspaceJson(author, { scope: { kind: "all" }, kind });
  return new TextEncoder().encode(JSON.stringify(data));
}

const file = (bytes: Uint8Array) => ({ sourceId: "authoros-json", filename: "b.json", bytes });

const counts = (review: ImportReview) =>
  Object.fromEntries(review.counts.map((c) => [c.key, [c.create, c.update, c.skip]]));

async function restore(
  author: AuthorContext,
  bytes: Uint8Array,
  options: { ids?: "keep" | "new"; existing?: "skip" | "replace" } = {},
) {
  const review = await reviewImport(author, file(bytes), options);
  expect(review.errors).toEqual([]);
  expect(review.conflicts).toEqual([]);
  const result = await runImport(author, file(bytes), { ...options, token: review.token! });
  return { review, result };
}

/** Row counts of the story tables. */
async function tableCounts() {
  const rows = await db.$queryRaw<{ t: string; n: bigint }[]>`
    SELECT 'nodes' t, count(*) n FROM story_nodes UNION ALL
    SELECT 'pens', count(*) FROM pen_names UNION ALL
    SELECT 'scenes', count(*) FROM scenes UNION ALL
    SELECT 'connections', count(*) FROM connections UNION ALL
    SELECT 'members', count(*) FROM relationship_members UNION ALL
    SELECT 'revisions', count(*) FROM content_revisions UNION ALL
    SELECT 'values', count(*) FROM node_field_values`;
  return Object.fromEntries(rows.map((r) => [r.t, Number(r.n)]));
}

describe("import: restoring a backup into another account", () => {
  it("recreates everything with the original Story Graph ids", async () => {
    const s = await seed(ctx);
    const bytes = await backup(ctx, "archive");
    // Another installation: the original workspace isn't there.
    await resetDatabase();
    const other = await createAuthor("Jane");

    const { review, result } = await restore(other, bytes);
    expect(review.file).toMatchObject({ description: "Complete archive" });
    expect(counts(review)).toMatchObject({
      scenes: [1, 0, 0],
      characters: [3, 0, 0],
      relationships: [2, 0, 0],
      connections: [2, 0, 0], // the POV link and the note's "about"
      beatScenes: [1, 0, 0],
    });
    expect(result.created).toBeGreaterThan(10);

    // Same ids, same hierarchy and identities.
    const scene = await db.scene.findUniqueOrThrow({ where: { id: s.scene.id } });
    expect(scene).toMatchObject({
      workspaceId: other.workspaceId,
      chapterId: s.chapter.id,
      bookId: s.book.id,
      contentText: "Ash fell.",
      wordCount: 2,
    });
    const roseBook = await db.book.findUniqueOrThrow({ where: { id: s.roseBook.id } });
    const rose = await db.penName.findUniqueOrThrow({ where: { id: roseBook.penNameId } });
    expect(rose).toMatchObject({ name: "Rose Hart", language: "en", isDefault: false });
    // "Jane" matched the new account's default pen name, which stays the default.
    const ember = await db.book.findUniqueOrThrow({ where: { id: s.book.id } });
    const jane = await db.penName.findUniqueOrThrow({ where: { id: ember.penNameId } });
    expect(jane).toMatchObject({ workspaceId: other.workspaceId, isDefault: true });

    // Group relationship, roles, structures, assignments, connections, fields.
    const group = await getRelationship(other, s.group.id);
    expect(group.members.map((m) => [m.id, m.role])).toEqual([
      [s.a, "Heroine"],
      [s.b, "Love Interest"],
      [s.c, null],
    ]);
    const arc = await getOutline(other, s.arc.id);
    expect(arc.relationship?.id).toBe(s.group.id);
    expect(arc.beats[0].scenes.map((x) => x.id)).toEqual([s.scene.id]);
    const pov = await db.connection.findFirstOrThrow({ where: { targetId: s.scene.id } });
    expect(pov).toMatchObject({ sourceId: s.a, attributes: { role: "POV" } });
    expect(
      await db.nodeFieldValue.findFirstOrThrow({ where: { nodeId: s.a, fieldId: s.field.id } }),
    ).toMatchObject({ value: "Fire" });
    // Writing history and settings come along; version history from the archive.
    // The editor’s automatic row and the logged words.
    expect(await db.writingSession.count({ where: { userId: other.userId } })).toBe(2);
    expect(
      await db.workspaceMember.findFirstOrThrow({ where: { userId: other.userId } }),
    ).toMatchObject({ dailyWordGoal: 1000 });
    expect(await db.templateKit.count({ where: { workspaceId: other.workspaceId } })).toBe(1);

    // Importing the same file again changes nothing.
    const again = await reviewImport(other, file(bytes));
    expect(again.canImport).toBe(false);
    expect(again.summary).toMatch(/already here/);
  });
});

describe("import: conflicts and copies", () => {
  it("reports ids used by another workspace as conflicts and imports nothing", async () => {
    await seed(ctx);
    const bytes = await backup(ctx);
    const other = await createAuthor("Sam");
    const before = await tableCounts();

    const review = await reviewImport(other, file(bytes));
    expect(review.canImport).toBe(false);
    expect(review.token).toBeNull();
    expect(review.conflicts[0]).toMatchObject({ key: "elsewhere" });
    expect(review.conflicts[0].items).toContain("Scene: Opening");
    await expect(runImport(other, file(bytes), { token: "x" })).rejects.toThrow(/conflicts/);
    expect(await tableCounts()).toEqual(before);
  });

  it("imports a copy with new ids, keeping every link", async () => {
    const s = await seed(ctx);
    const bytes = await backup(ctx);
    const other = await createAuthor("Sam");

    const { review } = await restore(other, bytes, { ids: "new" });
    expect(counts(review).penNames).toEqual([2, 0, 0]);
    expect(await db.scene.count({ where: { id: s.scene.id } })).toBe(1); // the original only
    const copy = await db.scene.findFirstOrThrow({ where: { workspaceId: other.workspaceId } });
    expect(copy.id).not.toBe(s.scene.id);
    const relationships = await db.relationship.findMany({
      where: { workspaceId: other.workspaceId },
      include: { members: true },
    });
    expect(relationships.map((r) => r.members.length).sort()).toEqual([2, 3]);
    const arc = await db.outline.findFirstOrThrow({ where: { workspaceId: other.workspaceId } });
    expect(relationships.map((r) => r.id)).toContain(arc.relationshipId);
    const assignment = await db.beatScene.findFirstOrThrow({
      where: { workspaceId: other.workspaceId },
    });
    expect(assignment.sceneId).toBe(copy.id);
    // Identities stay separate: Rose's book is in the copied Rose pen name.
    const thorn = await db.book.findFirstOrThrow({
      where: { workspaceId: other.workspaceId, title: "Thorn" },
      include: { penName: true },
    });
    expect(thorn.penName.name).toBe("Rose Hart");
  });
});

describe("import: restoring into the same workspace", () => {
  it("restores what's missing and keeps or replaces what exists", async () => {
    const s = await seed(ctx);
    const bytes = await backup(ctx);

    // Since the backup: the scene was rewritten, a relationship deleted forever,
    // the note trashed.
    await saveSceneContent(ctx, {
      sceneId: s.scene.id,
      content: doc("Rain fell."),
      baseVersion: 1,
    });
    await db.storyNode.delete({ where: { id: s.pair.id } });
    await trashNote(ctx, s.note.id);

    // Keep existing: only the deleted relationship comes back.
    const kept = await restore(ctx, bytes, { existing: "skip" });
    expect(counts(kept.review).relationships).toEqual([1, 0, 1]);
    expect(counts(kept.review).scenes).toEqual([0, 0, 1]);
    expect(await db.relationship.count({ where: { id: s.pair.id } })).toBe(1);
    expect((await db.scene.findUniqueOrThrow({ where: { id: s.scene.id } })).contentText).toBe(
      "Rain fell.",
    );

    // Replace: the file's version wins; the current text is kept as a version.
    const replaced = await restore(ctx, bytes, { existing: "replace" });
    expect(counts(replaced.review).scenes).toEqual([0, 1, 0]);
    expect(counts(replaced.review).notes).toEqual([0, 1, 0]);
    const scene = await db.scene.findUniqueOrThrow({ where: { id: s.scene.id } });
    expect(scene).toMatchObject({ contentText: "Ash fell.", version: 3 });
    const snapshot = await db.contentRevision.findFirstOrThrow({
      where: { nodeId: s.scene.id, source: "IMPORT" },
    });
    expect(snapshot).toMatchObject({ contentText: "Rain fell.", label: "Before import" });
    expect((await db.note.findUniqueOrThrow({ where: { id: s.note.id } })).deletedAt).toBeNull();
  });

  it("copies into the same workspace: same pen names and fields, new objects", async () => {
    await seed(ctx);
    const bytes = await backup(ctx);
    const before = await db.scene.count();

    const { review } = await restore(ctx, bytes, { ids: "new" });
    expect(counts(review).penNames).toEqual([0, 0, 2]);
    expect(counts(review).fieldDefinitions).toEqual([0, 0, 1]);
    expect(await db.scene.count()).toBe(before * 2);
    expect(await db.penName.count({ where: { workspaceId: ctx.workspaceId } })).toBe(2);
    expect(await db.nodeFieldValue.count({ where: { value: "Fire" } })).toBe(2);
  });

  it("treats objects moved to another pen name since the backup as conflicts", async () => {
    const s = await seed(ctx);
    const bytes = await backup(ctx);
    // The scene loses its point of view, then the backup is restored after
    // a character changed identity behind the backup's back.
    await db.character.update({
      where: { id: s.c },
      data: { penNameId: s.rose.id, seriesId: null },
    });
    const review = await reviewImport(ctx, file(bytes));
    expect(review.canImport).toBe(false);
    expect(review.conflicts).toEqual([
      expect.objectContaining({ key: "moved", items: ["Character: Rowan"] }),
    ]);
  });

  it("keeps one point of view per scene", async () => {
    const s = await seed(ctx);
    const bytes = await backup(ctx);
    // Since the backup, the POV link was removed and Kael became the POV.
    await db.connection.deleteMany({ where: { targetId: s.scene.id } });
    await connect(ctx, {
      sourceId: s.b,
      targetId: s.scene.id,
      kind: "appears_in",
      attribute: "POV",
    });

    const { review } = await restore(ctx, bytes);
    expect(review.adjustments.join(" ")).toMatch(/point-of-view character is added as present/);
    const links = await db.connection.findMany({ where: { targetId: s.scene.id } });
    expect(Object.fromEntries(links.map((l) => [l.sourceId, l.attributes]))).toEqual({
      [s.a]: { role: "PRESENT" },
      [s.b]: { role: "POV" },
    });
  });

  it("refuses a stale review", async () => {
    const s = await seed(ctx);
    const bytes = await backup(ctx);
    await db.storyNode.delete({ where: { id: s.pair.id } });
    const review = await reviewImport(ctx, file(bytes));
    // Something changes before the import runs.
    await db.storyNode.delete({ where: { id: s.note.id } });
    await expect(runImport(ctx, file(bytes), { token: review.token! })).rejects.toThrow(
      /changed since/,
    );
    expect(await db.relationship.count({ where: { id: s.pair.id } })).toBe(0);
  });
});

describe("import: validation", () => {
  async function exported() {
    await seed(ctx);
    const { data } = await exportWorkspaceJson(ctx, { scope: { kind: "all" } });
    return JSON.parse(JSON.stringify(data));
  }
  const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));

  it("rejects files that aren't valid backups, before changing anything", async () => {
    const data = await exported();
    await resetDatabase();
    const other = await createAuthor("Jane");
    const before = await tableCounts();

    const cases: [Uint8Array, RegExp][] = [
      [new TextEncoder().encode("{not json"), /valid JSON/],
      [encode({ format: "something.else" }), /isn’t an AuthorOS backup/],
      [encode({ ...data, version: 99 }), /newer version/],
      [
        encode({ ...data, scenes: [{ ...data.scenes[0], chapterId: crypto.randomUUID() }] }),
        /scene.chapter/,
      ],
      [
        encode({ ...data, scenes: [{ ...data.scenes[0], content: { type: "nope" } }] }),
        /scenes\.0\.content/,
      ],
      [
        encode({
          ...data,
          relationships: data.relationships.map((r: { members: unknown[] }) => ({
            ...r,
            members: r.members.slice(0, 1),
          })),
        }),
        /fewer than two members/,
      ],
      [
        encode({
          ...data,
          characters: data.characters.map((c: { id: string }, i: number) =>
            i === 0
              ? {
                  ...c,
                  penNameId: data.books.find((b: { title: string }) => b.title === "Thorn")
                    .penNameId,
                  seriesId: null,
                }
              : c,
          ),
        }),
        /different pen names/,
      ],
    ];
    for (const [bytes, message] of cases) {
      const review = await reviewImport(other, file(bytes));
      expect(review.canImport).toBe(false);
      expect(review.errors.join("\n")).toMatch(message);
      await expect(runImport(other, file(bytes), { token: "x" })).rejects.toThrow();
    }
    expect(await tableCounts()).toEqual(before);
  });

  it("imports nothing at all if writing fails partway", async () => {
    const data = await exported();
    await resetDatabase();
    const other = await createAuthor("Jane");
    const bytes = encode(data);
    const review = await reviewImport(other, file(bytes));
    const before = await tableCounts();
    // Notes are written after scenes, characters and relationships.
    await db.$executeRawUnsafe(`
      CREATE FUNCTION test_fail() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'disk full'; END; $$ LANGUAGE plpgsql`);
    await db.$executeRawUnsafe(
      `CREATE TRIGGER test_fail BEFORE INSERT ON notes FOR EACH ROW EXECUTE FUNCTION test_fail()`,
    );
    try {
      await expect(runImport(other, file(bytes), { token: review.token! })).rejects.toThrow(
        /disk full/,
      );
    } finally {
      await db.$executeRawUnsafe(`DROP TRIGGER test_fail ON notes`);
      await db.$executeRawUnsafe(`DROP FUNCTION test_fail()`);
    }
    expect(await tableCounts()).toEqual(before);
  });
});
