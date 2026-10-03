import "server-only";

import {
  AlignmentType,
  Document,
  HeadingLevel,
  LevelFormat,
  Packer,
  PageBreak,
  Paragraph,
  TextRun,
} from "docx";

import { blocksToMarkdown, docToBlocks, type Block, type Run } from "@/lib/doc-blocks";
import { db } from "@/lib/db";
import { RuleError } from "@/lib/errors";
import { formatWords } from "@/lib/format";
import type { DocNode } from "@/lib/text";
import { getBook } from "@/modules/library";
import { getBookTree } from "@/modules/manuscript";
import type { AuthorContext } from "@/server/context";
import { assertCan } from "@/server/policy";

import { booksInScope, resolveScope } from "./scope";
import type { ExportScopeInput } from "./schemas";

/**
 * Human-readable manuscript exports (Markdown, DOCX). Read-only: they read
 * the visible manuscript (nothing in the Trash) and never change it. Not a
 * backup: the structured JSON export is.
 */

type Chapter = { title: string; scenes: { title: string; content: DocNode | null }[] };
type Manuscript = {
  title: string;
  subtitle: string | null;
  penName: string;
  wordCount: number;
  /** Top level in order: parts (with chapters) and part-less chapters. */
  items: ({ kind: "part"; title: string; chapters: Chapter[] } | ({ kind: "chapter" } & Chapter))[];
};

async function loadManuscript(ctx: AuthorContext, bookId: string): Promise<Manuscript> {
  const [book, tree] = await Promise.all([getBook(ctx, bookId), getBookTree(ctx, bookId)]);
  const contents = await db.scene.findMany({
    where: { id: { in: tree.sceneOrder.map((s) => s.id) } },
    select: { id: true, content: true },
  });
  const byId = new Map(contents.map((s) => [s.id, s.content as DocNode | null]));
  const chapter = (c: { title: string; scenes: { id: string; title: string }[] }): Chapter => ({
    title: c.title,
    scenes: c.scenes.map((s) => ({ title: s.title, content: byId.get(s.id) ?? null })),
  });
  return {
    title: book.title,
    subtitle: book.subtitle,
    penName: book.penName.name,
    wordCount: tree.wordCount,
    items: tree.items.map((i) =>
      i.kind === "part"
        ? { kind: "part" as const, title: i.title, chapters: i.chapters.map(chapter) }
        : { kind: "chapter" as const, ...chapter(i) },
    ),
  };
}

/** The books to export: those chosen (in scope), or every book in scope. */
async function manuscripts(ctx: AuthorContext, scope: ExportScopeInput, bookIds?: string[]) {
  const resolved = await resolveScope(ctx, scope);
  const books = (await booksInScope(ctx, resolved)).filter(
    (b) => !bookIds?.length || bookIds.includes(b.id),
  );
  if (books.length === 0) throw new RuleError("There are no books to export in this selection.");
  return {
    resolved,
    books: await Promise.all(books.map((b) => loadManuscript(ctx, b.id))),
  };
}

const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-|-$/g, "") || "manuscript";

function fileBase(books: Manuscript[], scopeSlug: string) {
  return books.length === 1 ? slugify(books[0].title) : `${scopeSlug}-manuscripts`;
}

// ─── Markdown ───────────────────────────────────────────────────────────────

export async function exportMarkdown(
  ctx: AuthorContext,
  { scope, bookIds }: { scope: ExportScopeInput; bookIds?: string[] },
) {
  assertCan(ctx, "edit", "manuscript");
  const { resolved, books } = await manuscripts(ctx, scope, bookIds);
  const out: string[] = [];
  for (const book of books) {
    out.push(`# ${book.title}`);
    if (book.subtitle) out.push(`*${book.subtitle}*`);
    out.push(`by ${book.penName}`);
    const chapter = (c: Chapter, level: number) => {
      out.push(`${"#".repeat(level)} ${c.title}`);
      c.scenes.forEach((s, i) => {
        if (i > 0) out.push("* * *");
        const md = blocksToMarkdown(docToBlocks(s.content), { headingOffset: level - 1 });
        if (md) out.push(md);
      });
    };
    for (const item of book.items) {
      if (item.kind === "part") {
        out.push(`## ${item.title}`);
        for (const c of item.chapters) chapter(c, 3);
      } else {
        chapter(item, 2);
      }
    }
  }
  return {
    filename: `${fileBase(books, resolved.slug)}.md`,
    content: out.join("\n\n") + "\n",
  };
}

// ─── DOCX (standard manuscript format) ──────────────────────────────────────

const FONT = "Times New Roman";
const SIZE = 24; // half-points: 12 pt
const DOUBLE = 480; // line spacing in 240ths: double-spaced
const INDENT = 720; // twips: 0.5 inch

function textRuns(runs: Run[]): TextRun[] {
  return runs.map((r) =>
    r.lineBreak
      ? new TextRun({ text: "", break: 1 })
      : new TextRun({
          text: r.text,
          bold: r.bold,
          italics: r.italic,
          strike: r.strike,
          underline: r.underline ? {} : undefined,
          font: r.code ? "Courier New" : undefined,
        }),
  );
}

function blockParagraphs(blocks: Block[]): Paragraph[] {
  return blocks.map((b) => {
    switch (b.type) {
      case "heading":
        return new Paragraph({
          children: textRuns(b.runs.map((r) => ({ ...r, bold: true }))),
          spacing: { line: DOUBLE },
        });
      case "listItem":
        return new Paragraph({
          children: textRuns(b.runs),
          numbering: { reference: b.ordered ? "ordered" : "bullets", level: Math.min(b.depth, 2) },
          spacing: { line: DOUBLE },
        });
      case "code":
        return new Paragraph({
          children: [new TextRun({ text: b.text, font: "Courier New" })],
          spacing: { line: DOUBLE },
        });
      case "rule":
        return new Paragraph({
          children: [new TextRun("#")],
          alignment: AlignmentType.CENTER,
          spacing: { line: DOUBLE },
        });
      case "paragraph":
        return new Paragraph({
          children: textRuns(b.runs),
          indent: b.quote ? { left: INDENT * 2 } : { firstLine: INDENT },
          spacing: { line: DOUBLE },
        });
    }
  });
}

function bookSection(book: Manuscript) {
  const children: Paragraph[] = [
    new Paragraph({ text: book.penName, spacing: { line: DOUBLE } }),
    new Paragraph({
      text: `About ${formatWords(Math.round(book.wordCount / 100) * 100 || book.wordCount)}`,
      spacing: { line: DOUBLE },
    }),
    new Paragraph({
      children: [new TextRun({ text: book.title.toUpperCase(), bold: true })],
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
      spacing: { before: 3600, line: DOUBLE },
    }),
    ...(book.subtitle
      ? [
          new Paragraph({
            text: book.subtitle,
            alignment: AlignmentType.CENTER,
            spacing: { line: DOUBLE },
          }),
        ]
      : []),
    new Paragraph({
      text: `by ${book.penName}`,
      alignment: AlignmentType.CENTER,
      spacing: { line: DOUBLE },
    }),
  ];
  const chapter = (c: Chapter) => {
    children.push(
      new Paragraph({
        children: [new PageBreak(), new TextRun({ text: c.title, bold: true })],
        heading: HeadingLevel.HEADING_1,
        alignment: AlignmentType.CENTER,
        spacing: { before: 2400, after: 480, line: DOUBLE },
      }),
    );
    c.scenes.forEach((s, i) => {
      if (i > 0)
        children.push(
          new Paragraph({ text: "#", alignment: AlignmentType.CENTER, spacing: { line: DOUBLE } }),
        );
      children.push(...blockParagraphs(docToBlocks(s.content)));
    });
  };
  for (const item of book.items) {
    if (item.kind === "part") {
      children.push(
        new Paragraph({
          children: [new PageBreak(), new TextRun({ text: item.title.toUpperCase(), bold: true })],
          heading: HeadingLevel.HEADING_1,
          alignment: AlignmentType.CENTER,
          spacing: { before: 3600, line: DOUBLE },
        }),
      );
      item.chapters.forEach(chapter);
    } else {
      chapter(item);
    }
  }
  return { properties: {}, children };
}

export async function exportDocx(
  ctx: AuthorContext,
  { scope, bookIds }: { scope: ExportScopeInput; bookIds?: string[] },
) {
  assertCan(ctx, "edit", "manuscript");
  const { resolved, books } = await manuscripts(ctx, scope, bookIds);
  const list = (
    reference: string,
    format: (typeof LevelFormat)[keyof typeof LevelFormat],
    text: string,
  ) => ({
    reference,
    levels: [0, 1, 2].map((level) => ({
      level,
      format,
      text: text.replace("%", `%${level + 1}`),
      alignment: AlignmentType.LEFT,
      style: { paragraph: { indent: { left: INDENT * (level + 1), hanging: 360 } } },
    })),
  });
  const doc = new Document({
    creator: "AuthorOS",
    title: books.length === 1 ? books[0].title : "Manuscripts",
    styles: { default: { document: { run: { font: FONT, size: SIZE } } } },
    numbering: {
      config: [
        list("bullets", LevelFormat.BULLET, "•"),
        list("ordered", LevelFormat.DECIMAL, "%."),
      ],
    },
    sections: books.map(bookSection),
  });
  return {
    filename: `${fileBase(books, resolved.slug)}.docx`,
    buffer: await Packer.toBuffer(doc),
  };
}
