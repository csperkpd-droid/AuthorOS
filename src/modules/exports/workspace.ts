import "server-only";

import { db } from "@/lib/db";
import { STORY_KINDS, storyObjectType } from "@/modules/story-graph";
import type { AuthorContext } from "@/server/context";
import { assertCan } from "@/server/policy";

import { resolveScope } from "./scope";
import type { ExportScopeInput } from "./schemas";

/**
 * The structured project export: everything needed to rebuild the Story
 * Graph, with original ids. Format "authoros.workspace", version 1:
 *
 * - every story object, keyed by its story-node id (`storyNodes` lists each
 *   id with its kind), including items in the Trash (`deletedAt` set);
 * - the structural hierarchy (series → books → parts → chapters → scenes,
 *   positions included), scene and note content (ProseMirror JSON);
 * - characters, the scenes they are in (Scene Participation), relationships
 *   with their members, connections (with kind,
 *   label, note and attributes), structures, beats and beat → scene
 *   assignments, templates and kits, custom fields and values, tasks,
 *   events, writing sessions; version history when asked for;
 * - pen names, and each object's pen name / series where it has one.
 *
 * Scoped exports (some pen names) contain those identities' objects, the
 * shared objects (notes, ideas, tasks, events) not linked only to other
 * identities, and only links whose two ends are both included, so nothing
 * of another identity leaks and every reference resolves. Read-only.
 */

export const EXPORT_FORMAT = "authoros.workspace";
/**
 * Version 2 (M7): pen names are story nodes (listed in `storyNodes`), and
 * dates that belong to an object are calendar events (`purpose`,
 * `subjectId`) instead of columns (books no longer have `dueOn`).
 * Version 3 (M8): books have a `writingStatus` (publication is not a
 * writing status); documents carry their format version; the Complete
 * archive includes earlier values of text fields (`fieldRevisions`).
 * Version 4 (M11): characters in scenes are Scene Participation
 * (`sceneParticipations`: presence and point of view), no longer
 * `appears_in` connections.
 * Version 5 (M12): Story Time (`timelineEvents`, `sceneStoryTimes`).
 * Version 6 (M13): tropes are objects (`tropes`) linked by `uses_trope`
 * connections; books no longer have `tropes`.
 * The importer upgrades older files.
 */
export const EXPORT_VERSION = 6;

/**
 * "standard": the backup (all story data, no version history).
 * "archive": the complete archive, with every saved version of scenes and notes.
 */
export type ExportKind = "standard" | "archive";

export async function exportWorkspaceJson(
  ctx: AuthorContext,
  { scope, kind = "standard" }: { scope: ExportScopeInput; kind?: ExportKind },
) {
  assertCan(ctx, "manage", "workspace");
  const resolved = await resolveScope(ctx, scope);
  const ws = ctx.workspaceId;
  const pens = resolved.penNameIds;
  const penFilter = pens ? { penNameId: { in: pens } } : {};

  const [workspace, penNames, series, books] = await Promise.all([
    db.workspace.findUniqueOrThrow({ where: { id: ws }, select: { id: true, name: true } }),
    db.penName.findMany({ where: { workspaceId: ws, ...(pens ? { id: { in: pens } } : {}) } }),
    db.series.findMany({ where: { workspaceId: ws, ...penFilter } }),
    db.book.findMany({ where: { workspaceId: ws, ...penFilter } }),
  ]);
  const bookIds = books.map((b) => b.id);
  const seriesIds = series.map((s) => s.id);
  const [parts, chapters, scenes, characters] = await Promise.all([
    db.part.findMany({ where: { bookId: { in: bookIds } } }),
    db.chapter.findMany({ where: { bookId: { in: bookIds } } }),
    db.scene.findMany({ where: { bookId: { in: bookIds } } }),
    db.character.findMany({ where: { workspaceId: ws, ...penFilter } }),
  ]);
  const characterIds = new Set(characters.map((c) => c.id));
  const relationshipRows = await db.relationship.findMany({
    where: { workspaceId: ws },
    include: { members: { orderBy: { position: "asc" } } },
  });
  // A relationship is included when all its members are.
  const relationships = relationshipRows.filter((r) =>
    r.members.every((m) => characterIds.has(m.characterId)),
  );
  const relationshipIds = relationships.map((r) => r.id);
  const outlines = await db.outline.findMany({
    where: { workspaceId: ws, OR: [{ bookId: { in: bookIds } }, { seriesId: { in: seriesIds } }] },
  });
  const outlineIds = outlines.map((o) => o.id);
  const timelineEvents = await db.timelineEvent.findMany({
    where: { workspaceId: ws, OR: [{ bookId: { in: bookIds } }, { seriesId: { in: seriesIds } }] },
  });
  const [outlineBeats, notes, ideas, tasks, events, tropes] = await Promise.all([
    db.outlineBeat.findMany({ where: { outlineId: { in: outlineIds } } }),
    db.note.findMany({ where: { workspaceId: ws } }),
    db.idea.findMany({ where: { workspaceId: ws } }),
    db.task.findMany({ where: { workspaceId: ws } }),
    db.calendarEvent.findMany({ where: { workspaceId: ws } }),
    db.trope.findMany({ where: { workspaceId: ws } }),
  ]);

  // Identity objects in scope, then shared objects unless linked only elsewhere.
  const identityIds = new Set<string>([
    ...penNames.map((p) => p.id),
    ...seriesIds,
    ...bookIds,
    ...parts.map((p) => p.id),
    ...chapters.map((c) => c.id),
    ...scenes.map((s) => s.id),
    ...characterIds,
    ...relationshipIds,
    ...outlineIds,
    ...timelineEvents.map((e) => e.id),
  ]);
  // A date that belongs to an object (a deadline) goes where its object goes.
  const ownEvents = events.filter((e) => !e.subjectId);
  const sharedIds = [...notes, ...ideas, ...tasks, ...ownEvents, ...tropes].map((x) => x.id);
  const allConnections = await db.connection.findMany({ where: { workspaceId: ws } });
  let included = new Set<string>([...identityIds, ...sharedIds]);
  const datesOf = (set: Set<string>) =>
    events.filter((e) => e.subjectId && set.has(e.subjectId)).map((e) => e.id);
  included = new Set([...included, ...datesOf(included)]);
  if (pens) {
    const shared = new Set(sharedIds);
    const keep = new Set<string>();
    const linkedOutside = new Set<string>();
    for (const c of allConnections) {
      for (const [self, other] of [
        [c.sourceId, c.targetId],
        [c.targetId, c.sourceId],
      ]) {
        if (!shared.has(self)) continue;
        if (identityIds.has(other)) keep.add(self);
        else if (!shared.has(other)) linkedOutside.add(self);
      }
    }
    const sharedIncluded = sharedIds.filter((id) => keep.has(id) || !linkedOutside.has(id));
    included = new Set([...identityIds, ...sharedIncluded]);
    included = new Set([...included, ...datesOf(included)]);
  }
  const has = (id: string) => included.has(id);
  const connections = allConnections.filter((c) => has(c.sourceId) && has(c.targetId));
  const sceneIds = new Set(scenes.map((s) => s.id));

  const [
    beatScenes,
    sceneStoryTimes,
    participations,
    templates,
    kits,
    fieldDefinitions,
    storyNodes,
    writingSessions,
    member,
  ] = await Promise.all([
    db.beatScene.findMany({ where: { beat: { outlineId: { in: outlineIds } } } }),
    db.sceneStoryTime.findMany({
      where: { workspaceId: ws, sceneId: { in: [...sceneIds] } },
      select: { sceneId: true, position: true, label: true, createdAt: true, updatedAt: true },
    }),
    db.sceneParticipation.findMany({
      where: { workspaceId: ws, sceneId: { in: [...sceneIds] } },
      select: {
        sceneId: true,
        characterId: true,
        presence: true,
        isPov: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    db.structureTemplate.findMany({
      where: { OR: [{ workspaceId: ws }, { workspaceId: null }] },
      include: { beats: true },
    }),
    db.templateKit.findMany({ where: { workspaceId: ws }, include: { items: true } }),
    db.fieldDefinition.findMany({ where: { workspaceId: ws } }),
    db.storyNode.findMany({
      where: { workspaceId: ws, id: { in: [...included] } },
      select: { id: true, kind: true },
    }),
    db.writingSession.findMany({
      where: { workspaceId: ws, ...(pens ? { bookId: { in: bookIds } } : {}) },
    }),
    db.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId: ws, userId: ctx.userId } },
      select: { dailyWordGoal: true },
    }),
  ]);
  const fieldsInScope = fieldDefinitions.filter(
    (f) =>
      !pens ||
      (f.penNameId
        ? pens.includes(f.penNameId)
        : f.seriesId
          ? seriesIds.includes(f.seriesId)
          : f.bookId
            ? bookIds.includes(f.bookId)
            : true),
  );
  const fieldIds = fieldsInScope.map((f) => f.id);
  const [fieldValues, revisions, fieldRevisions] = await Promise.all([
    db.nodeFieldValue.findMany({
      where: { fieldId: { in: fieldIds }, nodeId: { in: [...included] } },
    }),
    kind === "archive"
      ? db.contentRevision.findMany({ where: { workspaceId: ws, nodeId: { in: [...included] } } })
      : Promise.resolve(null),
    kind === "archive"
      ? db.fieldRevision.findMany({ where: { workspaceId: ws, nodeId: { in: [...included] } } })
      : Promise.resolve(null),
  ]);

  const data = {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    app: "AuthorOS",
    kind,
    scope: { kind: pens ? "pen-names" : "workspace", label: resolved.label, penNameIds: pens },
    workspace,
    settings: { dailyWordGoal: member?.dailyWordGoal ?? null },
    penNames,
    storyNodes,
    series,
    books,
    parts,
    chapters,
    scenes,
    characters,
    relationships: relationships.map(({ members, ...r }) => ({
      ...r,
      members: members.map((m) => ({
        characterId: m.characterId,
        position: m.position,
        role: m.role,
      })),
    })),
    notes: notes.filter((n) => has(n.id)),
    ideas: ideas.filter((i) => has(i.id)),
    tasks: tasks.filter((t) => has(t.id)),
    calendarEvents: events.filter((e) => has(e.id)),
    tropes: tropes.filter((t) => has(t.id)),
    connections,
    outlines,
    outlineBeats,
    beatScenes: beatScenes.filter((b) => sceneIds.has(b.sceneId)),
    sceneParticipations: participations.filter((p) => characterIds.has(p.characterId)),
    timelineEvents,
    sceneStoryTimes,
    // The author's templates in full; built-in ones (seeded with fixed ids in
    // every installation) by reference only.
    structureTemplates: templates.filter((t) => t.workspaceId !== null),
    builtInTemplates: templates
      .filter((t) => t.workspaceId === null)
      .map((t) => ({ id: t.id, kind: t.kind, name: t.name })),
    templateKits: kits,
    fieldDefinitions: fieldsInScope,
    fieldValues,
    writingSessions,
    ...(revisions ? { contentRevisions: revisions } : {}),
    ...(fieldRevisions ? { fieldRevisions } : {}),
  };
  const date = data.exportedAt.slice(0, 10);
  return {
    filename: `authoros-${resolved.slug}-${kind === "archive" ? "archive-" : ""}${date}.json`,
    data,
  };
}

export type WorkspaceExport = Awaited<ReturnType<typeof exportWorkspaceJson>>["data"];

type Id = { id: string };
type Ref = string | null;

/** The parts of an export (or an import bundle) the integrity check reads. */
export type IntegrityInput = {
  storyNodes: { id: string; kind: string }[];
  penNames: Id[];
  series: (Id & { penNameId: string })[];
  books: (Id & { penNameId: string; seriesId: Ref })[];
  parts: (Id & { bookId: string })[];
  chapters: (Id & { bookId: string; partId: Ref })[];
  scenes: (Id & { bookId: string; chapterId: string })[];
  characters: (Id & { penNameId: string; seriesId: Ref })[];
  relationships: (Id & { members: { characterId: string }[] })[];
  notes: Id[];
  ideas: Id[];
  tasks: Id[];
  calendarEvents: (Id & { subjectId?: Ref })[];
  tropes: Id[];
  connections: { sourceId: string; targetId: string }[];
  outlines: (Id & {
    bookId: Ref;
    seriesId: Ref;
    relationshipId: Ref;
    characterId: Ref;
    templateId: Ref;
  })[];
  outlineBeats: (Id & { outlineId: string; bookId: Ref })[];
  beatScenes: { beatId: string; sceneId: string }[];
  sceneParticipations: { sceneId: string; characterId: string }[];
  timelineEvents: (Id & { bookId: Ref; seriesId: Ref })[];
  sceneStoryTimes: { sceneId: string }[];
  structureTemplates: Id[];
  builtInTemplates: Id[];
  templateKits: { items: { templateId: string }[] }[];
  fieldDefinitions: (Id & { penNameId: Ref; seriesId: Ref; bookId: Ref })[];
  fieldValues: { fieldId: string; nodeId: string }[];
  writingSessions?: { bookId: Ref }[];
  contentRevisions?: { nodeId: string }[];
  fieldRevisions?: { nodeId: string }[];
};

/**
 * Checks that an export is self-contained: every reference points at an
 * object in the export. The import validates every file with this first.
 * Returns the problems found (empty = consistent).
 */
export function checkExportIntegrity(data: IntegrityInput): string[] {
  const problems: string[] = [];
  const nodes = new Map(data.storyNodes.map((n) => [n.id, n.kind]));
  const ids = (rows: { id: string }[]) => new Set(rows.map((r) => r.id));
  const need = (
    what: string,
    id: string | null | undefined,
    set: Set<string> | Map<string, unknown>,
  ) => {
    if (id && !set.has(id)) problems.push(`${what} → ${id} is missing`);
  };
  const penNames = ids(data.penNames);
  const series = ids(data.series);
  const books = ids(data.books);
  const chapters = ids(data.chapters);
  const characters = ids(data.characters);
  const relationships = ids(data.relationships);
  const outlines = ids(data.outlines);
  const beats = ids(data.outlineBeats);
  const fields = ids(data.fieldDefinitions);
  const templates = new Set([...ids(data.structureTemplates), ...ids(data.builtInTemplates)]);

  // Every story object has a node of its kind (kinds from the registry).
  for (const kind of STORY_KINDS) {
    const { bundle, noun } = storyObjectType(kind);
    for (const r of data[bundle] as { id: string }[])
      if (nodes.get(r.id) !== kind) problems.push(`${noun.one} ${r.id} has no ${kind} story node`);
  }
  for (const e of data.calendarEvents) need("event.subject", e.subjectId, nodes);
  for (const s of data.series) need("series.penName", s.penNameId, penNames);
  for (const b of data.books) {
    need("book.penName", b.penNameId, penNames);
    need("book.series", b.seriesId, series);
  }
  for (const p of data.parts) need("part.book", p.bookId, books);
  const parts = ids(data.parts);
  for (const c of data.chapters) {
    need("chapter.book", c.bookId, books);
    need("chapter.part", c.partId, parts);
  }
  for (const s of data.scenes) {
    need("scene.book", s.bookId, books);
    need("scene.chapter", s.chapterId, chapters);
  }
  for (const c of data.characters) {
    need("character.penName", c.penNameId, penNames);
    need("character.series", c.seriesId, series);
  }
  for (const r of data.relationships) {
    if (r.members.length < 2) problems.push(`relationship ${r.id} has fewer than two members`);
    for (const m of r.members) need("relationship.member", m.characterId, characters);
  }
  for (const c of data.connections) {
    need("connection.source", c.sourceId, nodes);
    need("connection.target", c.targetId, nodes);
  }
  for (const o of data.outlines) {
    need("structure.book", o.bookId, books);
    need("structure.series", o.seriesId, series);
    need("structure.relationship", o.relationshipId, relationships);
    need("structure.character", o.characterId, characters);
    need("structure.template", o.templateId, templates);
  }
  for (const b of data.outlineBeats) {
    need("beat.structure", b.outlineId, outlines);
    need("beat.book", b.bookId, books);
  }
  for (const bs of data.beatScenes) {
    need("assignment.beat", bs.beatId, beats);
    need("assignment.scene", bs.sceneId, ids(data.scenes));
  }
  for (const e of data.timelineEvents) {
    need("timelineEvent.book", e.bookId, books);
    need("timelineEvent.series", e.seriesId, series);
  }
  for (const t of data.sceneStoryTimes) need("storyTime.scene", t.sceneId, ids(data.scenes));
  for (const p of data.sceneParticipations) {
    need("appearance.scene", p.sceneId, ids(data.scenes));
    need("appearance.character", p.characterId, characters);
  }
  for (const v of data.fieldValues) {
    need("fieldValue.field", v.fieldId, fields);
    need("fieldValue.node", v.nodeId, nodes);
  }
  for (const k of data.templateKits)
    for (const i of k.items) need("kit.template", i.templateId, templates);
  for (const f of data.fieldDefinitions) {
    need("field.penName", f.penNameId, penNames);
    need("field.series", f.seriesId, series);
    need("field.book", f.bookId, books);
  }
  for (const w of data.writingSessions ?? []) need("writing.book", w.bookId, books);
  for (const r of data.contentRevisions ?? []) need("revision.node", r.nodeId, nodes);
  for (const r of data.fieldRevisions ?? []) need("fieldRevision.node", r.nodeId, nodes);
  return problems;
}
