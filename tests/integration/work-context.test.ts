import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { NotFoundError } from "@/lib/errors";
import type { PlaceAnchor } from "@/lib/work-place";
import { createCharacter } from "@/modules/characters";
import { createBook } from "@/modules/library";
import { createChapter, createScene, trashScene } from "@/modules/manuscript";
import { createNote } from "@/modules/notes";
import { deleteForever } from "@/modules/trash";
import { getWritingPlace, listWorkPlaces, setWritingPlace } from "@/modules/work-context";
import type { AuthorContext } from "@/server/context";

import { createAuthor, resetDatabase } from "../support/db";

/** M10: Work Context is the member's own navigation state, read through the funnel. */

const anchor: PlaceAnchor = {
  version: 3,
  pos: 42,
  before: "Mara counted the lamps along the harbour",
  after: " wall and found one missing.",
  scrollY: 640,
};

let ctx: AuthorContext;
let sceneId: string;

async function scene(c: AuthorContext, title = "Storm") {
  const book = await createBook(c, { title: "Harbour Lights" });
  const chapter = await createChapter(c, book.id);
  return (await createScene(c, chapter.id, title)).id;
}

beforeEach(async () => {
  await resetDatabase();
  ctx = await createAuthor("Jane");
  sceneId = await scene(ctx);
});

describe("Continue Writing: the member's writing place", () => {
  it("records the scene and where in it, and gives it back", async () => {
    expect(await getWritingPlace(ctx)).toBeNull();
    await setWritingPlace(ctx, sceneId, anchor);
    expect(await getWritingPlace(ctx)).toMatchObject({
      sceneId,
      title: "Storm",
      href: expect.stringContaining(`/scenes/${sceneId}`),
      context: expect.stringContaining("Harbour Lights"),
      anchor,
    });
    // Opening a scene without a position clears the old position.
    const other = await scene(ctx, "Calm");
    await setWritingPlace(ctx, other, null);
    expect(await getWritingPlace(ctx)).toMatchObject({ sceneId: other, anchor: null });
  });

  it("a scene in the Trash or deleted is simply no longer offered", async () => {
    await setWritingPlace(ctx, sceneId, anchor);
    await trashScene(ctx, sceneId);
    expect(await getWritingPlace(ctx)).toBeNull();
    await deleteForever(ctx, "SCENE", sceneId);
    const member = await db.workspaceMember.findFirstOrThrow({ where: { userId: ctx.userId } });
    expect(member.writingSceneId).toBeNull();
  });

  it("can't point at another workspace's scene, and reveals nothing about it", async () => {
    const other = await createAuthor("Sam");
    const theirs = await scene(other, "Their secret scene");
    await setWritingPlace(ctx, sceneId, anchor);
    const refused = await setWritingPlace(ctx, theirs, anchor).catch((e: unknown) => e);
    const missing = await setWritingPlace(
      ctx,
      "00000000-0000-7000-8000-000000000000",
      anchor,
    ).catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(NotFoundError);
    expect((refused as Error).message).toBe((missing as Error).message);
    expect((await getWritingPlace(ctx))?.sceneId).toBe(sceneId);
  });

  it("each account has its own place", async () => {
    const other = await createAuthor("Sam");
    await setWritingPlace(ctx, sceneId, anchor);
    expect(await getWritingPlace(other)).toBeNull();
  });

  it("rejects malformed positions", async () => {
    await expect(
      setWritingPlace(ctx, sceneId, { ...anchor, before: "x".repeat(500) }),
    ).rejects.toThrow();
  });
});

describe("Return to Work: titles only for places the member can view", () => {
  it("lists scenes and notes with current titles, nothing else", async () => {
    const note = await createNote(ctx, { title: "Lighthouse research" });
    const character = await createCharacter(ctx, { name: "Mara" });
    const other = await createAuthor("Sam");
    const theirs = await scene(other, "Their secret scene");
    const places = await listWorkPlaces(ctx, [sceneId, note.id, character.id, theirs]);
    expect(places.map((p) => p.title).sort()).toEqual(["Lighthouse research", "Storm"]);

    await trashScene(ctx, sceneId);
    expect((await listWorkPlaces(ctx, [sceneId, note.id])).map((p) => p.id)).toEqual([note.id]);
  });
});
