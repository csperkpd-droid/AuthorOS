import { describe, expect, it } from "vitest";

import { blocksToMarkdown, docToBlocks } from "./doc-blocks";

const text = (t: string, ...marks: string[]) => ({
  type: "text",
  text: t,
  ...(marks.length ? { marks: marks.map((type) => ({ type })) } : {}),
});

const doc = {
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 2 }, content: [text("The Storm")] },
    {
      type: "paragraph",
      content: [
        text("She ran "),
        text("fast", "bold"),
        text(" and "),
        text("far ", "italic"),
        text("away."),
      ],
    },
    { type: "paragraph", content: [text("Line one"), { type: "hardBreak" }, text("Line two")] },
    {
      type: "blockquote",
      content: [{ type: "paragraph", content: [text("A quote *with* stars")] }],
    },
    {
      type: "orderedList",
      attrs: { start: 1 },
      content: [
        { type: "listItem", content: [{ type: "paragraph", content: [text("first")] }] },
        { type: "listItem", content: [{ type: "paragraph", content: [text("second")] }] },
      ],
    },
    { type: "horizontalRule" },
    { type: "paragraph", content: [text("End.")] },
  ],
};

describe("document export blocks", () => {
  it("flattens a document into styled blocks", () => {
    const blocks = docToBlocks(doc);
    expect(blocks.map((b) => b.type)).toEqual([
      "heading",
      "paragraph",
      "paragraph",
      "paragraph",
      "listItem",
      "listItem",
      "rule",
      "paragraph",
    ]);
    expect(blocks[1]).toMatchObject({
      runs: [
        { text: "She ran " },
        { text: "fast", bold: true },
        { text: " and " },
        { text: "far ", italic: true },
        { text: "away." },
      ],
    });
    expect(docToBlocks(null)).toEqual([]);
  });

  it("renders Markdown, escaping text and keeping spaces outside markers", () => {
    expect(blocksToMarkdown(docToBlocks(doc), { headingOffset: 1 })).toBe(
      [
        "### The Storm",
        "",
        "She ran **fast** and *far* away.",
        "",
        "Line one  \nLine two",
        "",
        "> A quote \\*with\\* stars",
        "",
        "1. first",
        "2. second",
        "",
        "* * *",
        "",
        "End.",
      ].join("\n"),
    );
  });
});
