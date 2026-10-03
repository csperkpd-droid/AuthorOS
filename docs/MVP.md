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
| **4: Getting work done**                      | Tasks; calendar (events, due dates); writing sessions; goals; dashboard progress                                                                                                                                                                                                                                                                                                    | An author can plan their week and track daily words.                                                                                               |
| **5: Ownership**                              | Global search; export manuscript (DOCX, Markdown); export the whole workspace (JSON)                                                                                                                                                                                                                                                                                                | An author can find anything and take all their data with them.                                                                                     |

## Out of MVP scope (and where it goes)

| Feature                                       | When  | Groundwork already in place                                          |
| --------------------------------------------- | ----- | -------------------------------------------------------------------- |
| Timeline                                      | v1.1  | Target schema in DATABASE.md; nav entry reserved.                    |
| Publishing workflows                          | v1.1  | Target schema; pen names and editions modeled.                       |
| AI suggestions                                | v1.2  | `Suggestion` boundary designed; revisions record `source`.           |
| Collaboration                                 | v1.3+ | Workspaces, memberships and roles exist; database sessions.          |
| Pen-name branding, links, publishing accounts | v1.1  | Pen names, archive, assignment and identity switching shipped in M1. |
| Imports (DOCX, Scrivener)                     | Later | Revisions record `IMPORT` source.                                    |

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
- [x] Connection kinds: `appears_in` (with role; one POV per scene), `develops_in`, `about`, `inspired`, `related`
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
