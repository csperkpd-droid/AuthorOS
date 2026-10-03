import { createHash } from "node:crypto";

import type { WorkspaceBundle } from "./bundle";

/**
 * Upgrades a parsed bundle to the current export format, so backups made by
 * earlier versions keep importing. One step per format version.
 *
 * Ids created here are derived from the file's own ids (a hash), so the
 * same file always produces the same bundle: the review and the import
 * then plan the same rows.
 */
export function upgradeBundle(bundle: WorkspaceBundle): WorkspaceBundle {
  let b = bundle;
  if (b.version < 2) b = toVersion2(b);
  return b;
}

/**
 * Version 2: pen names are story nodes; a book's due date is a deadline
 * entry on the calendar, about the book.
 */
function toVersion2(b: WorkspaceBundle): WorkspaceBundle {
  const nodes = new Set(b.storyNodes.map((n) => n.id));
  const storyNodes = [
    ...b.penNames
      .filter((p) => !nodes.has(p.id))
      .map((p) => ({ id: p.id, kind: "PEN_NAME" as const })),
    ...b.storyNodes,
  ];
  const deadlines = b.books
    .filter((book) => book.dueOn)
    .map((book) => ({
      id: derivedId(`${book.id}:deadline`),
      title: "Deadline",
      description: null,
      startsOn: book.dueOn!,
      endsOn: null,
      startTime: null,
      purpose: "DEADLINE" as const,
      subjectId: book.id,
      createdAt: book.updatedAt,
      updatedAt: book.updatedAt,
      deletedAt: null,
    }));
  return {
    ...b,
    version: 2,
    storyNodes: [...storyNodes, ...deadlines.map((d) => ({ id: d.id, kind: "EVENT" as const }))],
    books: b.books.map((book) => ({ ...book, dueOn: null })),
    calendarEvents: [...b.calendarEvents, ...deadlines],
  };
}

/** A stable UUID (version 8, name-based) derived from `seed`. */
export function derivedId(seed: string): string {
  const hex = createHash("sha256").update(seed).digest("hex").slice(0, 32).split("");
  hex[12] = "8"; // version 8
  hex[16] = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16); // RFC 4122 variant
  const h = hex.join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
