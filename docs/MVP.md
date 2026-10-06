# MVP

The MVP is a **single-author** workspace that covers the daily writing loop
and the story bible, with structure and romance planning, on a foundation
built for the long-term vision (see [ROADMAP.md](ROADMAP.md)).

**Guiding rule:** keep features small, never the architecture. Anything the
long-term vision needs from the database or module boundaries is put in
place even when the MVP UI doesn't use it yet (workspaces, roles, pen names,
the suggestion boundary).

## In scope

| Milestone                                     | Delivers                                                                                                                                                                                                                                                                                                                                                                            | Done when                                                                                                                                          |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **0: Foundations** ✅                         | Repo, tooling, CI, database architecture, Auth.js (magic link + Google), workspace bootstrap, default pen name, app shell, docs                                                                                                                                                                                                                                                     | An author can sign in, gets a workspace and default pen name, and sees the shell; CI is green.                                                     |
| **1: Writing loop + identities** ✅           | Series, books, optional parts, chapters, scenes; binder with drag-and-drop and Move to…; Tiptap editor with autosave and conflict protection; word counts; scene status and synopsis; revision history with named versions and restore; Trash; full pen-name management (create, edit, default, archive, assign, switch identity, All Identities view); Story Graph extension point | An author can draft a full manuscript under any of their pen names, reorganize it, and recover any earlier version or deleted item.                |
| **2: Story bible + Universal Connections** ✅ | Characters (profile, role, series scope, scene cast with POV); relationships (story nodes with their own scenes and notes); notes (rich text, about anything); ideas (capture, promote to book); Universal Connections (registry, panel, picker, backlinks); Trash for every new kind                                                                                               | From any scene you can see who is in it and what notes are about it; from any character, where they appear; anything can be connected to anything. |
| **3: Structure and romance** ✅               | Built-in beat templates; outlines per book (plot, romance arc per relationship, character arc, subplot, custom); beats placed in real scenes (many-to-many, no copies); notes version history; characters scoped to pen names; custom fields; tropes and heat level                                                                                                                 | An author can lay a beat sheet over the manuscript and see gaps.                                                                                   |
| **4: Getting work done** ✅                   | Tasks; calendar (events, due dates, deadlines, words per day); automatic writing sessions and logged words; daily goal, streak, deadline pace on the dashboard; plus series-long structures and the Series Romance Center, Save as template, Change Impact for pen-name moves, scoped custom fields                                                                                 | An author can plan their week and track daily words.                                                                                               |
| **5: Ownership** ✅                           | Global search; DOCX and Markdown manuscript export; full workspace JSON export (current, selected or all pen names); plus group relationships, template kits, Change Impact for deleting forever, fields and templates                                                                                                                                                              | An author can find anything and take all their data with them.                                                                                     |

## Out of MVP scope (and where it goes)

| Feature                                       | When  | Groundwork already in place                                          |
| --------------------------------------------- | ----- | -------------------------------------------------------------------- |
| Timeline                                      | v1.1  | Target schema in DATABASE.md; nav entry reserved.                    |
| Publishing workflows                          | v1.1  | Target schema; pen names and editions modeled.                       |
| AI suggestions                                | v1.2  | `Suggestion` boundary designed; revisions record `source`.           |
| Collaboration                                 | v1.3+ | Workspaces, memberships and roles exist; database sessions.          |
| Pen-name branding, links, publishing accounts | v1.1  | Pen names, archive, assignment and identity switching shipped in M1. |
| More import sources (Scrivener, Plottr, DOCX) | Later | Import Engine (M6): a source parser produces a Workspace Bundle.     |

## Milestone 11 checklist (Scene Participation)

- [x] A dedicated relationship (`scene_participations`): Present or Mentioned, plus point of view; Mentioned never implies Present; POV + Present together
- [x] At most one point of view per scene (database and service); a second one is refused; changing it is an explicit, confirmed action; nobody's POV is replaced or removed as a side effect
- [x] Scene page: see, add (existing or new character), change, remove; the point of view at a glance; Present and Mentioned look different; the same on a phone
- [x] Character page: the scenes they are in, with their part; search by part (all, point of view, present, mentioned)
- [x] Story History of every change; edit rights required; reads through the Story Graph funnel; Trash and delete never name hidden characters or invent replacements
- [x] Manuscript text never changed or read for it; `appears_in` connections migrated (database, export format 4, import upgrade)

## Milestone 10 checklist (Work Context)

- [x] Back stays the browser's history
- [x] Return to Work (sidebar and phone header): back to the place being worked on from any detour; nested work for notes written in during a detour; survives refresh; owned by one account, cleared at sign-out
- [x] Continue Writing (dashboard): the latest writing place on any device; falls back to the most recent scene
- [x] Version-aware positions: restored exactly, followed when the text moved, or the author is told; never invented; changes made during a detour stay
- [x] A place that is gone or no longer viewable is never named

## Milestone 9 checklist (Access Boundary)

- [x] Reads authorized below the UI: `assertCanView` first in every read service, by the existing grants; refused named objects look like missing ones; the Story Graph funnel drops what a role may not view; enforced by a test over every exported read service
- [x] Device drafts owned by one account (user and workspace); another account on the same browser never sees them; drafts from before M9 adopted only by an account that can open the document
- [x] Sign-out warning when unsynced writing exists: what is unsynced, what signing out means, Stay signed in or Sign out anyway (nothing deleted)
- [x] Architecture baseline (29 invariants) recorded in `docs/ARCHITECTURE.md`, derived rules in `AGENTS.md`, decisions 103–106 (including Scene Participation, built later)

## Milestone 8 checklist (Safety & Readiness)

- [x] Editor: local draft on this device first (IndexedDB), cloud autosave in the background, honest status (cloud / this device · offline / retrying); crash recovery; older-version drafts kept as a separate version
- [x] Large-edit checkpoints before saves that remove much of a document
- [x] Field history (and restore) for synopses, summaries, profile fields, descriptions, idea bodies, task notes, bios, beat descriptions; imports keep replaced text
- [x] Stale-edit protection for metadata forms and in-place fields
- [x] Document format versions for scenes, notes and revisions; upgrade on read; newer formats refused on import
- [x] Change Impact levels Green / Yellow / Red; Yellow suggestions accepted or ignored one by one (beat description as a note; notes/ideas/tasks/events only about deleted items)
- [x] Book writing status separate from publication (no "Published"); migration keeps the fact as a field
- [x] Core character fields protected from duplicate custom fields
- [x] Export format version 3 with upgrades of version 1–2 files
- [x] Review: device buffer documented as a permanent safety layer (decision 101); remaining risks recorded as known and deferred (decision 102)
- [x] Decided, not built: comment anchors, Life Planner privacy boundary, project-level access, Beat vs Beat Assignment, Tropes as objects, editions

## Milestone 7 checklist (Foundations)

- [x] Story Object Registry: one definition per kind (display, area, identity, hierarchy, structure roles, connections, custom fields, search, lifecycle, Change Impact, dates, table, export/import key) with one server adapter per kind; resolver, Trash, search, connections, fields, Change Impact, authorization, export and import read it
- [x] Authorization close to the data: `assertCan` first in every write service (roles × areas × actions), enforced by a test over every module's exports
- [x] One model for dates: deadlines are calendar entries about their object; book due dates migrated; book page, calendar and dashboard pace read the same row
- [x] Pen names are story nodes (connectable, searchable; archived, never trashed)
- [x] Change Impact: a book leaving or changing series (series beats and placements), removing relationship members, removing a beat, removing a part; never silently (reviewed token required); character series changes refused while appearances would be stranded
- [x] Story Graph integrity audit: `auditGraph()` plus a registry-driven test of every capability of every kind
- [x] Export format version 2 with upgrades of version 1 files on import
- [x] Deferred by decision: background jobs, richer field types, note/idea scopes, repeating tasks/events, live co-editing

## Milestone 6 checklist

- [x] Import Engine: source registry (AuthorOS JSON available; Scrivener, Plottr, DOCX, EPUB shown as coming later), Workspace Bundle, whole-file validation before anything changes
- [x] Import review: create / update / already here per kind, conflicts with the objects concerned, adjustments, or the file's problems
- [x] Restore with original Story Graph ids, or import as a copy with new ids; keep or replace existing objects (current text saved as a version first); never moves identity
- [x] Preserves pen names and identity separation, the series → scene hierarchy, characters and group relationships (with roles), connections, structures and beat assignments, custom fields and values, notes, ideas, tasks, events, writing sessions and (archives) version history
- [x] All or nothing: one transaction, plan re-checked against the review token; a failure midway changes nothing (tested)
- [x] Search language per pen name: stemming in ~25 languages next to exact prefix and phrase matching
- [x] Optional member roles in relationships, shown in the Romance Center
- [x] Export: Standard backup and Complete archive (with version history)
- [x] Architecture checkpoint report (findings and recommendations only)

## Milestone 5 checklist

- [x] Group relationships: two or more members (pairs, triangles, Why Choose/RH), one per set of members (database-checked), with the pairs inside a group as relationships of their own; group romance arcs; members editable
- [x] Template kits: create, edit, delete; "Save as kit" from a book or series; apply to a book or series, choosing relationship(s) for romance templates and character(s) for arcs; all or nothing; independent copies
- [x] Change Impact for deleting forever, emptying the Trash, deleting a custom field in use and deleting a template; factual summaries ("This will affect 7 items: …"); stale reviews refused
- [x] Search: full-text over scenes, notes, ideas and characters (prefix matching, highlighted snippets), titles of everything else; Trash and "Writing as" respected
- [x] Export wizard: current pen name, selected pen names or entire workspace; DOCX (standard manuscript format) and Markdown manuscripts; full JSON backup preserving ids, hierarchy, relationships, connections and beat assignments, with an integrity check for a future import; read-only
- [x] Tests: integration tests for every rule above (incl. database triggers, export integrity and read-only); end-to-end flows on desktop and phone

## Milestone 4 checklist

- [x] Series structures: one structure spanning a series, beats planned per book and placed in any of its books' scenes; whole-series or per-book view; shown on every book of the series
- [x] Series Romance Center: every romance arc of a series, grouped by relationship (main and secondary couples), as a progression book by book
- [x] Save as template; templates page (rename, delete); applying creates new, independent structures and beats; series templates plan beats onto books
- [x] Change Impact: "What will this affect?" with Move everything / Review changes / Cancel; moving a standalone book or a series to another pen name moves its characters, relationships, structures and pen-limited field values; blockers instead of orphans; stale reviews refused
- [x] Custom fields scoped to the current pen name (default), all pen names, a series or a book
- [x] Tasks: quick add, priority, due dates, complete/reopen, Done view, "New task" from books and scenes, Trash
- [x] Calendar: month grid (phone: list), events (multi-day, time), task due dates, book deadlines, words per day
- [x] Writing progress: words recorded per book and day from scene saves (not restores), logged words, time zone, daily goal, streak, 30-day chart, deadline pace
- [x] Tests: integration tests for every rule above (incl. concurrency of daily totals, time zones, stale impact reviews); end-to-end flows on desktop and phone

## Milestone 3 checklist

- [x] Built-in templates (Three-Act, Save the Cat, Hero's Journey, Romancing the Beat, Positive Change Arc), seeded
- [x] Outlines as story nodes: plot, romance arc (owned by a relationship), character arc (owned by a character), subplot, custom
- [x] Beat board: add, edit, reorder (drag or keyboard), remove beats; place each in one or more scenes; % position vs target; unplaced beats flagged
- [x] One scene carries beats of many structures, shown in the scene editor; scenes are never copied
- [x] Structures from the Story structure page, a book, a relationship ("New romance arc") or a character ("New arc"); Trash and restore
- [x] Notes version history: checkpoints, named versions, preview, restore (shared `history` module)
- [x] Characters belong to a pen name (and optionally a series); "Writing as" filters characters, relationships, structures and pickers; no links across identities
- [x] Custom fields: definitions per kind (optionally per pen name), values per object; on characters
- [x] Books: tropes (with suggestions) and heat level
- [x] Tests: integration tests for structure, identity rules, history and fields; end-to-end structure, history, identity and custom-field flows

## Milestone 2 checklist

- [x] Universal Connections: one `connections` table between story nodes, kinds in a code registry, tenant-safe and cascading
- [x] Connection kinds: `develops_in`, `about`, `inspired`, `related` (characters in scenes were `appears_in`, Scene Participation since M11)
- [x] Generic Connections panel + picker (cross-kind search) on every story object page; backlinks both ways
- [x] Characters: list, profile fields (save on leave), role, aliases, series scope, appearances
- [x] Scene cast in the editor: add existing or new characters, set POV/present/mentioned, remove
- [x] Relationships: story nodes between two characters; their own scenes ("Develops in") and notes
- [x] Notes: rich text with autosave and conflict protection; "New note" from any book, scene, character or relationship
- [x] Ideas: quick capture, status, promote to a book (linked back)
- [x] Trash, restore and delete-forever for characters, relationships, notes and ideas; links hide and return
- [x] Tests: registry unit tests; integration tests for every connection rule and DB guarantee; end-to-end story bible flows

## Milestone 1 checklist

- [x] Story Graph extension point: `story_nodes` identity for every story object (DB-enforced)
- [x] Pen names: create, edit, set default, archive/restore; assign series and books; "Writing as" switcher; All Identities view
- [x] Series (with reading order) and books (status, target, description)
- [x] Book → (optional Part) → Chapter → Scene, with mixed top level and "remove part, keep chapters"
- [x] Binder: add, rename, drag-and-drop (mouse, touch, keyboard, announced), Move to…, Trash
- [x] Editor: Tiptap, autosave, Ctrl/Cmd+S, leave-page warning, conflict protection, live word count
- [x] Scene status and synopsis; previous/next scene; contents navigation
- [x] Revisions: automatic checkpoints, named versions, preview, restore (undoable)
- [x] Trash: restore, delete forever, empty
- [x] Dashboard: continue writing
- [x] Tests: unit, integration (real Postgres, DB guarantees, concurrency), end-to-end (desktop + phone)

## Milestone 0 checklist

- [x] Next.js 16 + React 19 + TypeScript + Tailwind CSS 4 project
- [x] Prisma 7 + PostgreSQL; first migration (identity, tenancy, pen names)
- [x] Auth.js v5: email magic link (Resend) + Google, database sessions
- [x] Personal workspace + OWNER membership + default pen name on first sign-in (idempotent, concurrency-safe)
- [x] Data Access Layer (`requireAuthorContext`) and optimistic `proxy.ts`
- [x] App shell: sidebar, mobile nav, dashboard, settings, placeholder pages from the feature registry
- [x] Module boundaries enforced by ESLint
- [x] Unit + integration tests (real Postgres) + Playwright end-to-end (desktop and mobile)
- [x] CI workflow; Docker Compose for local Postgres; `.env.example`
- [x] Docs: ARCHITECTURE, MVP, ROADMAP, DATABASE, DECISIONS
