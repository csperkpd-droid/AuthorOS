import type { DocNode } from "./text";

/**
 * A ProseMirror/Tiptap document as a flat list of blocks with styled runs:
 * the neutral form every export renders from (Markdown, DOCX, later EPUB).
 */
export type Run = {
  text: string;
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
  underline?: boolean;
  code?: boolean;
  /** A line break inside the paragraph. */
  lineBreak?: boolean;
};

export type Block =
  | { type: "paragraph"; runs: Run[]; quote?: boolean }
  | { type: "heading"; level: number; runs: Run[] }
  | { type: "listItem"; runs: Run[]; ordered: boolean; index: number; depth: number }
  | { type: "code"; text: string }
  | { type: "rule" };

function runsOf(node: DocNode): Run[] {
  const runs: Run[] = [];
  for (const child of node.content ?? []) {
    if (child.type === "hardBreak") {
      runs.push({ text: "", lineBreak: true });
    } else if (child.type === "text" && child.text) {
      const marks = new Set((child.marks ?? []).map((m) => m.type));
      runs.push({
        text: child.text,
        ...(marks.has("bold") && { bold: true }),
        ...(marks.has("italic") && { italic: true }),
        ...(marks.has("strike") && { strike: true }),
        ...(marks.has("underline") && { underline: true }),
        ...(marks.has("code") && { code: true }),
      });
    } else if (child.content) {
      runs.push(...runsOf(child));
    }
  }
  return runs;
}

const plain = (node: DocNode): string =>
  node.type === "text" ? (node.text ?? "") : (node.content ?? []).map(plain).join("");

export function docToBlocks(doc: DocNode | null | undefined): Block[] {
  const blocks: Block[] = [];
  const walk = (node: DocNode, ctx: { quote: boolean; depth: number }) => {
    switch (node.type) {
      case "doc":
        for (const c of node.content ?? []) walk(c, ctx);
        return;
      case "paragraph":
        blocks.push({ type: "paragraph", runs: runsOf(node), ...(ctx.quote && { quote: true }) });
        return;
      case "heading":
        blocks.push({ type: "heading", level: Number(node.attrs?.level ?? 2), runs: runsOf(node) });
        return;
      case "blockquote":
        for (const c of node.content ?? []) walk(c, { ...ctx, quote: true });
        return;
      case "bulletList":
      case "orderedList": {
        const ordered = node.type === "orderedList";
        const start = Number(node.attrs?.start ?? 1);
        (node.content ?? []).forEach((item, i) => {
          const [first, ...rest] = item.content ?? [];
          blocks.push({
            type: "listItem",
            runs: first ? runsOf(first) : [],
            ordered,
            index: start + i,
            depth: ctx.depth,
          });
          for (const c of rest) walk(c, { ...ctx, depth: ctx.depth + 1 });
        });
        return;
      }
      case "codeBlock":
        blocks.push({ type: "code", text: plain(node) });
        return;
      case "horizontalRule":
        blocks.push({ type: "rule" });
        return;
      default:
        // Unknown blocks keep their text.
        if (node.content?.length) blocks.push({ type: "paragraph", runs: runsOf(node) });
    }
  };
  if (doc) walk(doc, { quote: false, depth: 0 });
  return blocks;
}

const MD_SPECIAL = /([\\`*_[\]#<>~])/g;

function runsToMarkdown(runs: Run[]): string {
  return runs
    .map((r) => {
      if (r.lineBreak) return "  \n";
      if (r.code) return `\`${r.text.replaceAll("`", "")}\``;
      let t = r.text.replace(MD_SPECIAL, "\\$1");
      // Keep surrounding spaces outside the markers ("**word** ", not "**word **").
      const lead = t.match(/^\s*/)![0];
      const trail = t.match(/\s*$/)![0];
      t = t.trim();
      if (!t) return lead + trail;
      if (r.strike) t = `~~${t}~~`;
      if (r.italic) t = `*${t}*`;
      if (r.bold) t = `**${t}**`;
      return lead + t + trail;
    })
    .join("");
}

/** Markdown for blocks. `headingOffset` shifts heading levels (a scene's h2 under a chapter). */
export function blocksToMarkdown(blocks: Block[], { headingOffset = 0 } = {}): string {
  const out: string[] = [];
  for (const b of blocks) {
    switch (b.type) {
      case "paragraph":
        out.push((b.quote ? "> " : "") + runsToMarkdown(b.runs).replace(/[ \t]+$/, ""));
        break;
      case "heading":
        out.push(`${"#".repeat(Math.min(b.level + headingOffset, 6))} ${runsToMarkdown(b.runs)}`);
        break;
      case "listItem":
        out.push(
          `${"  ".repeat(b.depth)}${b.ordered ? `${b.index}.` : "-"} ${runsToMarkdown(b.runs)}`,
        );
        break;
      case "code":
        out.push("```\n" + b.text + "\n```");
        break;
      case "rule":
        out.push("* * *");
        break;
    }
  }
  // Consecutive list items stay together; other blocks are separated.
  return out
    .map((line, i) => {
      const prev = blocks[i - 1];
      const tight = prev?.type === "listItem" && blocks[i].type === "listItem";
      return (i === 0 || tight ? "" : "\n") + line;
    })
    .join("\n");
}
