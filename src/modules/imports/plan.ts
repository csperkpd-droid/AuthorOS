import "server-only";

import { createHash } from "node:crypto";

import type { Prisma, StoryNodeKind } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { uuidv7 } from "@/lib/ids";
import { countWords, docToText, type Doc } from "@/lib/text";
import { getKind, isConnectionKind } from "@/modules/connections";
import { NODE_KIND_LABELS } from "@/modules/story-graph";
import type { AuthorContext } from "@/server/context";

import type { WorkspaceBundle } from "./bundle";

/**
 * Import planning: decides, for every row of a bundle, whether it will be
 * created, update an existing row, be skipped, or conflicts, without
 * changing anything. The review shows the plan; the import recomputes it in
 * its transaction and applies it only if it still has the same fingerprint.
 *
 * - **ids "keep"** restores with the original ids (Story Graph ids
 *   preserved). An id already used by another workspace is a conflict:
 *   import as a copy instead. Rows that aren't story objects (beats,
 *   connections…) keep their id when it's free and get a new one otherwise.
 * - **ids "new"** imports a copy: every object gets a new id, references
 *   follow.
 * - **existing "skip"** keeps objects that already exist here as they are;
 *   **"replace"** updates them to the file's version (scene and note text
 *   is saved as a version first). Missing objects are restored either way.
 *
 * Pen names match existing ones by id, then by name; the default pen name
 * never changes. Relationships match by their members, custom fields by
 * kind, scope and name. Imported rows belong to the importing author.
 */

export type ImportOptions = { ids: "keep" | "new"; existing: "skip" | "replace" };

export type Row = Record<string, unknown>;
export type TableOps = { create: Row[]; update: { id: string; data: Row }[] };

export type ImportConflict = { key: string; title: string; detail: string; items: string[] };

export type ImportCount = {
  key: string;
  label: string;
  create: number;
  update: number;
  skip: number;
};

export type ImportPlan = {
  counts: ImportCount[];
  conflicts: ImportConflict[];
  adjustments: string[];
  ops: ImportOps;
  fingerprint: string;
};

export type ImportOps = {
  penNames: TableOps;
  nodes: { id: string; kind: StoryNodeKind }[];
  series: TableOps;
  books: TableOps;
  parts: TableOps;
  chapters: TableOps;
  scenes: TableOps;
  characters: TableOps;
  relationships: TableOps;
  relationshipMembers: Row[];
  memberRoles: { relationshipId: string; characterId: string; role: string | null }[];
  notes: TableOps;
  ideas: TableOps;
  tasks: TableOps;
  calendarEvents: TableOps;
  templates: TableOps;
  templateBeats: TableOps;
  outlines: TableOps;
  outlineBeats: TableOps;
  beatScenes: Row[];
  sceneParticipations: TableOps;
  connections: TableOps;
  kits: TableOps;
  kitItems: Row[];
  /** Kits whose items are replaced by the file's. */
  kitItemsReplaced: string[];
  fieldDefinitions: TableOps;
  fieldValues: TableOps;
  writingSessions: TableOps;
  revisions: Row[];
  fieldRevisions: Row[];
  /** Scenes and notes whose current text is saved as a version before replacing. */
  snapshots: { kind: "SCENE" | "NOTE"; id: string }[];
  dailyWordGoal: number | null;
};

type Client = typeof db | Prisma.TransactionClient;

const ZERO = "00000000-0000-0000-0000-000000000000";
const TIMESTAMPS = new Set(["createdAt", "updatedAt"]);

/** Plans an import of `bundle` into the author's workspace. Read-only. */
export async function planImport(
  ctx: AuthorContext,
  bundle: WorkspaceBundle,
  options: ImportOptions,
  client: Client = db,
): Promise<ImportPlan> {
  const ws = ctx.workspaceId;
  const keep = options.ids === "keep";
  const replace = options.existing === "replace";
  const b = bundle;

  const map = new Map<string, string>();
  const to = (id: string) => map.get(id) ?? id;
  const toRef = (id: string | null) => (id ? to(id) : null);
  const decisions: unknown[] = [];
  const conflicts = new Map<string, ImportConflict>();
  const conflict = (key: string, title: string, detail: string, item: string) => {
    const c = conflicts.get(key) ?? { key, title, detail, items: [] };
    c.items.push(item);
    conflicts.set(key, c);
  };
  const adjustments: string[] = [];
  const counts = new Map<string, ImportCount>();
  const count = (key: string, label: string, action: "create" | "update" | "skip", n = 1) => {
    const c = counts.get(key) ?? { key, label, create: 0, update: 0, skip: 0 };
    c[action] += n;
    counts.set(key, c);
  };

  // ── What already exists ──────────────────────────────────────────────────
  const nodeIds = b.storyNodes.map((n) => n.id);
  const takenNodes = keep
    ? await client.$queryRaw<{ id: string; workspace_id: string; kind: StoryNodeKind }[]>`
        SELECT "id", "workspace_id", "kind" FROM "story_nodes" WHERE "id" = ANY(${nodeIds}::uuid[])`
    : [];
  const takenNode = new Map(takenNodes.map((n) => [n.id, n]));
  const taken = async (table: string, ids: string[]) => {
    if (!ids.length) return new Map<string, string | null>();
    const rows = await client.$queryRawUnsafe<{ id: string; ws: string | null }[]>(
      TAKEN_SQL[table],
      ids,
    );
    return new Map(rows.map((r) => [r.id, r.ws]));
  };
  /** A non-node row's id: the original when free (ids "keep"), else a new one. */
  const freshId = (id: string, used: Map<string, string | null>) =>
    keep && !used.has(id) ? id : uuidv7();

  const titleOf = nodeTitles(b);
  const kindOf = new Map(b.storyNodes.map((n) => [n.id, n.kind]));
  const kindLabel = (id: string) => NODE_KIND_LABELS[kindOf.get(id)!].one;

  // ── Story objects: create, existing (update / skip) or conflict ─────────
  type NodeAction = "create" | "existing" | "conflict";
  const nodeAction = new Map<string, NodeAction>();
  for (const n of b.storyNodes) {
    // Pen names are matched by id or name below, never conflicts.
    if (n.kind === "PEN_NAME") continue;
    const label = NODE_KIND_LABELS[n.kind].one;
    if (!keep) {
      map.set(n.id, uuidv7());
      nodeAction.set(n.id, "create");
      continue;
    }
    const found = takenNode.get(n.id);
    if (!found) nodeAction.set(n.id, "create");
    else if (found.workspace_id !== ws) {
      nodeAction.set(n.id, "conflict");
      conflict(
        "elsewhere",
        "Already in another workspace",
        "These objects already exist in another workspace, so their ids can’t be reused here. Import as a copy (new ids) to bring them in.",
        `${label}: ${titleOf(n.id)}`,
      );
    } else if (found.kind !== n.kind) {
      nodeAction.set(n.id, "conflict");
      conflict(
        "kind",
        "Id used by a different kind of object",
        "In this workspace these ids belong to a different kind of object. Import as a copy (new ids) to bring them in.",
        `${label}: ${titleOf(n.id)}`,
      );
    } else nodeAction.set(n.id, "existing");
  }
  const existingIds = (rows: { id: string }[]) =>
    rows.filter((r) => nodeAction.get(r.id) === "existing").map((r) => r.id);

  const [
    exSeries,
    exBooks,
    exParts,
    exChapters,
    exScenes,
    exCharacters,
    exRelationships,
    exNotes,
    exIdeas,
    exTasks,
    exEvents,
    exOutlines,
  ] = await Promise.all([
    byId(
      chunked(existingIds(b.series), (ids) =>
        client.series.findMany({ where: { workspaceId: ws, id: { in: ids } } }),
      ),
    ),
    byId(
      chunked(existingIds(b.books), (ids) =>
        client.book.findMany({ where: { workspaceId: ws, id: { in: ids } } }),
      ),
    ),
    byId(
      chunked(existingIds(b.parts), (ids) =>
        client.part.findMany({ where: { workspaceId: ws, id: { in: ids } } }),
      ),
    ),
    byId(
      chunked(existingIds(b.chapters), (ids) =>
        client.chapter.findMany({ where: { workspaceId: ws, id: { in: ids } } }),
      ),
    ),
    byId(
      chunked(existingIds(b.scenes), (ids) =>
        client.scene.findMany({ where: { workspaceId: ws, id: { in: ids } } }),
      ),
    ),
    byId(
      chunked(existingIds(b.characters), (ids) =>
        client.character.findMany({ where: { workspaceId: ws, id: { in: ids } } }),
      ),
    ),
    byId(
      chunked(existingIds(b.relationships), (ids) =>
        client.relationship.findMany({
          where: { workspaceId: ws, id: { in: ids } },
          include: { members: true },
        }),
      ),
    ),
    byId(
      chunked(existingIds(b.notes), (ids) =>
        client.note.findMany({ where: { workspaceId: ws, id: { in: ids } } }),
      ),
    ),
    byId(
      chunked(existingIds(b.ideas), (ids) =>
        client.idea.findMany({ where: { workspaceId: ws, id: { in: ids } } }),
      ),
    ),
    byId(
      chunked(existingIds(b.tasks), (ids) =>
        client.task.findMany({ where: { workspaceId: ws, id: { in: ids } } }),
      ),
    ),
    byId(
      chunked(existingIds(b.calendarEvents), (ids) =>
        client.calendarEvent.findMany({ where: { workspaceId: ws, id: { in: ids } } }),
      ),
    ),
    byId(
      chunked(existingIds(b.outlines), (ids) =>
        client.outline.findMany({ where: { workspaceId: ws, id: { in: ids } } }),
      ),
    ),
  ]);

  const ops = emptyOps();

  // ── Pen names ────────────────────────────────────────────────────────────
  const wsPens = await client.penName.findMany({ where: { workspaceId: ws } });
  const penById = new Map(wsPens.map((p) => [p.id, p]));
  const penByName = new Map<string, (typeof wsPens)[number]>();
  for (const p of [...wsPens].sort((x, y) => Number(!!x.archivedAt) - Number(!!y.archivedAt)))
    if (!penByName.has(nameKey(p.name))) penByName.set(nameKey(p.name), p);
  const usedPenIds = await taken(
    "pen_names",
    b.penNames.map((p) => p.id),
  );
  for (const p of b.penNames) {
    const own = keep ? penById.get(p.id) : undefined;
    const byName = own ? undefined : penByName.get(nameKey(p.name));
    if (own) {
      const data = { bio: p.bio, language: p.language };
      const action = replace && differs(own, data) ? "update" : "skip";
      if (action === "update") ops.penNames.update.push({ id: own.id, data });
      count("penNames", "Pen names", action);
      decisions.push(["pen", p.id, action]);
    } else if (byName) {
      map.set(p.id, byName.id);
      count("penNames", "Pen names", "skip");
      decisions.push(["pen", p.id, "match", byName.id]);
      adjustments.push(`“${p.name}” is imported into your existing pen name of that name.`);
    } else {
      const id = freshId(p.id, usedPenIds);
      map.set(p.id, id);
      ops.penNames.create.push({
        id,
        workspaceId: ws,
        name: p.name,
        bio: p.bio,
        language: p.language,
        isDefault: false,
        archivedAt: p.archivedAt,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
      });
      count("penNames", "Pen names", "create");
      decisions.push(["pen", p.id, "create"]);
    }
  }
  if (b.penNames.some((p) => p.isDefault))
    adjustments.push("Your default pen name stays as it is.");

  /**
   * One typed table of story objects: creates the new ones; for existing
   * ones, updates when replacing and something differs (identity and
   * placement must match: an import never moves objects), else skips.
   */
  const nodes = <R extends { id: string }>(
    key: keyof ImportOps & string,
    label: string,
    rows: R[],
    existing: Map<string, Row>,
    data: (r: R) => Row,
    {
      fixed = [],
      onCreate,
      onUpdate,
    }: {
      /** Columns that must match an existing row (identity, placement). */
      fixed?: string[];
      onCreate?: (r: R, row: Row) => void;
      onUpdate?: (r: R, row: Row, current: Row) => void;
    } = {},
  ) => {
    const table = ops[key] as TableOps;
    for (const r of rows) {
      const action = nodeAction.get(r.id);
      if (action === "conflict") continue;
      const row = data(r);
      if (action === "create") {
        const created = { ...row, id: to(r.id), workspaceId: ws };
        table.create.push(created);
        onCreate?.(r, created);
        count(key, label, "create");
        decisions.push([key, r.id, "create"]);
        continue;
      }
      const current = existing.get(r.id)!;
      const moved = fixed.filter((f) => !same(current[f], row[f]));
      if (moved.length) {
        conflict(
          "moved",
          "Moved since this backup",
          "These objects belong to another pen name, book or owner here than in the file. Move them back, or import as a copy (new ids).",
          `${kindLabel(r.id)}: ${titleOf(r.id)}`,
        );
        continue;
      }
      if (replace && differs(current, row)) {
        const update = withoutKeys(row, ["id", "createdAt", "updatedAt", ...fixed]);
        table.update.push({ id: r.id, data: update });
        onUpdate?.(r, update, current);
        count(key, label, "update");
        decisions.push([key, r.id, "update"]);
      } else {
        count(key, label, "skip");
        decisions.push([key, r.id, "skip"]);
      }
    }
  };

  const soft = (r: { createdAt: Date; updatedAt: Date; deletedAt: Date | null }) => ({
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    deletedAt: r.deletedAt,
  });

  nodes(
    "series",
    "Series",
    b.series,
    exSeries,
    (r) => ({
      penNameId: to(r.penNameId),
      title: r.title,
      description: r.description,
      ...soft(r),
    }),
    { fixed: ["penNameId"] },
  );

  nodes(
    "books",
    "Books",
    b.books,
    exBooks,
    (r) => ({
      penNameId: to(r.penNameId),
      seriesId: toRef(r.seriesId),
      seriesPosition: r.seriesId ? (r.seriesPosition ?? "1") : null,
      title: r.title,
      subtitle: r.subtitle,
      description: r.description,
      writingStatus: r.writingStatus,
      targetWordCount: r.targetWordCount,
      tropes: r.tropes,
      heatLevel: r.heatLevel,
      ...soft(r),
    }),
    { fixed: ["penNameId"] },
  );

  nodes(
    "parts",
    "Parts",
    b.parts,
    exParts,
    (r) => ({
      bookId: to(r.bookId),
      title: r.title,
      position: r.position,
      ...soft(r),
    }),
    { fixed: ["bookId"] },
  );

  nodes(
    "chapters",
    "Chapters",
    b.chapters,
    exChapters,
    (r) => ({
      bookId: to(r.bookId),
      partId: toRef(r.partId),
      title: r.title,
      position: r.position,
      ...soft(r),
    }),
    { fixed: ["bookId"] },
  );

  const versioned = (content: Doc | null) => {
    const text = docToText(content);
    return { content, text, wordCount: countWords(text) };
  };
  nodes(
    "scenes",
    "Scenes",
    b.scenes,
    exScenes,
    (r) => {
      const v = versioned(r.content);
      return {
        bookId: to(r.bookId),
        chapterId: to(r.chapterId),
        title: r.title,
        position: r.position,
        status: r.status,
        synopsis: r.synopsis,
        content: v.content,
        contentText: v.text,
        contentFormat: r.contentFormat,
        wordCount: v.wordCount,
        ...soft(r),
      };
    },
    {
      fixed: ["bookId"],
      onCreate: (r, row) => (row.version = r.version),
      onUpdate: (r, row, current) => {
        if (!same(current.content, row.content)) {
          ops.snapshots.push({ kind: "SCENE", id: r.id });
          row.version = (current.version as number) + 1;
        }
      },
    },
  );

  nodes(
    "characters",
    "Characters",
    b.characters,
    exCharacters,
    (r) => ({
      penNameId: to(r.penNameId),
      seriesId: toRef(r.seriesId),
      name: r.name,
      aliases: r.aliases,
      role: r.role,
      summary: r.summary,
      profile: r.profile,
      ...soft(r),
    }),
    { fixed: ["penNameId"] },
  );

  // Relationships: one per set of members, so a new one whose members
  // already have a relationship here is matched to it.
  const wsRelationshipKeys = new Map(
    (
      await client.relationship.findMany({
        where: { workspaceId: ws },
        select: { id: true, memberKey: true },
      })
    ).map((r) => [r.memberKey, r.id]),
  );
  const relationshipRows = b.relationships.filter((r) => {
    if (nodeAction.get(r.id) !== "create") return true;
    if (r.members.some((m) => nodeAction.get(m.characterId) === "conflict")) {
      nodeAction.set(r.id, "conflict");
      return false;
    }
    const match = wsRelationshipKeys.get(memberKey(r.members.map((m) => to(m.characterId))));
    if (!match) return true;
    map.set(r.id, match);
    count("relationships", "Relationships", "skip");
    decisions.push(["relationships", r.id, "match", match]);
    adjustments.push(
      `The relationship “${r.type}” already exists here between the same characters; the file’s links point to it.`,
    );
    return false;
  });
  nodes(
    "relationships",
    "Relationships",
    relationshipRows,
    new Map(
      [...exRelationships].map(([id, r]) => [
        id,
        {
          ...r,
          roles: Object.fromEntries(
            (r.members as { characterId: string; role: string | null }[]).map((m) => [
              m.characterId,
              m.role,
            ]),
          ),
        } as Row,
      ]),
    ),
    (r) => ({
      memberKey: memberKey(r.members.map((m) => to(m.characterId))),
      type: r.type,
      description: r.description,
      roles: Object.fromEntries(r.members.map((m) => [to(m.characterId), m.role])),
      ...soft(r),
    }),
    {
      fixed: ["memberKey"],
      onCreate: (r) => {
        for (const m of r.members)
          ops.relationshipMembers.push({
            workspaceId: ws,
            relationshipId: to(r.id),
            characterId: to(m.characterId),
            position: m.position,
            role: m.role,
          });
      },
      onUpdate: (r) => {
        for (const m of r.members)
          ops.memberRoles.push({
            relationshipId: r.id,
            characterId: to(m.characterId),
            role: m.role,
          });
      },
    },
  );
  for (const row of ops.relationships.create) delete row.roles;
  for (const u of ops.relationships.update) delete u.data.roles;

  nodes(
    "notes",
    "Notes",
    b.notes,
    exNotes,
    (r) => {
      const v = versioned(r.body);
      return {
        title: r.title,
        body: v.content,
        bodyText: v.text,
        bodyFormat: r.bodyFormat,
        ...soft(r),
      };
    },
    {
      onCreate: (r, row) => (row.version = r.version),
      onUpdate: (r, row, current) => {
        if (!same(current.body, row.body)) {
          ops.snapshots.push({ kind: "NOTE", id: r.id });
          row.version = (current.version as number) + 1;
        }
      },
    },
  );

  nodes("ideas", "Ideas", b.ideas, exIdeas, (r) => ({
    title: r.title,
    body: r.body,
    status: r.status,
    ...soft(r),
  }));
  nodes("tasks", "Tasks", b.tasks, exTasks, (r) => ({
    title: r.title,
    notes: r.notes,
    status: r.status,
    priority: r.priority,
    dueOn: r.dueOn,
    completedAt: r.completedAt,
    ...soft(r),
  }));
  // A deadline for an object that already has one here: one deadline per
  // object, so the file's date updates it (replace) or is skipped.
  const newDeadlines = b.calendarEvents.filter(
    (e) => e.purpose === "DEADLINE" && !e.deletedAt && nodeAction.get(e.id) === "create",
  );
  const currentDeadlines = new Map(
    (
      await client.calendarEvent.findMany({
        where: {
          workspaceId: ws,
          purpose: "DEADLINE",
          deletedAt: null,
          subjectId: { in: newDeadlines.map((e) => to(e.subjectId!)) },
        },
        select: { id: true, subjectId: true, startsOn: true },
      })
    ).map((e) => [e.subjectId!, e]),
  );
  const matchedDeadlines = new Set<string>();
  for (const e of newDeadlines) {
    const current = currentDeadlines.get(to(e.subjectId!));
    if (!current) continue;
    matchedDeadlines.add(e.id);
    map.set(e.id, current.id);
    const action = replace && !same(current.startsOn, e.startsOn) ? "update" : "skip";
    if (action === "update")
      ops.calendarEvents.update.push({ id: current.id, data: { startsOn: e.startsOn } });
    count("calendarEvents", "Events", action);
    decisions.push(["deadline", e.id, action, current.id]);
  }
  nodes(
    "calendarEvents",
    "Events",
    b.calendarEvents.filter((e) => !matchedDeadlines.has(e.id)),
    exEvents,
    (r) => ({
      title: r.title,
      description: r.description,
      startsOn: r.startsOn,
      endsOn: r.endsOn,
      startTime: r.startTime,
      purpose: r.purpose,
      subjectId: toRef(r.subjectId),
      ...soft(r),
    }),
    { fixed: ["purpose", "subjectId"] },
  );

  // ── Templates (the author's), then structures ───────────────────────────
  const builtIns = new Set(
    (
      await client.structureTemplate.findMany({
        where: { workspaceId: null, id: { in: b.builtInTemplates.map((t) => t.id) } },
        select: { id: true },
      })
    ).map((t) => t.id),
  );
  const missingBuiltIns = b.builtInTemplates.filter((t) => !builtIns.has(t.id));
  if (missingBuiltIns.length)
    adjustments.push(
      `Built-in templates not in this version of AuthorOS (${missingBuiltIns.map((t) => t.name).join(", ")}): structures made from them are imported without the template link.`,
    );
  const usedTemplates = await taken(
    "structure_templates",
    b.structureTemplates.map((t) => t.id),
  );
  const allBeats = b.structureTemplates.flatMap((t) => t.beats.map((beat) => ({ t, beat })));
  const usedTemplateBeats = await taken(
    "template_beats",
    allBeats.map((x) => x.beat.id),
  );
  const ownTemplate = new Set<string>();
  for (const t of b.structureTemplates) {
    const owner = usedTemplates.get(t.id);
    const data = {
      kind: t.kind,
      name: t.name,
      description: t.description,
      source: t.source,
      forSeries: t.forSeries,
    };
    if (keep && owner === ws) {
      ownTemplate.add(t.id);
      const current = await client.structureTemplate.findUniqueOrThrow({ where: { id: t.id } });
      const action = replace && differs(current, data) ? "update" : "skip";
      if (action === "update") ops.templates.update.push({ id: t.id, data });
      count("templates", "Templates", action);
      decisions.push(["template", t.id, action]);
    } else {
      map.set(t.id, freshId(t.id, usedTemplates));
      ops.templates.create.push({
        id: to(t.id),
        workspaceId: ws,
        ...data,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
      });
      count("templates", "Templates", "create");
      decisions.push(["template", t.id, "create"]);
    }
  }
  for (const { t, beat } of allBeats) {
    const data = {
      title: beat.title,
      description: beat.description,
      targetPercent: beat.targetPercent,
      position: beat.position,
      bookIndex: beat.bookIndex,
    };
    if (ownTemplate.has(t.id) && usedTemplateBeats.get(beat.id) === t.id) {
      if (replace) ops.templateBeats.update.push({ id: beat.id, data });
      continue;
    }
    map.set(beat.id, freshId(beat.id, usedTemplateBeats));
    ops.templateBeats.create.push({ id: to(beat.id), templateId: to(t.id), ...data });
  }
  const knownTemplate = (id: string | null) =>
    id && (builtIns.has(id) || b.structureTemplates.some((t) => t.id === id)) ? to(id) : null;
  const builtInBeats = new Set(
    (
      await client.templateBeat.findMany({
        where: { templateId: { in: [...builtIns] } },
        select: { id: true },
      })
    ).map((x) => x.id),
  );
  const templateBeatIds = new Set(allBeats.map((x) => x.beat.id));
  const knownTemplateBeat = (id: string | null) =>
    id && (builtInBeats.has(id) || templateBeatIds.has(id)) ? to(id) : null;

  nodes(
    "outlines",
    "Structures",
    b.outlines.filter((o) => {
      const owners = [o.bookId, o.seriesId, o.relationshipId, o.characterId].filter(Boolean);
      if (owners.some((id) => nodeAction.get(id!) === "conflict")) {
        nodeAction.set(o.id, "conflict");
        return false;
      }
      return true;
    }),
    exOutlines,
    (r) => ({
      bookId: toRef(r.bookId),
      seriesId: toRef(r.seriesId),
      kind: r.kind,
      title: r.title,
      templateId: knownTemplate(r.templateId),
      relationshipId: toRef(r.relationshipId),
      characterId: toRef(r.characterId),
      arcRole: r.arcRole,
      ...soft(r),
    }),
    { fixed: ["bookId", "seriesId", "relationshipId", "characterId", "kind"] },
  );

  const usedBeats = await taken(
    "outline_beats",
    b.outlineBeats.map((x) => x.id),
  );
  const ownBeats = new Map(
    (
      await chunked(
        b.outlineBeats.filter((x) => keep && usedBeats.get(x.id) === ws).map((x) => x.id),
        (ids) => client.outlineBeat.findMany({ where: { workspaceId: ws, id: { in: ids } } }),
      )
    ).map((x) => [x.id, x]),
  );
  for (const beat of b.outlineBeats) {
    if (nodeAction.get(beat.outlineId) === "conflict") continue;
    const data = {
      outlineId: to(beat.outlineId),
      templateBeatId: knownTemplateBeat(beat.templateBeatId),
      title: beat.title,
      description: beat.description,
      targetPercent: beat.targetPercent,
      position: beat.position,
      bookId: toRef(beat.bookId),
    };
    const current = ownBeats.get(beat.id);
    if (current) {
      if (current.outlineId === data.outlineId) {
        const action = replace && differs(current, data) ? "update" : "skip";
        if (action === "update")
          ops.outlineBeats.update.push({ id: beat.id, data: withoutKeys(data, ["outlineId"]) });
        count("outlineBeats", "Beats", action);
        decisions.push(["beat", beat.id, action]);
        continue;
      }
    }
    map.set(beat.id, freshId(beat.id, usedBeats));
    ops.outlineBeats.create.push({
      id: to(beat.id),
      workspaceId: ws,
      ...data,
      createdAt: beat.createdAt,
      updatedAt: beat.updatedAt,
    });
    count("outlineBeats", "Beats", "create");
    decisions.push(["beat", beat.id, "create"]);
  }

  const ok = (id: string) => nodeAction.get(id) !== "conflict";
  const beatOutline = new Map(b.outlineBeats.map((x) => [x.id, x.outlineId]));
  const assignments = b.beatScenes.filter((a) => ok(beatOutline.get(a.beatId)!) && ok(a.sceneId));
  const existingAssignments = new Set(
    (
      await chunked(
        assignments.map((a) => to(a.beatId)),
        (ids) =>
          client.beatScene.findMany({
            where: { workspaceId: ws, beatId: { in: ids } },
            select: { beatId: true, sceneId: true },
          }),
      )
    ).map((a) => `${a.beatId}|${a.sceneId}`),
  );
  for (const a of assignments) {
    const beatId = to(a.beatId);
    const sceneId = to(a.sceneId);
    if (existingAssignments.has(`${beatId}|${sceneId}`)) {
      count("beatScenes", "Beat assignments", "skip");
      continue;
    }
    ops.beatScenes.push({ workspaceId: ws, beatId, sceneId, createdAt: a.createdAt });
    count("beatScenes", "Beat assignments", "create");
    decisions.push(["assignment", a.beatId, a.sceneId]);
  }

  // ── Connections ──────────────────────────────────────────────────────────
  const conns = b.connections.filter((c) => ok(c.sourceId) && ok(c.targetId));
  const endpoints = [...new Set(conns.flatMap((c) => [to(c.sourceId), to(c.targetId)]))];
  const wsConnections = await chunked(endpoints, (ids) =>
    client.connection.findMany({
      where: { workspaceId: ws, OR: [{ sourceId: { in: ids } }, { targetId: { in: ids } }] },
    }),
  );
  const connByKey = new Map<string, (typeof wsConnections)[number]>();
  for (const c of wsConnections) connByKey.set(connectionKey(c.kind, c.sourceId, c.targetId), c);
  const usedConnections = await taken(
    "connections",
    conns.map((c) => c.id),
  );
  for (const c of conns) {
    let sourceId = to(c.sourceId);
    let targetId = to(c.targetId);
    // Undirected links are stored once per pair, in id order (new ids may reorder).
    if (isConnectionKind(c.kind) && !getKind(c.kind).directed && targetId < sourceId)
      [sourceId, targetId] = [targetId, sourceId];
    const attributes = { ...c.attributes };
    const current = connByKey.get(connectionKey(c.kind, sourceId, targetId));
    const id = current?.id ?? freshId(c.id, usedConnections);
    const data = { label: c.label, note: c.note, attributes };
    if (current) {
      const action = replace && differs(current, data) ? "update" : "skip";
      if (action === "update") ops.connections.update.push({ id, data });
      count("connections", "Connections", action);
      decisions.push(["connection", c.id, action]);
      continue;
    }
    ops.connections.create.push({
      id,
      workspaceId: ws,
      sourceId,
      targetId,
      kind: c.kind,
      ...data,
      createdById: ctx.userId,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    });
    count("connections", "Connections", "create");
    decisions.push(["connection", c.id, "create"]);
  }

  // ── Scene Participation ──────────────────────────────────────────────────
  // A scene keeps the point of view it already has here: the file's
  // point-of-view character is added without it, and the review says so.
  const appearances = b.sceneParticipations.filter((p) => ok(p.sceneId) && ok(p.characterId));
  const wsAppearances = await chunked([...new Set(appearances.map((p) => to(p.sceneId)))], (ids) =>
    client.sceneParticipation.findMany({
      where: { workspaceId: ws, sceneId: { in: ids } },
      select: { sceneId: true, characterId: true, presence: true, isPov: true },
    }),
  );
  const appearanceByKey = new Map(wsAppearances.map((a) => [`${a.sceneId}|${a.characterId}`, a]));
  const povOwner = new Map(
    wsAppearances.filter((a) => a.isPov).map((a) => [a.sceneId, a.characterId]),
  );
  let demoted = 0;
  for (const p of appearances) {
    const sceneId = to(p.sceneId);
    const characterId = to(p.characterId);
    let isPov = p.isPov;
    if (isPov) {
      const owner = povOwner.get(sceneId);
      if (owner && owner !== characterId) {
        isPov = false;
        demoted++;
      } else povOwner.set(sceneId, characterId);
    }
    const data = { presence: p.presence, isPov };
    const current = appearanceByKey.get(`${sceneId}|${characterId}`);
    if (current) {
      // An existing point of view is never taken away by an import either.
      const next = { ...data, isPov: data.isPov || current.isPov };
      const action = replace && differs(current, next) ? "update" : "skip";
      if (action === "update")
        ops.sceneParticipations.update.push({ id: `${sceneId}|${characterId}`, data: next });
      count("sceneParticipations", "Characters in scenes", action);
      decisions.push(["appearance", p.sceneId, p.characterId, action]);
      continue;
    }
    ops.sceneParticipations.create.push({
      workspaceId: ws,
      sceneId,
      characterId,
      ...data,
      createdById: ctx.userId,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    });
    count("sceneParticipations", "Characters in scenes", "create");
    decisions.push(["appearance", p.sceneId, p.characterId, "create"]);
  }
  if (demoted)
    adjustments.push(
      `${demoted === 1 ? "A scene" : `${demoted} scenes`} already ha${demoted === 1 ? "s" : "ve"} a point-of-view character here; the file’s point-of-view character is added without it.`,
    );

  // ── Template kits ────────────────────────────────────────────────────────
  const usedKits = await taken(
    "template_kits",
    b.templateKits.map((k) => k.id),
  );
  for (const k of b.templateKits) {
    const items = k.items.filter((i) => knownTemplate(i.templateId));
    if (items.length < k.items.length)
      adjustments.push(
        `The kit “${k.name}” loses templates that aren’t in this version of AuthorOS.`,
      );
    const data = { name: k.name, description: k.description };
    const itemRows = (kitId: string) =>
      items.map((i) => ({
        id: uuidv7(),
        kitId,
        itemType: i.itemType,
        templateId: knownTemplate(i.templateId)!,
        position: i.position,
      }));
    if (keep && usedKits.get(k.id) === ws) {
      const current = await client.templateKit.findUniqueOrThrow({
        where: { id: k.id },
        include: { items: { orderBy: { position: "asc" } } },
      });
      const itemsDiffer = !same(
        current.items.map((i) => [i.templateId, i.position]),
        itemRows(k.id).map((i) => [i.templateId, i.position]),
      );
      const action = replace && (differs(current, data) || itemsDiffer) ? "update" : "skip";
      if (action === "update") {
        ops.kits.update.push({ id: k.id, data });
        ops.kitItemsReplaced.push(k.id);
        ops.kitItems.push(...itemRows(k.id));
      }
      count("kits", "Template kits", action);
      decisions.push(["kit", k.id, action]);
      continue;
    }
    map.set(k.id, freshId(k.id, usedKits));
    ops.kits.create.push({
      id: to(k.id),
      workspaceId: ws,
      ...data,
      createdAt: k.createdAt,
      updatedAt: k.updatedAt,
    });
    ops.kitItems.push(...itemRows(to(k.id)));
    count("kits", "Template kits", "create");
    decisions.push(["kit", k.id, "create"]);
  }

  // ── Custom fields and values ─────────────────────────────────────────────
  const wsFields = await client.fieldDefinition.findMany({ where: { workspaceId: ws } });
  const fieldKey = (f: {
    nodeKind: string;
    penNameId: string | null;
    seriesId: string | null;
    bookId: string | null;
    label: string;
  }) =>
    [
      f.nodeKind,
      f.penNameId ?? ZERO,
      f.seriesId ?? ZERO,
      f.bookId ?? ZERO,
      f.label.toLowerCase(),
    ].join("|");
  const fieldByKey = new Map(wsFields.map((f) => [fieldKey(f), f]));
  const fieldById = new Map(wsFields.map((f) => [f.id, f]));
  const usedFields = await taken(
    "field_definitions",
    b.fieldDefinitions.map((f) => f.id),
  );
  const fieldOk = new Set<string>();
  for (const f of b.fieldDefinitions) {
    if ([f.seriesId, f.bookId].some((id) => id && !ok(id))) continue;
    fieldOk.add(f.id);
    const scoped = {
      nodeKind: f.nodeKind,
      penNameId: toRef(f.penNameId),
      seriesId: toRef(f.seriesId),
      bookId: toRef(f.bookId),
      label: f.label,
    };
    const own = keep ? fieldById.get(f.id) : undefined;
    const match = own ?? fieldByKey.get(fieldKey(scoped));
    if (match) {
      map.set(f.id, match.id);
      const data = { label: f.label, type: f.type, position: f.position };
      // Only a field matched by id and in the same scope is updated.
      const sameScope = same(
        [match.nodeKind, match.penNameId, match.seriesId, match.bookId],
        [scoped.nodeKind, scoped.penNameId, scoped.seriesId, scoped.bookId],
      );
      const action = replace && own && sameScope && differs(match, data) ? "update" : "skip";
      if (action === "update") ops.fieldDefinitions.update.push({ id: match.id, data });
      count("fieldDefinitions", "Custom fields", action);
      decisions.push(["field", f.id, action, match.id]);
      continue;
    }
    map.set(f.id, freshId(f.id, usedFields));
    ops.fieldDefinitions.create.push({
      id: to(f.id),
      workspaceId: ws,
      ...scoped,
      type: f.type,
      position: f.position,
      createdAt: f.createdAt,
    });
    count("fieldDefinitions", "Custom fields", "create");
    decisions.push(["field", f.id, "create"]);
  }
  const values = b.fieldValues.filter((v) => fieldOk.has(v.fieldId) && ok(v.nodeId));
  const existingValues = new Map(
    (
      await chunked([...new Set(values.map((v) => to(v.nodeId)))], (ids) =>
        client.nodeFieldValue.findMany({ where: { workspaceId: ws, nodeId: { in: ids } } }),
      )
    ).map((v) => [`${v.nodeId}|${v.fieldId}`, v]),
  );
  for (const v of values) {
    const nodeId = to(v.nodeId);
    const fieldId = to(v.fieldId);
    const current = existingValues.get(`${nodeId}|${fieldId}`);
    if (current) {
      const action = replace && current.value !== v.value ? "update" : "skip";
      if (action === "update")
        ops.fieldValues.update.push({ id: `${nodeId}|${fieldId}`, data: { value: v.value } });
      count("fieldValues", "Field values", action);
      decisions.push(["value", v.nodeId, v.fieldId, action]);
      continue;
    }
    ops.fieldValues.create.push({
      workspaceId: ws,
      nodeId,
      fieldId,
      value: v.value,
      updatedAt: v.updatedAt,
    });
    count("fieldValues", "Field values", "create");
    decisions.push(["value", v.nodeId, v.fieldId, "create"]);
  }

  // ── Writing sessions ─────────────────────────────────────────────────────
  const sessions = b.writingSessions.filter((s) => !s.bookId || ok(s.bookId));
  const usedSessions = await taken(
    "writing_sessions",
    sessions.map((s) => s.id),
  );
  const editorDays = new Set(
    (
      await client.writingSession.findMany({
        where: { workspaceId: ws, userId: ctx.userId, source: "EDITOR", bookId: { not: null } },
        select: { bookId: true, date: true },
      })
    ).map((s) => `${s.bookId}|${s.date.toISOString()}`),
  );
  for (const s of sessions) {
    const bookId = toRef(s.bookId);
    if (keep && usedSessions.get(s.id) === ws) {
      count("writingSessions", "Writing sessions", "skip");
      continue;
    }
    if (s.source === "EDITOR" && bookId) {
      const day = `${bookId}|${s.date.toISOString()}`;
      if (editorDays.has(day)) {
        count("writingSessions", "Writing sessions", "skip");
        continue;
      }
      editorDays.add(day);
    }
    ops.writingSessions.create.push({
      id: freshId(s.id, usedSessions),
      workspaceId: ws,
      userId: ctx.userId,
      bookId,
      date: s.date,
      source: s.source,
      wordsAdded: s.wordsAdded,
      wordsRemoved: s.wordsRemoved,
      minutes: s.minutes,
      note: s.note,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    });
    count("writingSessions", "Writing sessions", "create");
    decisions.push(["session", s.id, "create"]);
  }
  if (sessions.length) adjustments.push("Writing sessions are recorded as yours.");

  // ── Version history (Complete archive) ──────────────────────────────────
  const revisions = b.contentRevisions.filter((r) => ok(r.nodeId));
  const usedRevisions = await taken(
    "content_revisions",
    revisions.map((r) => r.id),
  );
  for (const r of revisions) {
    if (usedRevisions.get(r.id) === ws) {
      count("revisions", "Saved versions", "skip");
      continue;
    }
    const text = docToText(r.content);
    ops.revisions.push({
      id: freshId(r.id, usedRevisions),
      workspaceId: ws,
      nodeId: to(r.nodeId),
      content: r.content,
      contentText: text,
      wordCount: countWords(text),
      contentFormat: r.contentFormat,
      source: r.source,
      label: r.label,
      createdById: ctx.userId,
      createdAt: r.createdAt,
    });
    count("revisions", "Saved versions", "create");
    decisions.push(["revision", r.id, "create"]);
  }

  // Earlier values of text fields (Complete archive).
  const fieldRevisions = b.fieldRevisions.filter((r) => ok(r.nodeId));
  const usedFieldRevisions = await taken(
    "field_revisions",
    fieldRevisions.map((r) => r.id),
  );
  for (const r of fieldRevisions) {
    if (usedFieldRevisions.get(r.id) === ws) {
      count("fieldRevisions", "Earlier field values", "skip");
      continue;
    }
    ops.fieldRevisions.push({
      id: freshId(r.id, usedFieldRevisions),
      workspaceId: ws,
      nodeId: to(r.nodeId),
      field: remapField(r.field, to),
      value: r.value,
      source: r.source,
      createdById: ctx.userId,
      createdAt: r.createdAt,
    });
    count("fieldRevisions", "Earlier field values", "create");
    decisions.push(["fieldRevision", r.id, "create"]);
  }

  // ── Settings ─────────────────────────────────────────────────────────────
  if (b.settings.dailyWordGoal) {
    const member = await client.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId: ws, userId: ctx.userId } },
      select: { dailyWordGoal: true },
    });
    if (member && member.dailyWordGoal === null) ops.dailyWordGoal = b.settings.dailyWordGoal;
  }

  // Story nodes for every typed row created.
  const created = (rows: Row[], kind: StoryNodeKind) =>
    rows.map((r) => ({ id: r.id as string, kind }));
  ops.nodes = [
    ...created(ops.penNames.create, "PEN_NAME"),
    ...created(ops.series.create, "SERIES"),
    ...created(ops.books.create, "BOOK"),
    ...created(ops.parts.create, "PART"),
    ...created(ops.chapters.create, "CHAPTER"),
    ...created(ops.scenes.create, "SCENE"),
    ...created(ops.characters.create, "CHARACTER"),
    ...created(ops.relationships.create, "RELATIONSHIP"),
    ...created(ops.notes.create, "NOTE"),
    ...created(ops.ideas.create, "IDEA"),
    ...created(ops.tasks.create, "TASK"),
    ...created(ops.calendarEvents.create, "EVENT"),
    ...created(ops.outlines.create, "OUTLINE"),
  ];

  const order = COUNT_ORDER;
  const sorted = [...counts.values()].sort((x, y) => order.indexOf(x.key) - order.indexOf(y.key));
  const conflictList = [...conflicts.values()];
  const fingerprint = createHash("sha256")
    .update(JSON.stringify({ options, decisions, conflicts: conflictList }))
    .digest("hex")
    .slice(0, 32);
  return { counts: sorted, conflicts: conflictList, adjustments, ops, fingerprint };
}

const COUNT_ORDER = [
  "penNames",
  "series",
  "books",
  "parts",
  "chapters",
  "scenes",
  "characters",
  "relationships",
  "notes",
  "ideas",
  "tasks",
  "calendarEvents",
  "outlines",
  "outlineBeats",
  "beatScenes",
  "sceneParticipations",
  "connections",
  "templates",
  "kits",
  "fieldDefinitions",
  "fieldValues",
  "writingSessions",
  "revisions",
  "fieldRevisions",
];

/** Taken ids, globally, with the workspace each belongs to. */
const TAKEN_SQL: Record<string, string> = {
  pen_names: `SELECT "id", "workspace_id" AS ws FROM "pen_names" WHERE "id" = ANY($1::uuid[])`,
  structure_templates: `SELECT "id", "workspace_id" AS ws FROM "structure_templates" WHERE "id" = ANY($1::uuid[])`,
  // For template beats, the template they belong to.
  template_beats: `SELECT "id", "template_id" AS ws FROM "template_beats" WHERE "id" = ANY($1::uuid[])`,
  outline_beats: `SELECT "id", "workspace_id" AS ws FROM "outline_beats" WHERE "id" = ANY($1::uuid[])`,
  connections: `SELECT "id", "workspace_id" AS ws FROM "connections" WHERE "id" = ANY($1::uuid[])`,
  template_kits: `SELECT "id", "workspace_id" AS ws FROM "template_kits" WHERE "id" = ANY($1::uuid[])`,
  field_definitions: `SELECT "id", "workspace_id" AS ws FROM "field_definitions" WHERE "id" = ANY($1::uuid[])`,
  writing_sessions: `SELECT "id", "workspace_id" AS ws FROM "writing_sessions" WHERE "id" = ANY($1::uuid[])`,
  field_revisions: `SELECT "id", "workspace_id" AS ws FROM "field_revisions" WHERE "id" = ANY($1::uuid[])`,
  content_revisions: `SELECT "id", "workspace_id" AS ws FROM "content_revisions" WHERE "id" = ANY($1::uuid[])`,
};

function emptyOps(): ImportOps {
  const t = (): TableOps => ({ create: [], update: [] });
  return {
    penNames: t(),
    nodes: [],
    series: t(),
    books: t(),
    parts: t(),
    chapters: t(),
    scenes: t(),
    characters: t(),
    relationships: t(),
    relationshipMembers: [],
    memberRoles: [],
    notes: t(),
    ideas: t(),
    tasks: t(),
    calendarEvents: t(),
    templates: t(),
    templateBeats: t(),
    outlines: t(),
    outlineBeats: t(),
    beatScenes: [],
    sceneParticipations: t(),
    connections: t(),
    kits: t(),
    kitItems: [],
    kitItemsReplaced: [],
    fieldDefinitions: t(),
    fieldValues: t(),
    writingSessions: t(),
    revisions: [],
    fieldRevisions: [],
    snapshots: [],
    dailyWordGoal: null,
  };
}

export const memberKey = (characterIds: string[]) => [...characterIds].sort().join(",");

const nameKey = (name: string) => name.trim().toLowerCase();

function connectionKey(kind: string, sourceId: string, targetId: string) {
  const directed = isConnectionKind(kind) ? getKind(kind).directed : true;
  return directed
    ? `${kind}|${sourceId}|${targetId}`
    : `${kind}|${[sourceId, targetId].sort().join("|")}`;
}

async function chunked<T>(ids: string[], load: (ids: string[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += 5000) out.push(...(await load(ids.slice(i, i + 5000))));
  return out;
}

async function byId<T extends { id: string }>(rows: Promise<T[]>): Promise<Map<string, Row>> {
  return new Map((await rows).map((r) => [r.id, r as unknown as Row]));
}

function withoutKeys(row: Row, keys: string[]): Row {
  return Object.fromEntries(Object.entries(row).filter(([k]) => !keys.includes(k)));
}

/** Whether any of `data`'s columns (timestamps aside) differ from `current`. */
function differs(current: object, data: Row): boolean {
  const row = current as Row;
  return Object.keys(data).some((k) => !TIMESTAMPS.has(k) && k !== "id" && !same(row[k], data[k]));
}

/** Deep equality for column values: dates by instant, JSON regardless of key order. */
export function same(a: unknown, b: unknown): boolean {
  return stable(a) === stable(b);
}

function stable(v: unknown): string {
  if (v === undefined || v === null) return "null";
  if (v instanceof Date) return JSON.stringify(v.toISOString());
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (typeof v === "object")
    return `{${Object.keys(v as object)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable((v as Row)[k])}`)
      .join(",")}}`;
  return JSON.stringify(v);
}

/** A readable name for each story object of the bundle, for the review. */
function nodeTitles(b: WorkspaceBundle) {
  const titles = new Map<string, string>();
  for (const rows of [
    b.series,
    b.books,
    b.parts,
    b.chapters,
    b.scenes,
    b.notes,
    b.ideas,
    b.tasks,
    b.calendarEvents,
    b.outlines,
  ])
    for (const r of rows) titles.set(r.id, r.title);
  for (const p of b.penNames) titles.set(p.id, p.name);
  for (const c of b.characters) titles.set(c.id, c.name);
  const names = new Map(b.characters.map((c) => [c.id, c.name]));
  for (const r of b.relationships)
    titles.set(r.id, `${r.type}: ${r.members.map((m) => names.get(m.characterId)).join(", ")}`);
  return (id: string) => titles.get(id) ?? id;
}

/** Field names that embed an id ("beat:<id>.description") follow the id map. */
function remapField(field: string, to: (id: string) => string) {
  return field.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, (id) =>
    to(id.toLowerCase()),
  );
}
