import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { ConflictError, NotFoundError, RuleError } from "@/lib/errors";
import { createCharacter, trashCharacter, getCharacter } from "@/modules/characters";
import { applyIdentityMove, previewIdentityMove } from "@/modules/impact";
import { createBook, createSeries } from "@/modules/library";
import { createChapter, createScene } from "@/modules/manuscript";
import { createPenName } from "@/modules/pen-names";
import {
  createRelationship,
  getRelationship,
  groupDynamics,
  groupsIncluding,
  listRelationships,
  previewRelationshipMembers,
  setMemberRole,
  setRelationshipMembers,
} from "@/modules/relationships";
import { searchNodes } from "@/modules/story-graph";
import { createOutline, seriesRomance } from "@/modules/structure";
import { deleteForever, restoreFromTrash } from "@/modules/trash";
import { addParticipant } from "@/modules/participation";
import type { AuthorContext } from "@/server/context";

import { createAuthor, resetDatabase } from "../support/db";

let ctx: AuthorContext;
let elara: string;
let kael: string;
let rowan: string;

beforeEach(async () => {
  await resetDatabase();
  ctx = await createAuthor();
  elara = (await createCharacter(ctx, { name: "Elara" })).id;
  kael = (await createCharacter(ctx, { name: "Kael" })).id;
  rowan = (await createCharacter(ctx, { name: "Rowan" })).id;
});

describe("group relationships", () => {
  it("connect three or more characters, alongside the pairs within the group", async () => {
    const group = await createRelationship(ctx, {
      characterIds: [elara, kael, rowan],
      type: "Romance",
    });
    const r = await getRelationship(ctx, group.id);
    expect(r.title).toBe("Elara, Kael & Rowan");
    expect(r.members.map((m) => m.name)).toEqual(["Elara", "Kael", "Rowan"]);

    // Each dynamic within the group is a relationship of its own.
    const ek = await createRelationship(ctx, { characterIds: [elara, kael], type: "Romance" });
    let dynamics = await groupDynamics(ctx, group.id);
    expect(
      dynamics.map((d) => [d.members.map((m) => m.name).join("+"), d.relationship?.id ?? null]),
    ).toEqual([
      ["Elara+Kael", ek.id],
      ["Elara+Rowan", null],
      ["Kael+Rowan", null],
    ]);
    await createRelationship(ctx, { characterIds: [kael, rowan], type: "Rivals" });
    dynamics = await groupDynamics(ctx, group.id);
    expect(dynamics.filter((d) => d.relationship).length).toBe(2);
    expect((await groupsIncluding(ctx, ek.id)).map((g) => g.id)).toEqual([group.id]);

    // Elara is in two relationships: the pair and the group.
    expect((await listRelationships(ctx, { characterId: elara })).map((x) => x.title)).toEqual([
      "Elara, Kael & Rowan",
      "Elara & Kael",
    ]);
    // Found by any member's name.
    const found = await searchNodes(ctx, { query: "Rowan", kinds: ["RELATIONSHIP"] });
    expect(found.map((n) => n.title)).toContain("Elara, Kael & Rowan");
  });

  it("allow one relationship per exact set of members", async () => {
    await createRelationship(ctx, { characterIds: [elara, kael, rowan], type: "Romance" });
    await expect(
      createRelationship(ctx, { characterIds: [rowan, elara, kael], type: "Again" }),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      createRelationship(ctx, { characterIds: [elara], type: "Alone" }),
    ).rejects.toBeInstanceOf(RuleError);
  });

  it("change members: at least two, no duplicate sets, one pen name", async () => {
    const group = await createRelationship(ctx, {
      characterIds: [elara, kael, rowan],
      type: "Romance",
    });
    await createRelationship(ctx, { characterIds: [elara, kael], type: "Romance" });
    // Removing a member is reviewed first (Change Impact).
    await expect(setRelationshipMembers(ctx, group.id, [kael, elara])).rejects.toThrow(
      /Review what this change affects/,
    );
    const review = await previewRelationshipMembers(ctx, group.id, [kael, elara]);
    await expect(
      setRelationshipMembers(ctx, group.id, [kael, elara], review.token),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(setRelationshipMembers(ctx, group.id, [kael])).rejects.toBeInstanceOf(RuleError);
    const rose = await createPenName(ctx, { name: "Rose" });
    const ivy = (await createCharacter(ctx, { name: "Ivy", penNameId: rose.id })).id;
    await expect(setRelationshipMembers(ctx, group.id, [elara, kael, ivy])).rejects.toBeInstanceOf(
      RuleError,
    );
    const finn = (await createCharacter(ctx, { name: "Finn" })).id;
    await setRelationshipMembers(ctx, group.id, [elara, kael, rowan, finn]);
    expect((await getRelationship(ctx, group.id)).title).toBe("Elara, Kael, Rowan & Finn");
  });

  it("give each member an optional role, kept when members change", async () => {
    const group = await createRelationship(ctx, { characterIds: [elara, kael], type: "Romance" });
    await setMemberRole(ctx, group.id, elara, "  Heroine ");
    await setMemberRole(ctx, group.id, kael, "MMC");
    await setRelationshipMembers(ctx, group.id, [elara, kael, rowan]);
    const roles = (await getRelationship(ctx, group.id)).members.map((m) => [m.name, m.role]);
    expect(roles).toEqual([
      ["Elara", "Heroine"],
      ["Kael", "MMC"],
      ["Rowan", null],
    ]);
    await setMemberRole(ctx, group.id, kael, "");
    expect((await getRelationship(ctx, group.id)).members[1].role).toBeNull();
    await expect(setMemberRole(ctx, group.id, elara, "x".repeat(61))).rejects.toThrow();
    const stranger = (await createCharacter(ctx, { name: "Ivy" })).id;
    await expect(setMemberRole(ctx, group.id, stranger, "Rival")).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("are checked by the database: two members minimum, key matches members", async () => {
    const group = await createRelationship(ctx, { characterIds: [elara, kael], type: "Romance" });
    await expect(
      db.$transaction([
        db.relationshipMember.deleteMany({
          where: { relationshipId: group.id, characterId: kael },
        }),
      ]),
    ).rejects.toThrow(/at least two members/);
    await expect(
      db.relationship.update({ where: { id: group.id }, data: { memberKey: "nonsense" } }),
    ).rejects.toThrow(/member_key/);
  });

  it("hide while a member is in the Trash, and end when a member is deleted forever", async () => {
    const group = await createRelationship(ctx, {
      characterIds: [elara, kael, rowan],
      type: "Romance",
    });
    const pair = await createRelationship(ctx, { characterIds: [elara, kael], type: "Romance" });
    await trashCharacter(ctx, rowan);
    await expect(getRelationship(ctx, group.id)).rejects.toBeInstanceOf(NotFoundError);
    expect((await getRelationship(ctx, pair.id)).id).toBe(pair.id);
    await restoreFromTrash(ctx, "CHARACTER", rowan);
    expect((await getRelationship(ctx, group.id)).id).toBe(group.id);

    await trashCharacter(ctx, rowan);
    await deleteForever(ctx, "CHARACTER", rowan);
    expect(await db.relationship.findUnique({ where: { id: group.id } })).toBeNull();
    expect(await db.storyNode.findUnique({ where: { id: group.id } })).toBeNull();
    // The pair without Rowan is untouched.
    expect((await getRelationship(ctx, pair.id)).id).toBe(pair.id);
  });

  it("own romance arcs, shown in the Romance Center by the group's name", async () => {
    const series = await createSeries(ctx, { title: "Crown" });
    await createBook(ctx, { title: "One", seriesId: series.id });
    const [a, b, c] = await Promise.all(
      ["A", "B", "C"].map(
        async (name) => (await createCharacter(ctx, { name, seriesId: series.id })).id,
      ),
    );
    const group = await createRelationship(ctx, { characterIds: [a, b, c], type: "Romance" });
    const arc = await createOutline(ctx, {
      seriesId: series.id,
      kind: "ROMANCE",
      relationshipId: group.id,
    });
    const center = await seriesRomance(ctx, series.id);
    expect(center.relationships.map((r) => [r.relationship.title, r.arcs[0].id])).toEqual([
      ["A, B & C", arc.id],
    ]);
    // A member from another series can't be part of this series' arc.
    const outsider = (
      await createCharacter(ctx, {
        name: "Out",
        seriesId: (await createSeries(ctx, { title: "Other" })).id,
      })
    ).id;
    const mixed = await createRelationship(ctx, { characterIds: [a, outsider], type: "Romance" });
    await expect(
      createOutline(ctx, { seriesId: series.id, kind: "ROMANCE", relationshipId: mixed.id }),
    ).rejects.toBeInstanceOf(RuleError);
  });

  it("move every member with a book to another pen name", async () => {
    const book = await createBook(ctx, { title: "Book" });
    const scene = (await createScene(ctx, (await createChapter(ctx, book.id)).id)).id;
    await addParticipant(ctx, scene, { characterId: elara });
    await createRelationship(ctx, { characterIds: [elara, kael, rowan], type: "Romance" });
    const rose = await createPenName(ctx, { name: "Rose" });
    const move = { kind: "BOOK" as const, id: book.id, toPenNameId: rose.id };
    const report = await previewIdentityMove(ctx, move);
    expect(report.groups.find((g) => g.key === "RELATIONSHIP")?.items.map((i) => i.title)).toEqual([
      "Elara, Kael & Rowan",
    ]);
    await applyIdentityMove(ctx, move, report.token);
    for (const id of [elara, kael, rowan])
      expect((await getCharacter(ctx, id)).penNameId).toBe(rose.id);
  });
});
