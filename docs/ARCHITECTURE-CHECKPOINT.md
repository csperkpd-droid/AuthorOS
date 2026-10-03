# Architecture checkpoint (before v1.1)

A review of the implementation after Milestone 6 against the AuthorOS
blueprint (README principles, [MVP.md](MVP.md), [ROADMAP.md](ROADMAP.md),
the target design in [DATABASE.md](DATABASE.md), and the direction given at
each milestone approval). **Findings and recommendations only: nothing
here is implemented.** The next architecture direction and the v1.1 order
are decided after review.

Each recommendation is marked **R1…R14** and summarized with a proposed
order at the end.

> **Status after Milestone 7 (Foundations):** R3 (Story Object Registry),
> R4 (authorization in services), R13 (one model for dates), R14 (pen names
> connectable) and the Change Impact / orphan findings of §5 are
> implemented; the Story Graph integrity audit is automated. R1 (background
> jobs) was deliberately not built (decision 85). R8 is decided: comments,
> suggestions and reviewed edits; no live co-editing (decision 79). R10,
> R11 and note/idea scopes stay on the roadmap (decision 86). Others (R2,
> R5, R6, R7, R9, R12) remain as listed, timed with their features.

---

## 1. What is implemented

| Area          | State                                                                                                                                                                                                                                   |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Foundations   | Next.js 16 modular monolith, Postgres + Prisma 7, Auth.js (magic link, Google), one personal workspace per user, lint-enforced module boundaries, Data Access Layer (`requireAuthorContext`), CI with integration and end-to-end tests. |
| Identities    | Pen names (default, archive, language), "Writing as" / All Identities, identity separation enforced in services (`sameIdentity`) and composite FKs; identity moves only through Change Impact.                                          |
| Manuscript    | Series → books → optional parts → chapters → scenes; binder with drag-and-drop; Tiptap editor with autosave and version conflicts; revision history with named versions and restore; Trash.                                             |
| Story Graph   | 12 node kinds share `story_nodes`; resolver and visibility per kind; Universal Connections with a registry (6 kinds); custom fields on any kind, scoped to identity / series / book.                                                    |
| Story bible   | Characters (profile, role, series scope), relationships of two or more members with per-membership roles, notes (rich text, versioned), ideas.                                                                                          |
| Structure     | Built-in and own templates, structures per book or series (plot, romance per relationship, character arc, subplot, custom), beats placed in real scenes, Series Romance Center, template kits.                                          |
| Planning      | Tasks, calendar events, book due dates, automatic and logged writing sessions, daily goal, streak, deadline pace.                                                                                                                       |
| Change Impact | One report builder; identity moves, delete forever, empty Trash, deleting fields and templates; token-checked apply.                                                                                                                    |
| Ownership     | Search (exact + per-language stemming), DOCX/Markdown manuscripts, Standard backup and Complete archive JSON, Import Engine (AuthorOS JSON: restore, move, copy; all or nothing).                                                       |

## 2. Architecturally ready but not exposed

| Ready                                          | What exists                                                                                  | Missing to expose                                                                 |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Workspace roles (OWNER / EDITOR / VIEWER)      | `workspace_members.role`, `AuthorContext.role`                                               | Any check of it (see R4); invitations.                                            |
| Several workspaces per user                    | Memberships are many-to-many; `findPrimaryMembership()` is the one place a switcher plugs in | Workspace switcher, create/rename workspace, transfer ownership (R5).             |
| `IMPORT`, `AI_ACCEPTED` revision sources       | Enum values; `IMPORT` now used                                                               | `AI_ACCEPTED` waits for v1.2 Suggestions.                                         |
| Import sources (Scrivener, Plottr, DOCX, EPUB) | Source catalog and parser interface; every source only has to produce a Workspace Bundle     | The parsers.                                                                      |
| Kit item types                                 | `template_kit_items.item_type` (`STRUCTURE` only)                                            | Publishing-workflow templates (v1.1).                                             |
| Per-language search indexes                    | Language → configuration map; queries already per configuration                              | Expression indexes per language when data grows.                                  |
| Optional scopes for notes and ideas            | Designed (DATABASE.md "Later"); the resolver derives identity per kind                       | Columns, capture UI that stays scope-free, filters (requested at M4 as "future"). |
| Edition-level pen names                        | Designed (`editions.pen_name_id`)                                                            | Built with Publishing.                                                            |
| Manuscript render pipeline for more formats    | `lib/doc-blocks.ts` block model feeding DOCX and Markdown                                    | EPUB/PDF renderers, styles (see R9).                                              |
| Writing sessions per user                      | `writing_sessions.user_id`                                                                   | Per-collaborator stats.                                                           |

## 3. Missing foundational infrastructure

1. **Background jobs.** Exports, the import (one transaction of up to 10
   minutes) and future EPUB/PDF builds run inside the request. Serverless
   time limits and long transactions will bite first on large archives.
   **R1:** add pg-boss (already the planned choice) with a `jobs` module and
   an `import_jobs` / `export_jobs` record the UI can poll; keep the import's
   plan/apply code unchanged, only move where it runs.
2. **File and media storage.** There is no asset model: no covers, brand
   kits, images in scenes, or stored export files. Branding, Publishing and
   Formatting all need it. **R2:** an `assets` table (workspace, blob key,
   type, size, checksum) on Vercel Blob, referenced by id; decide whether an
   asset is a story node (connectable, e.g. "mood board image about a
   character") — recommended yes.
3. **Authorization policy.** No service checks `ctx.role`; destructive and
   bulk operations (import, delete forever, empty Trash, identity moves)
   assume the owner. Harmless while every member is OWNER, but every
   service written from now on adds to the retrofit. **R4:** introduce
   `can(ctx, action, resource?)` now, call it in services for writes, and
   mark owner-only operations; no UI change.
4. **Activity log.** Nothing records who did what (only `created_by_id` on
   connections and revisions). Collaboration, Change Impact history ("what
   did that import change?") and support all need it. **R6:** an
   append-only `activity_log` (workspace, actor, action, node ids, summary,
   report token), written by Change Impact applies, imports and
   collaboration-relevant writes.
5. **Range-anchored annotations.** Comments, editorial notes, revision
   marks and AI suggestions all need to point at a span of text that
   survives edits. Today only whole objects can be linked. **R7:** design
   one annotation anchor (ProseMirror marks with stable ids stored in the
   document, plus an `annotations` table keyed by that id and the node) and
   reuse it for comments (Collaboration), revision notes (Revision) and
   suggestions (v1.2).
6. **Recurrence and time.** Events have a date and an optional `HH:MM`
   with no time zone or duration, tasks have no recurrence. A Planner / Life
   Planner needs repeating items, durations, reminders and calendar export
   (ICS). **R10** (before Planner work): add RRULE-style recurrence and
   zoned start/end to events and tasks.

## 4. Decisions that could hinder future features

1. **"Moving a workspace between accounts" inside one installation can't
   keep ids.** Story-node ids are global primary keys, so a restore into a
   second account of the same installation must be a copy (new ids). That
   is correct for a backup, but for "give this workspace to another account"
   the right tool is a **workspace ownership transfer** (change membership),
   not export/import. **R5.**
2. **Real-time collaboration vs the content model.** Scene and note text is
   saved as whole ProseMirror JSON with an optimistic version number:
   right for one author on several devices, wrong for simultaneous
   co-editing. If v1.3 must include live co-editing, the editor storage
   needs a CRDT (Yjs) document per scene, with the JSON kept as the
   derived, searchable copy. **Decision needed** (R8): async collaboration
   (comments, suggestions, locking) only, or live co-editing.
3. **Fixed character profile vs custom fields.** Characters have a fixed
   `profile` JSON (hard-coded field list) and, separately, custom fields
   with only `TEXT` / `LONG_TEXT` types. Worldbuilding and Planner need
   numbers, dates, single/multi-select and references to other objects.
   **R11:** make built-in profile fields "system" field definitions and add
   field types; decide that a "reference" field is a connection (to keep one
   linking mechanism).
4. **Adding a node kind is now expensive.** A new kind touches the enum,
   its table and triggers, `resolve.ts`, `visibility.ts`, labels, the
   connection registry, Trash, search, the export, the integrity check, the
   import bundle, validation, plan and apply: about 14 places, several of
   them long switch-like lists. Worldbuilding alone may add 5–10 kinds.
   **R3:** a **node-kind registry**: one descriptor per kind (table, labels,
   title column, identity derivation, parent, searchable text, versioned
   content, export/import column list) that the resolver, Trash, search,
   export and import iterate over. Do this before Timeline, the next kind.
5. **One table per worldbuilding type.** Locations, factions, magic
   systems, items, species… as separate tables multiplies the cost above.
   **R12:** a generic `world_entries` node kind with an author-defined entry
   type and custom fields, plus a few first-class kinds only where behavior
   differs (e.g. locations with hierarchy and maps).
6. **Deadlines live in two places.** `books.due_on` and calendar events
   are separate sources; Publishing adds release dates per edition. Decide
   one rule (dates on objects, the calendar as a view over them) before
   Publishing. **R13.**
7. **Synchronous export/import sizes.** Upload caps (60 MB compressed /
   200 MB) and in-memory parsing are fine now; archives with long version
   histories will grow. Covered by R1 (stream to storage, process in a job).
8. **Export format evolution.** The importer accepts `version ≤ 1`. The
   first format change needs upgrade steps (v1 → v2 bundle) so old backups
   keep importing. Cheap to set up when it happens; recorded so it isn't
   forgotten.

## 5. Drift from the Story Graph architecture

| Finding                                                                                                                                                                               | Severity                  | Recommendation                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Pen names aren't story nodes.** Marketing tasks, branding notes and publishing events can't be connected to a pen name; v1.1 Branding makes this common.                            | Medium (blocks v1.1 UX)   | R14: make pen names connectable (node kind, outside the identity rule since they _are_ the identity), or give tasks/events/notes an optional pen-name scope. |
| **Beats aren't story nodes.** Timeline events and notes can't link to a beat ("this beat happens on day 3").                                                                          | Low                       | Decide with Timeline: beats as nodes, or timeline events linked to scenes only.                                                                              |
| **A book leaving its series keeps series-arc placements.** `setBookSeries` doesn't touch beats planned for that book (`outline_beats.book_id`) or its scenes' series-arc assignments. | Medium (silent leftovers) | Route "leave series" through Change Impact (list affected beats and assignments; clear or keep). Import accepts this state so backups still restore.         |
| **Other edits that affect connected data without a report:** removing a member from a relationship that owns an arc or roles; archiving a pen name with active work.                  | Low–medium                | Extend Change Impact to these, per the M5 direction ("extend to other destructive operations").                                                              |
| Structural links that are deliberately not connections (beat → scene, membership, hierarchy) are consistent with the documented rule.                                                 | None                      | Keep.                                                                                                                                                        |
| Exports, import, search and visibility all resolve through the graph; no module reads another module's tables directly.                                                               | None                      | Keep; R3 makes it cheaper to stay that way.                                                                                                                  |

## 6. Original requirements still open

- **Optional scope for notes and ideas** (All Identities / Pen name / Series
  / Book; capture never requires it): designed, not built.
- **Change Impact for every destructive or identity-affecting operation**:
  the cases in §5 remain.
- **Publishing workflows in template kits**: waits for Publishing.
- **AI suggestions** (v1.2): the `Suggestion` boundary is designed but no
  table or module exists yet; R7 (anchors) should come first so suggestions
  can target text ranges.
- **Front and back matter.** The manuscript model has only parts, chapters
  and scenes. Formatting and Publishing need title page, copyright,
  dedication, epigraph, acknowledgments, about the author, also-by (per pen
  name). **R9:** "manuscript sections" (front/back matter kinds, ordered per
  book, some generated from pen-name data) before Formatting.
- **Interface language.** Search is multilingual per pen name; the
  interface itself is English only, with strings in components. If a
  localized UI is in scope, extracting strings early is far cheaper. Open
  question.

## 7. Areas to strengthen before each future area

| Future area               | Strengthen first                                                                                                                                        |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Timeline                  | R3 node-kind registry; decide beats-as-nodes; keep in-world time (label + sort key) distinct from the real-world calendar in naming.                    |
| Publishing                | R13 one date rule; R2 assets (covers); R1 jobs; editions as designed; R14 pen names connectable.                                                        |
| Branding                  | R2 assets; R14 pen-name nodes; pen-name links table as designed.                                                                                        |
| Collaboration             | R4 policy helper; R6 activity log; R5 workspace switcher and transfer; R8 decision on live co-editing; R7 anchors for comments.                         |
| Formatting                | R9 front/back matter; a defined block vocabulary (scene breaks, epigraphs, letters, text messages) on top of `doc-blocks`; R1 for builds.               |
| Revision (editing passes) | R7 anchors; revision "passes" as a grouping over `content_revisions`; compare views reuse the diff from history.                                        |
| Worldbuilding             | R3 registry; R12 generic world entries; R11 richer field types.                                                                                         |
| Planner / Life Planner    | R10 recurrence and zoned times; decide whether personal (non-writing) items live in the Story Graph or in a separate planner module that links into it. |
| Import (more sources)     | R1 jobs and storage for large files; parsers produce bundles with fresh ids; per-source mapping review in the same review UI.                           |
| AI (v1.2)                 | R7 anchors; R4 policy (AI acts as a member with no write rights except suggestions); R6 activity log.                                                   |

## 8. Recommendations and proposed order

| #   | Recommendation                                             | Size   | Proposed timing                     |
| --- | ---------------------------------------------------------- | ------ | ----------------------------------- |
| R3  | Node-kind registry (one descriptor per kind)               | Medium | Before v1.1 (Timeline adds a kind)  |
| R4  | Authorization policy helper `can()` in services            | Small  | Before v1.1                         |
| R1  | Background jobs (pg-boss) for import/export/builds         | Medium | Before v1.1 Publishing              |
| R2  | Assets on object storage                                   | Medium | With v1.1 (Branding, covers)        |
| R13 | One rule for dates (objects own dates; calendar is a view) | Small  | Before Publishing                   |
| R14 | Pen names connectable (or scoped shared items)             | Small  | Before Branding                     |
| R6  | Activity log                                               | Small  | Before v1.3; useful now for imports |
| R5  | Workspace switcher and ownership transfer                  | Medium | Before v1.3                         |
| R7  | Range-anchored annotations                                 | Medium | Before Revision, v1.2 and v1.3      |
| R8  | Decision: async collaboration vs live co-editing           | —      | Before v1.3 design                  |
| R9  | Front/back matter sections                                 | Medium | Before Formatting                   |
| R10 | Recurrence and zoned times for tasks/events                | Small  | Before Planner                      |
| R11 | Field types and system profile fields                      | Medium | Before Worldbuilding                |
| R12 | Generic world entries                                      | Medium | With Worldbuilding                  |

Also small, any time: Change Impact for leaving a series, removing a
relationship member and archiving a pen name with active work (§5); bundle
version upgrades when the export format first changes (§4.8).

**Suggested direction:** a short "foundations" step (R3, R4, R13, R14, and
R1 if Publishing comes first) before v1.1 features, then Timeline (the
cheapest proof of R3), then Publishing with Branding (R2 lands with it).
