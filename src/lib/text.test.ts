import { describe, expect, it } from "vitest";

import { countWords, docSchema, docToText } from "./text";

const doc = {
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Chapter One" }] },
    {
      type: "paragraph",
      content: [
        { type: "text", text: "It was a " },
        { type: "text", text: "dark", marks: [{ type: "italic" }] },
        { type: "text", text: " night." },
        { type: "hardBreak" },
        { type: "text", text: "Then dawn." },
      ],
    },
    { type: "paragraph" },
    {
      type: "bulletList",
      content: [
        {
          type: "listItem",
          content: [{ type: "paragraph", content: [{ type: "text", text: "one" }] }],
        },
        {
          type: "listItem",
          content: [{ type: "paragraph", content: [{ type: "text", text: "two" }] }],
        },
      ],
    },
  ],
};

describe("docToText", () => {
  it("joins inline text and separates blocks", () => {
    expect(docToText(doc)).toBe(
      "Chapter One\n\nIt was a dark night.\nThen dawn.\n\n\n\none\n\ntwo",
    );
  });

  it("handles empty documents", () => {
    expect(docToText(null)).toBe("");
    expect(docToText({ type: "doc" })).toBe("");
  });
});

describe("countWords", () => {
  it.each([
    ["", 0],
    ["   ", 0],
    ["One two  three", 3],
    ["Don't stop—the well-known café’s door.", 6],
    ["It's 9 o'clock, 2024!", 4],
    ["— … !!", 0],
    ["Ça va? Über naïve résumé", 5],
  ])("%j has %i words", (text, expected) => {
    expect(countWords(text)).toBe(expected);
  });

  it("counts a document", () => {
    expect(countWords(docToText(doc))).toBe(11);
  });
});

describe("docSchema", () => {
  it("accepts a Tiptap document", () => {
    expect(docSchema.safeParse(doc).success).toBe(true);
  });

  it("rejects non-documents", () => {
    expect(docSchema.safeParse({ type: "paragraph" }).success).toBe(false);
    expect(docSchema.safeParse("text").success).toBe(false);
  });

  it("rejects oversized documents", () => {
    const huge = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "x".repeat(2_100_000) }] }],
    };
    expect(docSchema.safeParse(huge).success).toBe(false);
  });
});
