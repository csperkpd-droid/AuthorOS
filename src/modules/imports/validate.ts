import "server-only";

import { CURRENT_DOC_FORMAT } from "@/lib/doc-format";

import { canConnect, getKind, isConnectionKind } from "@/modules/connections";
import { checkExportIntegrity } from "@/modules/exports";
import { STORY_KINDS, storyObjectType } from "@/modules/story-graph";

import type { WorkspaceBundle } from "./bundle";

/**
 * Everything about a bundle that can be checked without the database:
 * every reference resolves (the export's own integrity check), ids are
 * unique, and the product rules hold (identities never mix, relationships
 * have two or more members, structures have one owner, connections follow
 * the registry). Returns the problems found; empty = valid.
 */
export function validateBundle(b: WorkspaceBundle): string[] {
  const problems = checkExportIntegrity(b);

  // Story node ids are unique, and each has exactly one object of its kind.
  const nodeKind = new Map<string, string>();
  for (const n of b.storyNodes) {
    if (nodeKind.has(n.id)) problems.push(`story node ${n.id} appears twice`);
    nodeKind.set(n.id, n.kind);
  }
  // The kinds and where their rows are come from the Story Object Registry.
  const typed = STORY_KINDS.map((kind) => b[storyObjectType(kind).bundle] as { id: string }[]);
  const seen = new Set<string>();
  for (const rows of typed)
    for (const r of rows) {
      if (seen.has(r.id)) problems.push(`object ${r.id} appears twice`);
      seen.add(r.id);
    }
  for (const n of b.storyNodes)
    if (!seen.has(n.id)) problems.push(`story node ${n.id} has no ${n.kind.toLowerCase()}`);
  const unique = (label: string, rows: { id: string }[]) => {
    const ids = new Set<string>();
    for (const r of rows) {
      if (ids.has(r.id)) problems.push(`${label} ${r.id} appears twice`);
      ids.add(r.id);
    }
  };
  unique("pen name", b.penNames);
  unique("beat", b.outlineBeats);
  unique("template", [...b.structureTemplates, ...b.builtInTemplates]);
  unique(
    "template beat",
    b.structureTemplates.flatMap((t) => t.beats),
  );
  unique("kit", b.templateKits);
  unique("field", b.fieldDefinitions);
  unique("connection", b.connections);
  unique("writing session", b.writingSessions);
  unique("version", b.contentRevisions);
  if (problems.length) return problems;

  // ── Identities ──
  const penOf = penLookup(b);
  const seriesPen = new Map(b.series.map((s) => [s.id, s.penNameId]));
  const chapter = new Map(b.chapters.map((x) => [x.id, x]));
  const part = new Map(b.parts.map((x) => [x.id, x]));
  const character = new Map(b.characters.map((x) => [x.id, x]));

  for (const x of b.books)
    if (x.seriesId && seriesPen.get(x.seriesId) !== x.penNameId)
      problems.push(`book “${x.title}” is in a series of another pen name`);
  for (const x of b.characters)
    if (x.seriesId && seriesPen.get(x.seriesId) !== x.penNameId)
      problems.push(`character “${x.name}” belongs to a series of another pen name`);
  for (const x of b.chapters)
    if (x.partId && part.get(x.partId)?.bookId !== x.bookId)
      problems.push(`chapter “${x.title}” is in a part of another book`);
  for (const x of b.scenes)
    if (chapter.get(x.chapterId)?.bookId !== x.bookId)
      problems.push(`scene “${x.title}” is in a chapter of another book`);

  // ── Relationships: one per set of members ──
  const memberSets = new Set<string>();
  for (const r of b.relationships) {
    const ids = r.members.map((m) => m.characterId);
    const set = [...ids].sort().join(",");
    if (memberSets.has(set)) problems.push(`two relationships “${r.type}” have the same members`);
    memberSets.add(set);
    if (new Set(ids).size !== ids.length)
      problems.push(`relationship “${r.type}” lists a member twice`);
    const pens = new Set(ids.map((id) => character.get(id)?.penNameId));
    if (pens.size > 1)
      problems.push(`relationship “${r.type}” joins characters of different pen names`);
  }

  // ── Structures ──
  for (const o of b.outlines) {
    const owners = (o.bookId ? 1 : 0) + (o.seriesId ? 1 : 0);
    if (owners !== 1) problems.push(`structure “${o.title}” needs exactly one book or series`);
    if ((o.kind === "ROMANCE") !== Boolean(o.relationshipId))
      problems.push(`structure “${o.title}”: a romance arc belongs to a relationship`);
    if ((o.kind === "CHARACTER_ARC") !== Boolean(o.characterId))
      problems.push(`structure “${o.title}”: a character arc belongs to a character`);
    if (o.arcRole && o.kind !== "ROMANCE")
      problems.push(`structure “${o.title}”: only romance arcs are main or secondary`);
    const pen = penOf(o.id);
    for (const owner of [o.relationshipId, o.characterId])
      if (owner && penOf(owner) !== pen) problems.push(`structure “${o.title}” mixes pen names`);
  }
  const beatOutline = new Map(b.outlineBeats.map((x) => [x.id, x.outlineId]));
  for (const a of b.beatScenes)
    if (penOf(a.sceneId) !== penOf(beatOutline.get(a.beatId)!))
      problems.push(`a beat is assigned a scene of another pen name`);

  // ── Tropes: one live trope per name, ignoring case and surrounding spaces ──
  const tropeNames = new Set<string>();
  for (const t of b.tropes) {
    if (t.deletedAt) continue;
    const key = t.name.trim().toLowerCase();
    if (tropeNames.has(key)) problems.push(`the trope “${t.name}” is listed twice`);
    tropeNames.add(key);
  }

  // ── Story Time ──
  for (const e of b.timelineEvents)
    if ((e.bookId ? 1 : 0) + (e.seriesId ? 1 : 0) !== 1)
      problems.push(`timeline event “${e.title}” needs exactly one book or series`);
  const placed = new Set<string>();
  for (const t of b.sceneStoryTimes) {
    if (placed.has(t.sceneId)) problems.push(`scene ${t.sceneId} is placed in story time twice`);
    placed.add(t.sceneId);
  }

  // ── Connections ──
  const pairs = new Set<string>();
  const pov = new Set<string>();
  for (const c of b.connections) {
    const source = nodeKind.get(c.sourceId) as Parameters<typeof canConnect>[1];
    const target = nodeKind.get(c.targetId) as Parameters<typeof canConnect>[2];
    if (c.sourceId === c.targetId) {
      problems.push(`connection ${c.id} links an object to itself`);
      continue;
    }
    if (!isConnectionKind(c.kind)) {
      problems.push(`connection ${c.id} has an unknown kind “${c.kind}”`);
      continue;
    }
    if (!canConnect(c.kind, source, target, { directedOnly: getKind(c.kind).directed }))
      problems.push(`connection ${c.id}: “${c.kind}” can’t join a ${source} and a ${target}`);
    const a = penOf(c.sourceId);
    const z = penOf(c.targetId);
    if (a && z && a !== z) problems.push(`connection ${c.id} links two pen names`);
    const key = getKind(c.kind).directed
      ? `${c.sourceId}|${c.targetId}|${c.kind}`
      : `${[c.sourceId, c.targetId].sort().join("|")}|${c.kind}`;
    if (pairs.has(key)) problems.push(`connection ${c.id} is listed twice`);
    pairs.add(key);
  }

  // ── Scene Participation ──
  const sceneBook = new Map(b.scenes.map((s) => [s.id, s.bookId]));
  const bookOf = new Map(b.books.map((x) => [x.id, x]));
  const characterOf = new Map(b.characters.map((c) => [c.id, c]));
  const participations = new Set<string>();
  for (const p of b.sceneParticipations) {
    const book = bookOf.get(sceneBook.get(p.sceneId) ?? "");
    const character = characterOf.get(p.characterId);
    if (!book || !character) {
      problems.push(`a scene appearance refers to a missing scene or character`);
      continue;
    }
    const key = `${p.sceneId}|${p.characterId}`;
    if (participations.has(key)) problems.push(`${character.name} is listed twice in a scene`);
    participations.add(key);
    if (character.penNameId !== book.penNameId)
      problems.push(`${character.name} appears in a scene of another pen name`);
    if (character.seriesId && character.seriesId !== book.seriesId)
      problems.push(`${character.name} appears in a scene outside their series`);
    if (p.isPov) {
      if (pov.has(p.sceneId)) problems.push(`scene ${p.sceneId} has two point-of-view characters`);
      pov.add(p.sceneId);
    }
  }

  // ── Custom fields ──
  const field = new Map(b.fieldDefinitions.map((f) => [f.id, f]));
  const labels = new Set<string>();
  for (const f of b.fieldDefinitions) {
    const scopes = [f.penNameId, f.seriesId, f.bookId].filter(Boolean);
    if (scopes.length > 1) problems.push(`field “${f.label}” has more than one scope`);
    const key = `${f.nodeKind}|${scopes[0] ?? ""}|${f.label.toLowerCase()}`;
    if (labels.has(key)) problems.push(`field “${f.label}” is defined twice`);
    labels.add(key);
  }
  const valueKeys = new Set<string>();
  for (const v of b.fieldValues) {
    if (nodeKind.get(v.nodeId) !== field.get(v.fieldId)!.nodeKind)
      problems.push(
        `field “${field.get(v.fieldId)!.label}” has a value on the wrong kind of object`,
      );
    const key = `${v.nodeId}|${v.fieldId}`;
    if (valueKeys.has(key)) problems.push(`a field value is listed twice`);
    valueKeys.add(key);
  }

  // ── Documents: never from a newer format than this version reads ──
  const newer = [
    ...b.scenes.map((x) => x.contentFormat),
    ...b.notes.map((x) => x.bodyFormat),
    ...b.contentRevisions.map((x) => x.contentFormat),
  ].filter((f) => f > CURRENT_DOC_FORMAT);
  if (newer.length)
    problems.push(
      `${newer.length} documents were written by a newer version of Spellbound Draft (format ${Math.max(...newer)}).`,
    );

  // ── Calendar: dates of their own, or dates that belong to an object ──
  const deadlines = new Set<string>();
  for (const e of b.calendarEvents) {
    if (e.endsOn && e.endsOn < e.startsOn)
      problems.push(`event “${e.title}” ends before it starts`);
    if (e.purpose !== "DEADLINE") continue;
    const kind = nodeKind.get(e.subjectId ?? "") as
      Parameters<typeof storyObjectType>[0] | undefined;
    if (!kind || !storyObjectType(kind).dated)
      problems.push(`deadline ${e.id} belongs to nothing that can have a deadline`);
    else if (!e.deletedAt && deadlines.has(e.subjectId!))
      problems.push(`${storyObjectType(kind).noun.one} ${e.subjectId} has two deadlines`);
    else if (!e.deletedAt) deadlines.add(e.subjectId!);
  }

  return [...new Set(problems)];
}

/**
 * The pen name each object of the bundle belongs to (null = shared: notes,
 * ideas, tasks, events). Relationships take their members' pen name;
 * structures their book's or series'.
 */
export function penLookup(b: WorkspaceBundle): (id: string) => string | null {
  const pen = new Map<string, string>();
  for (const x of b.penNames) pen.set(x.id, x.id);
  for (const x of b.series) pen.set(x.id, x.penNameId);
  for (const x of b.books) pen.set(x.id, x.penNameId);
  for (const x of b.characters) pen.set(x.id, x.penNameId);
  const bookPen = (bookId: string) => pen.get(bookId);
  for (const x of [...b.parts, ...b.chapters, ...b.scenes]) {
    const p = bookPen(x.bookId);
    if (p) pen.set(x.id, p);
  }
  for (const r of b.relationships) {
    const p = r.members.length ? pen.get(r.members[0].characterId) : undefined;
    if (p) pen.set(r.id, p);
  }
  for (const o of [...b.outlines, ...b.timelineEvents]) {
    const p = pen.get((o.bookId ?? o.seriesId)!);
    if (p) pen.set(o.id, p);
  }
  return (id) => pen.get(id) ?? null;
}
