import { Schema } from "@tiptap/pm/model";
import { describe, expect, it } from "vitest";

import {
  captureAnchor,
  editWork,
  flattenDoc,
  resolveAnchor,
  returnTarget,
  visitWork,
  type WorkEntry,
} from "./work-place";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "text*" },
    text: {},
  },
});
const doc = (...paragraphs: string[]) =>
  schema.node(
    "doc",
    null,
    paragraphs.map((p) => schema.node("paragraph", null, p ? [schema.text(p)] : [])),
  );

/** The position just after `text` in the document. */
function posAfter(d: ReturnType<typeof doc>, text: string) {
  const flat = flattenDoc(d);
  const i = flat.text.indexOf(text) + text.length;
  return i < flat.posAt.length ? flat.posAt[i] : flat.end;
}

const p1 = "The tide came in slow that night, silver over the black rocks.";
const p2 = "Mara counted the lamps along the harbour wall and found one missing.";
const p3 = "You came back, said a voice behind her. She didn't turn.";

describe("work places: version-aware positions", () => {
  it("finds the same place in an unchanged document", () => {
    const d = doc(p1, p2, p3);
    const pos = posAfter(d, "found one");
    const anchor = captureAnchor(d, pos, 4, 320);
    expect(resolveAnchor(d, anchor, 4)).toEqual({ pos, how: "exact", sameVersion: true });
  });

  it("keeps a cursor at the end of a paragraph there", () => {
    const d = doc(p1, p2, p3);
    const pos = posAfter(d, "one missing.");
    const anchor = captureAnchor(d, pos, 1, 0);
    expect(resolveAnchor(d, anchor, 1)?.pos).toBe(pos);
    expect(d.resolve(pos).parent.textContent).toBe(p2);
  });

  it("follows the text when the document changed above it", () => {
    const before = doc(p1, p2, p3);
    const anchor = captureAnchor(before, posAfter(before, "found one"), 4, 320);
    const after = doc("A new opening paragraph, written elsewhere.", p1, p2, p3);
    const found = resolveAnchor(after, anchor, 5);
    expect(found?.how).toBe("moved");
    expect(found?.pos).toBe(posAfter(after, "found one"));
  });

  it("says when only one side of the place is still there", () => {
    const before = doc(p1, p2, p3);
    const anchor = captureAnchor(before, posAfter(before, "one missing."), 4, 0);
    const found = resolveAnchor(doc(p1, p3), anchor, 5);
    expect(found?.how).toBe("near");
    // Where the removed paragraph used to be: the end of the one before it.
    expect(found?.pos).toBe(posAfter(doc(p1, p3), p1));
  });

  it("invents no position when the text is gone or ambiguous", () => {
    const before = doc(p1, p2, p3);
    const anchor = captureAnchor(before, posAfter(before, "found one"), 4, 0);
    expect(resolveAnchor(doc(p1, p3), anchor, 5)).toBeNull();
    // The same passage twice: which one is meant can't be known.
    expect(resolveAnchor(doc(p2, p3, p2, p3), { ...anchor, pos: 9999 }, 5)).toBeNull();
  });
});

describe("work places: Return to Work", () => {
  const scene3: WorkEntry = { kind: "scene", id: "s3", href: "/books/b/scenes/s3" };
  const scene4: WorkEntry = { kind: "scene", id: "s4", href: "/books/b/scenes/s4" };
  const note: WorkEntry = { kind: "note", id: "n1", href: "/notes/n1" };

  it("returns to the work from any detour, not one step back", () => {
    const stack = visitWork([], scene3);
    expect(returnTarget(stack, "/characters/c1")).toEqual(scene3);
    expect(returnTarget(stack, "/relationships/r1")).toEqual(scene3);
    // Only looking at another scene or note is a detour, not new work.
    expect(visitWork(stack, scene4)).toEqual([scene3]);
    expect(returnTarget(stack, scene3.href)).toBeNull();
  });

  it("writing in a note during a detour nests it; finishing it returns to the scene", () => {
    let stack = editWork(visitWork([], scene3), note);
    expect(stack).toEqual([scene3, note]);
    expect(returnTarget(stack, "/calendar")).toEqual(note);
    expect(returnTarget(stack, note.href)).toEqual(scene3);
    stack = visitWork(stack, scene3);
    expect(stack).toEqual([scene3]);
  });

  it("writing in another scene moves the work on", () => {
    expect(editWork(editWork([scene3], note), scene4)).toEqual([scene4]);
  });
});
