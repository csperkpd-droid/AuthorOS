import { getSchema } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { describe, expect, it } from "vitest";

import { anchorText, findAnchor, makeAnchor, reanchor, type TextAnchor } from "./anchors";
import { flattenDoc } from "./work-place";

const p = (text?: string) => ({
  type: "paragraph",
  ...(text ? { content: [{ type: "text", text }] } : {}),
});
const doc = (...content: object[]) => ({ type: "doc", content });

/** An anchor on the first occurrence of `quote` in `text`. */
const on = (text: string, quote: string, from = 0): TextAnchor => {
  const start = text.indexOf(quote, from);
  return makeAnchor(text, start, start + quote.length);
};

describe("anchor text", () => {
  it("is exactly the editor's flattening of the same document", () => {
    const schema = getSchema([StarterKit.configure({ heading: { levels: [2, 3] }, link: false })]);
    const samples = [
      doc(p("One."), p(), p("Two")),
      doc(
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Title" }] },
        p("A line"),
        { type: "horizontalRule" },
        {
          type: "blockquote",
          content: [
            {
              type: "paragraph",
              content: [
                { type: "text", text: "quoted " },
                { type: "text", text: "bold", marks: [{ type: "bold" }] },
                { type: "hardBreak" },
                { type: "text", text: "next" },
              ],
            },
          ],
        },
        {
          type: "bulletList",
          content: [{ type: "listItem", content: [p("item one"), p("item two")] }],
        },
      ),
      doc(p()),
    ];
    for (const json of samples)
      expect(anchorText(json)).toBe(flattenDoc(schema.nodeFromJSON(json)).text);
  });

  it("is empty for an empty or missing document", () => {
    expect(anchorText(null)).toBe("");
    expect(anchorText(doc())).toBe("");
  });
});

describe("finding an anchor again", () => {
  const original = "The storm came in at dusk.\nMara ran to the quay. The lamps went out.";
  const anchor = on(original, "Mara ran to the quay.");

  it("stays where it is when nothing changed", () => {
    expect(findAnchor(original, anchor)).toEqual({ start: anchor.start, end: anchor.end });
  });

  it("follows the passage when text is typed before it", () => {
    const text = `A new opening.\nAnother paragraph.\n${original}`;
    const found = findAnchor(text, anchor)!;
    expect(text.slice(found.start, found.end)).toBe("Mara ran to the quay.");
  });

  it("follows the passage when text right before it changes (the other side still matches)", () => {
    const text = original.replace("at dusk.", "late.");
    const found = findAnchor(text, anchor)!;
    expect(text.slice(found.start, found.end)).toBe("Mara ran to the quay.");
  });

  it("follows the passage when unrelated text is deleted", () => {
    const text = original.replace("The storm came in at dusk.\n", "");
    expect(findAnchor(text, anchor)).toEqual({ start: 0, end: anchor.quote.length });
  });

  it("needs review when the quoted sentence is rewritten or removed", () => {
    expect(findAnchor(original.replace("ran to", "walked to"), anchor)).toBeNull();
    expect(findAnchor(original.replace("Mara ran to the quay. ", ""), anchor)).toBeNull();
  });

  it("needs review when both sides of the passage changed", () => {
    const text = original.replace("at dusk.", "late.").replace("The lamps went out.", "Rain.");
    expect(findAnchor(text, anchor)).toBeNull();
  });

  it("tells repeated quotes apart by their context", () => {
    const text = "He said yes. She laughed.\nLater, he said yes. Nobody laughed.";
    const second = on(text, "he said yes.", 20);
    const edited = `Prologue.\n${text}`;
    const found = findAnchor(edited, second)!;
    expect(found.start).toBe(edited.lastIndexOf("he said yes."));
  });

  it("needs review when a repeated quote can't be told apart", () => {
    const base = "Again. Again. Again.";
    const middle = on(base, "Again.", 7);
    // Every occurrence now has one matching side: no single place.
    expect(findAnchor("Again. Again.", middle)).toBeNull();
  });

  it("never matches part of a quote or a near spelling", () => {
    const short = on(original, "The lamps went out.");
    expect(findAnchor(original.replace("lamps", "lamp"), short)).toBeNull();
    expect(findAnchor(original.replace("went out.", "went"), short)).toBeNull();
  });

  it("keeps a passage at the very start or end of the text tied there", () => {
    const first = on(original, "The storm");
    expect(findAnchor(`x ${original}`, first)).toEqual({
      start: 2,
      end: 2 + "The storm".length,
    });
    const atStart = makeAnchor("Go now.", 0, 2);
    // "Go" no longer starts the text and nothing else agrees: not certain.
    expect(findAnchor("We Go there.", atStart)).toBeNull();
  });

  it("refreshes the context to the new text when it re-anchors", () => {
    const text = `New line.\n${original}`;
    const next = reanchor(text, anchor)!;
    expect(next.quote).toBe(anchor.quote);
    expect(text.slice(next.start, next.end)).toBe(anchor.quote);
    expect(next.prefix).toBe(text.slice(Math.max(0, next.start - 32), next.start));
  });
});
