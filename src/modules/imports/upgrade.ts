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
  if (b.version < 3) b = toVersion3(b);
  if (b.version < 4) b = toVersion4(b);
  // Version 5 (M12) only added Story Time (`timelineEvents`, `sceneStoryTimes`).
  if (b.version < 5) b = { ...b, version: 5 };
  if (b.version < 6) b = toVersion6(b);
  if (b.version < 7) b = toVersion7(b);
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

/**
 * Version 3: a book's writing status is separate from publication.
 * "Published" becomes writing status Complete, and the fact that the book
 * was published is kept as a "Publication status" field value (as the
 * database migration did), until editions carry it.
 */
function toVersion3(b: WorkspaceBundle): WorkspaceBundle {
  const WRITING = ["PLANNING", "DRAFTING", "REVISING", "COMPLETE"] as const;
  const published = b.books.filter((book) => book.status === "PUBLISHED");
  const existing = b.fieldDefinitions.find(
    (f) =>
      f.nodeKind === "BOOK" &&
      !f.penNameId &&
      !f.seriesId &&
      !f.bookId &&
      f.label.toLowerCase() === "publication status",
  );
  const field =
    existing ??
    (published.length
      ? {
          id: derivedId(`${published[0].id}:publication-status`),
          penNameId: null,
          seriesId: null,
          bookId: null,
          nodeKind: "BOOK" as const,
          label: "Publication status",
          type: "TEXT" as const,
          position: "a0",
          createdAt: published[0].updatedAt,
        }
      : null);
  const valued = new Set(b.fieldValues.map((v) => `${v.nodeId}|${v.fieldId}`));
  return {
    ...b,
    version: 3,
    books: b.books.map(({ status, ...book }) => ({
      ...book,
      writingStatus: (WRITING as readonly string[]).includes(status ?? "")
        ? (status as (typeof WRITING)[number])
        : status === "PUBLISHED"
          ? "COMPLETE"
          : book.writingStatus,
    })),
    fieldDefinitions: field && !existing ? [...b.fieldDefinitions, field] : b.fieldDefinitions,
    fieldValues: [
      ...b.fieldValues,
      ...(field
        ? published
            .filter((book) => !valued.has(`${book.id}|${field.id}`))
            .map((book) => ({
              nodeId: book.id,
              fieldId: field.id,
              value: "Published",
              updatedAt: book.updatedAt,
            }))
        : []),
    ],
  };
}

/**
 * Version 4 (M11): a character in a scene is Scene Participation, not an
 * `appears_in` connection. As the database migration did: point of view →
 * point of view and present; present → present; mentioned → mentioned.
 */
function toVersion4(b: WorkspaceBundle): WorkspaceBundle {
  const appearances = b.connections.filter((c) => c.kind === "appears_in");
  return {
    ...b,
    version: 4,
    connections: b.connections.filter((c) => c.kind !== "appears_in"),
    sceneParticipations: [
      ...b.sceneParticipations,
      ...appearances.map((c) => ({
        sceneId: c.targetId,
        characterId: c.sourceId,
        presence: c.attributes.role === "MENTIONED" ? ("MENTIONED" as const) : ("PRESENT" as const),
        isPov: c.attributes.role === "POV",
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
      })),
    ],
  };
}

/**
 * Version 6 (M13): book tropes are Trope objects linked by `uses_trope`
 * connections, as the database migration did: trimmed, blanks dropped,
 * values equal ignoring case are one trope (named by the most used
 * spelling), and every book keeps each of its tropes.
 */
function toVersion6(b: WorkspaceBundle): WorkspaceBundle {
  const spellings = new Map<string, Map<string, number>>();
  const uses: { bookId: string; key: string; at: Date }[] = [];
  for (const book of b.books) {
    const keys = new Set<string>();
    for (const raw of book.tropes ?? []) {
      const name = raw.trim();
      if (!name) continue;
      const key = name.toLowerCase();
      const counts = spellings.get(key) ?? new Map<string, number>();
      counts.set(name, (counts.get(name) ?? 0) + 1);
      spellings.set(key, counts);
      if (!keys.has(key)) uses.push({ bookId: book.id, key, at: book.updatedAt });
      keys.add(key);
    }
  }
  // Ids from the file's own ids: the first book using each trope.
  const idOf = new Map(
    [...spellings.keys()].map((key) => [
      key,
      derivedId(`${uses.find((u) => u.key === key)!.bookId}:trope:${key}`),
    ]),
  );
  const tropes = [...spellings].map(([key, counts]) => {
    const [name] = [...counts].sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1))[0];
    const at = uses.find((u) => u.key === key)!.at;
    return {
      id: idOf.get(key)!,
      name: name.slice(0, 200),
      description: null,
      createdAt: at,
      updatedAt: at,
      deletedAt: null,
    };
  });
  return {
    ...b,
    version: 6,
    books: b.books.map((book) => ({ ...book, tropes: [] })),
    storyNodes: [...b.storyNodes, ...tropes.map((t) => ({ id: t.id, kind: "TROPE" as const }))],
    tropes: [...b.tropes, ...tropes],
    connections: [
      ...b.connections,
      ...uses.map((u) => ({
        id: derivedId(`${u.bookId}:uses_trope:${u.key}`),
        sourceId: u.bookId,
        targetId: idOf.get(u.key)!,
        kind: "uses_trope",
        label: null,
        note: null,
        attributes: {},
        createdAt: u.at,
        updatedAt: u.at,
      })),
    ],
  };
}

/**
 * Version 7 (M14): beats are story objects, as the database migration did:
 * each beat gets a story node with its own id, its description history moves
 * from the structure ("beat:<id>.description") onto the beat. Assignments
 * get their validity from the imported state when applied (no exception).
 */
function toVersion7(b: WorkspaceBundle): WorkspaceBundle {
  const nodes = new Set(b.storyNodes.map((n) => n.id));
  const beats = new Map(b.outlineBeats.map((x) => [x.id, x.outlineId]));
  const BEAT_FIELD = /^beat:([0-9a-f-]{36})\.description$/;
  return {
    ...b,
    version: 7,
    storyNodes: [
      ...b.storyNodes,
      ...b.outlineBeats
        .filter((x) => !nodes.has(x.id))
        .map((x) => ({ id: x.id, kind: "BEAT" as const })),
    ],
    fieldRevisions: b.fieldRevisions.map((r) => {
      const beatId = BEAT_FIELD.exec(r.field)?.[1];
      return beatId && beats.get(beatId) === r.nodeId
        ? { ...r, nodeId: beatId, field: "description" }
        : r;
    }),
    beatScenes: b.beatScenes.map((a) => ({
      ...a,
      validity: "CURRENT" as const,
      exceptedAt: null,
      note: null,
    })),
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
