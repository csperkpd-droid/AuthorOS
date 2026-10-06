# Architecture

AuthorOS is a **modular monolith**: one Next.js application, one PostgreSQL
database, with the code split into domain modules that have strict boundaries.

> Status: Milestone 9 (Access Boundary: permission-aware reads, account-owned device drafts, the architecture baseline below). Sections marked
> _planned_ describe the agreed design for later milestones so that early code
> doesn't block it.

## Principles → mechanisms

| Principle                  | How the architecture enforces it                                                                                                                            |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authors remain in control  | Revision history and soft-delete Trash for creative content; full export (manuscript and whole workspace); nothing is ever changed without a user action.   |
| AI suggests, never changes | The AI module can write to exactly one table, `Suggestion`. Applying a suggestion is an ordinary user action that saves a revision first. (_planned, v1.2_) |
| Strongly connected data    | Relational schema with real foreign keys and constraints; see [DATABASE.md](DATABASE.md).                                                                   |
| Modular and expandable     | Domain modules with public `index.ts` APIs, lint-enforced; a single feature registry drives navigation.                                                     |

## Architecture baseline

The finalized AuthorOS architecture: 29 invariants every change must
preserve. **This section is the authoritative definition.** `AGENTS.md`
turns it into implementation rules and `DECISIONS.md` records why
(decisions 103 to 106 adopted it); the sections after this one describe
the mechanisms. "Not built" marks designed parts with no code yet.

1. **Story Object Registry.** Every reusable kind of story object is
   defined once (`story-graph/kinds.ts` plus its adapter), with its
   capabilities and how it takes part in each system. Built (M7).
2. **One source of truth.** One home per concept: no second store, list
   or copy that must be kept in sync. Dates live in calendar entries,
   tasks in one table, history in one layer. Temporary exceptions are
   marked (see Temporary compatibility below).
3. **Story / Plan / Manuscript / Publish are separate domains.** Story =
   what exists (characters, relationships, notes, ideas, later places);
   Plan = what the author intends (structures, beats, arcs); Manuscript =
   the written words (series, books, parts, chapters, scenes and their
   text); Publish = intentional published representations (editions, not
   built). The registry's areas map onto them: `storyBible` = Story,
   `structure` = Plan, `manuscript` = Manuscript. `planning` is the
   author's real-world planner (tasks, events, writing progress), **not**
   the story's Plan; `identity` holds pen names.
4. **Book ≠ Edition.** A Book is the living creative work; an Edition is
   one published manifestation with its own format, identifiers and
   publishing status. A book's writing status never says "Published".
   Editions not built.
5. **Scene is the atomic bridge.** Scenes connect planning (beat
   placements), story data (participation), manuscript text, story time,
   character state, review and revision, through relationships owned by
   those systems. The scene row itself stays lean (title, status,
   synopsis, text): it is not a dumping ground.
6. **Dedicated relationships, then Universal Connections.** A
   relationship whose meaning the product relies on is a first-class table
   (the hierarchy, relationship members, beat placements, Scene
   Participation). Universal Connections (`connections` module) supplement
   them for flexible links.
7. **Domain Actions.** Meaningful changes go through named, authorized
   service functions (`assertCan` first, product rules, Change Impact
   where needed), never generic CRUD over tables. Routes and components
   can't reach the database (ESLint).
8. **AI suggests, the author approves, Domain Actions apply.** AI writes
   only suggestions. Accepting one is an ordinary authorized Domain Action
   that records where the change came from. AI has no database-write
   authority of its own. Not built.
9. **Manuscript safety.** Device-first persistence (a permanent layer,
   decision 101), crash recovery, truthful save status, conflicts kept as
   versions, version history and document format versions. Unsynced text
   on a device belongs to one account (M9). See Author content safety.
10. **History ≠ Provenance ≠ Validity ≠ Change Impact.** Four separate
    capabilities, none implemented through another. History = earlier
    states of the same object (built). Provenance = where something came
    from and what it was derived from (only a revision's `source` today).
    Validity = whether something still holds against what it depends on
    (not built). Change Impact = what a proposed change would affect,
    before it happens (built).
11. **Validity states**, one vocabulary everywhere: **Current, Potentially
    Stale, Conflicted, Invalid, Superseded, Unknown, Intentionally
    Excepted.** A state is an observation shown to the author, never an
    automatic fix. Not built; first use: beat assignments.
12. **Change Impact is universal.** Every system that can move, delete,
    detach or affect connected data produces a report through the shared
    builder (Green automatic, Yellow suggested, Red approval required),
    explains effects factually, and never makes creative decisions. Built
    per operation (M5 to M8).
13. **Provenance and representation lineage.** A derived representation
    (an edition, export, generated file or accepted suggestion) records the
    source and version it came from. Provenance never grants access:
    following lineage still passes the read check. Not built.
14. **Permissions below the UI, for reads and writes.** Every service
    checks the role's grants first (`assertCan` for changes,
    `assertCanView` for reads, M9). Workspace membership alone grants
    nothing. Refusing a specific object looks exactly like it doesn't
    exist. The Story Graph resolver and search are the funnel that
    per-object grants will plug into. See Authorization.
15. **Governance ≠ Permission.** Permission says who may act; governance
    says what must happen whoever acts (reviews, required approvals, safety
    rules). No configuration, role or automation can bypass safety or
    governance (for example the Change Impact review, or keeping a version
    before overwriting). Today's safety rules live in services; no
    separate governance system is built.
16. **Data classification.** Sensitivity, authority, permission,
    validity, provenance and truth are separate properties. A sensitive
    note is not thereby authoritative; **authority is not truth** (an
    authoritative source can be wrong); a record you may read is not
    thereby current. Not built.
17. **One Task system.** Planner, Kanban, Home, Publishing, Marketing and
    Review are views and workflows over the one `tasks` table; there is no
    second task store.
18. **Story Time ≠ real-world time.** Fictional story time is separate
    from the author's planner time, publication dates and version
    timestamps. The calendar and writing progress are real-world time.
    Built (M12, decision 109); see Story Time.
19. **Asset ≠ File.** An Asset is a meaningful reusable object (a cover, a
    map, a reference image); a File is stored bytes representing it, in
    formats and versions. Not built.
20. **Search, Query and Reasoning are distinct and share the data.**
    Search finds; query filters and aggregates; reasoning draws
    conclusions. All read the same Story Graph through the read funnel and
    never become separate copies of the data. Search built (Postgres full
    text).
21. **Findings are evidence-based observations**, carrying their evidence
    and subjects. A finding is never automatically an error and never a
    change. Not built (`auditGraph()` is a developer check, not a
    finding).
22. **Work Context.** Temporary detours never lose the author's place.
    **Back** (browser history), **Return to Work** (the exact place being
    worked on) and **Continue Writing** (the latest writing place, on any
    device) are three distinct behaviours. Built (M10); see Work Context.
23. **Adaptive devices.** Desktop, tablet and phone use the same
    architecture, data and capabilities; only presentation adapts. No
    device-specific data or feature forks.
24. **Portability is foundational.** Workspace export, project export,
    publication export, backup, restore, transfer, migration and cloning
    are distinct operations over one export format and the Import Engine.
    Built: workspace backup and archive, manuscript export, restore and
    copy import.
25. **Publication Boundary.** Changing the manuscript never silently
    changes a published Edition. An edition is a fixed representation
    with lineage, marked Potentially Stale when its source moves on. Not
    built.
26. **Life Planner privacy boundary.** Only explicitly shared task and
    event information crosses into the Life Planner. Connecting the
    systems grants no access to manuscripts, the Story Graph, private
    notes, research, business or legal information, and personal or
    household data never appears in AuthorOS. Enforced in the data and
    permission layers, not by hiding UI. Not built.
27. **Progressive complexity, not a Beginner Mode.** Complexity is revealed
    by context and need (the Romance Center appears for romance arcs).
28. **Genre flexibility.** Genre-specific systems are lenses and
    capabilities over the common model (the Romance Center over generic
    structures), never duplicate genre-specific data models.
29. **Architecture freeze.** New features fit the existing categories:
    object (a registry kind), relationship, assignment, view,
    representation, task, workflow, asset, integration, configuration,
    policy, automation, finding or event. A new architectural review is
    needed only when a capability fits none of them or would break an
    invariant above.

### Decided designs, not built yet

- **Comments are metadata (decision 87)**, never in the manuscript text:
  an anchor outside the document (node, version, position, quoted text and
  context). When the text changes the anchor is re-found or the comment is
  flagged for review, never silently attached to other text.
- **Workspace membership is not access to everything (decision 89).**
  Co-authoring adds per-book, series and pen-name grants through the read
  and write funnel of invariant 14.
- **Beats and Beat Assignments (decision 90).** The beat (definition) is
  separate from where it happens, so one scene can satisfy several
  structures without duplication.

### Temporary compatibility architecture

The "Publication status" book field (created by the M8 migration) is a
stopgap until the Edition/Publishing systems replace it. It is kept for
display, search, export and import only; new features must not build on
it. (`books.tropes`, the other stopgap, was replaced by Trope objects in
M13 and removed.)

## System overview

```
Browser ── React 19 (Server + Client Components), Tailwind CSS
   │
   │  HTTP: page requests, Server Actions, /api/auth/*
   ▼
src/proxy.ts ── optimistic check: session cookie present? else → /sign-in
   │
src/app/** ── routes: transport only (render, parse input, call services)
   │
src/server/context.ts ── Data Access Layer: requireAuthorContext()
   │                     validates the session, resolves the workspace
   ▼
src/modules/<domain>/ ── services: business rules + workspace scoping
   │
src/lib/db.ts ── Prisma Client (driver adapter: node-postgres)
   ▼
PostgreSQL (Neon in production, local Postgres in development)
```

Planned additions, deliberately not built yet:

- **Background jobs** (pg-boss, which runs on the same Postgres): exports,
  statistics, and AI requests. A `src/jobs/` folder holds the workers.
- **Object storage** (Vercel Blob) for cover images and export files.

## Layers and rules

### Routes (`src/app`)

- Route groups: `(auth)` for sign-in pages; `(app)` for the signed-in shell.
- Pages and Server Actions are **transport only**: they parse input (Zod),
  call `requireAuthorContext()`, call a module service, and render.
- Lint rule: code in `src/app` and `src/components` may not import
  `@/lib/db` or the generated Prisma client.

### Modules (`src/modules/<name>`)

Each domain area is a module with the same layout:

```
src/modules/library/
├─ index.ts        # public DOMAIN API: services, schemas, labels (server-safe)
├─ ui.ts           # public UI API: components and Server Actions
├─ service.ts      # business logic; every function takes AuthorContext first
├─ actions.ts      # "use server" actions (thin: context → service → result)
├─ schemas.ts      # Zod input schemas, shared by services and forms
├─ labels.ts       # display labels for enums (client-safe)
└─ components/     # UI owned by this module
```

- **Two entry points.** Other code imports `@/modules/<name>` (domain) or
  `@/modules/<name>/ui` (UI). Anything deeper is a lint error. Inside a
  module, use relative imports. The split keeps services free of UI and
  framework code, so services, tests and future jobs never load React or
  Auth.js just to call a service.
- Services never import from `next/*`, so they run anywhere: tests, jobs,
  scripts, a future public API.
- Modules depend on each other only through public APIs, and only "downward"
  (e.g. `manuscript` may use `books`; `books` must not use `manuscript`).

Current modules:

| Module          | Owns                                                                                                                                      |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `auth`          | Sign-in form and actions (UI only).                                                                                                       |
| `workspaces`    | Personal workspace bootstrap, membership lookup.                                                                                          |
| `pen-names`     | Author identities: create/edit/default/archive/restore, the active identity, the identity switcher.                                       |
| `story-graph`   | Story nodes: creation, permanent deletion, per-kind visibility rules, resolution (title/context/link) and cross-kind search. Kind labels. |
| `connections`   | Universal Connections: the kind registry, connect/update/disconnect, reading a node's connections, the Connections panel and picker.      |
| `library`       | Series and books; pen-name rules for them; series order.                                                                                  |
| `manuscript`    | Parts, chapters, scenes (structure, ordering, moves), scene content and autosave, the binder and editor UI.                               |
| `history`       | Version history for any versioned story object (scenes, notes): checkpoints, named versions, preview, restore; the History dialog.        |
| `structure`     | Beat templates, outlines (plot, romance arc, character arc, subplot, custom), beats and their scene assignments; the beat board.          |
| `fields`        | Author-defined custom fields for any node kind, scoped to a pen name (default), all identities, a series or a book.                       |
| `impact`        | Change Impact: "What will this affect?" reports and reviewed apply, for identity moves of books and series; the review dialog.            |
| `tasks`         | Tasks (story nodes) with priority and due dates; what they concern is `concerns` connections.                                             |
| `calendar`      | Calendar events (story nodes) and the merged calendar: events, task due dates, book deadlines, words per day.                             |
| `search`        | Global search: full-text over scenes, notes, ideas and characters; titles of everything else; follows "Writing as".                       |
| `exports`       | Manuscript exports (DOCX, Markdown) and the structured workspace JSON backup with its integrity check; the export wizard.                 |
| `progress`      | Words written per day (automatic from scene saves, plus logged), daily goal, streak, book deadline pace, the author's time zone.          |
| `characters`    | Characters (each of one pen name, optionally one series), profile fields, the scene cast (appearances are connections).                   |
| `relationships` | Relationships between two or more characters (pairs and groups), their members, and the dynamics within a group.                          |
| `notes`         | Notes with rich text; what they're about is connections.                                                                                  |
| `ideas`         | Quick capture; promotion to a book.                                                                                                       |
| `trash`         | Listing, restoring and permanently deleting trashed story objects of every type.                                                          |

Dependency direction (domain): `calendar` → `tasks`, `progress`, `library`;
`tasks` → `connections`; `impact` → `pen-names`; `fields` → `library`,
`pen-names`; `manuscript` → `progress` → `library`; `structure` → `characters`,
`relationships`, `library`, `manuscript`; `ideas` → `library`, `connections`;
`notes`, `manuscript` → `history`;
`characters`, `relationships`, `trash`, `fields`, `connections`, `history` →
`story-graph`; `manuscript` → `library` → `pen-names` → `workspaces`. Pages compose modules; modules never import a page.
`story-graph` is the bottom of the story layer and knows every typed table.

**Server-only guard.** Every service file imports `server-only`, so a client
component that reaches a domain entry fails the build with an explicit
error instead of shipping database code to the browser. Client components
use `ui` entries, which hold only components, actions and client-safe
constants (labels, the connection registry).

### Server Actions

- Every action body runs through `runAction()` (`src/server/action.ts`): it
  returns `{ ok: true, data }` or `{ ok: false, error, code }` for validation
  and domain errors (`lib/errors.ts`), and refreshes the current route on
  success. Unexpected errors propagate.
- **Actions called from event handlers never `redirect()`.** A redirecting
  action's promise never resolves, which stalls the client transition that
  awaits it. Actions return ids; the client navigates (`router.push`).
- Autosave opts out of the refresh so the editor is never re-rendered under
  the author.

### Infrastructure (`src/lib`, `src/server`, `src/config`)

| Path                   | Purpose                                                              |
| ---------------------- | -------------------------------------------------------------------- |
| `lib/db.ts`            | Prisma Client singleton (node-postgres driver adapter).              |
| `lib/env.ts`           | Validated server configuration (Zod).                                |
| `lib/auth/`            | Auth.js configuration, magic-link mailer, callback-URL safety.       |
| `server/context.ts`    | The Data Access Layer: `getSessionUser()`, `requireAuthorContext()`. |
| `config/navigation.ts` | Feature registry: sidebar, placeholder pages and dashboard read it.  |
| `components/ui`        | Design-system primitives (shadcn/ui conventions).                    |
| `components/shell`     | App shell: sidebar, mobile nav, page header.                         |

## Authentication

- **Auth.js v5** with the Prisma adapter and **database sessions**. Sessions
  are rows in `sessions`, so they can be revoked server-side and listed per
  device later.
- **Providers:** email magic link (sent with Resend) and Google. Google is
  enabled only when its credentials are configured.
- **Account linking:** Google accounts link to an existing user with the same
  email address (both methods prove ownership of the address).
- **First sign-in:** the `createUser` event calls
  `ensurePersonalWorkspace()`, which creates a workspace, an OWNER
  membership, and a default pen name. The function is idempotent and guarded
  by a per-user advisory lock. The DAL calls it as well, so a user can never
  end up without a workspace.
- **Development email:** without a Resend key, sign-in links are printed to
  the console and appended to `.dev-mail/outbox.jsonl` (end-to-end tests
  read them from there). This is refused on Vercel.

## Authorization

Following Next.js 16 guidance, checks happen close to the data, not in layouts:

1. `src/proxy.ts`: an optimistic redirect when no session cookie exists. It
   never queries the database.
2. `requireAuthorContext()` (memoized per request): validates the session
   against the database and returns `{ userId, workspaceId, role }`. Every
   page, action and route handler that touches author data calls it.
3. Services scope every query by `ctx.workspaceId`. A service function must
   never accept a raw `workspaceId` from user input.

Layouts fetch the user only to render the shell (layouts don't re-run on
client navigation, so they can't be the security boundary).

4. **Policy (M7).** Every service that changes author data calls
   `assertCan(ctx, action, area)` (`src/server/policy.ts`) as its first
   statement, so no route, page, action or future API can skip it. A test
   (`tests/integration/authorization.test.ts`) calls every exported write
   service of every module as a viewer and requires a refusal before
   anything happens; a new write service fails the build until it checks.

**Roles and grants.** Actions are `view`, `comment`, `suggest`, `edit` and
`manage`; areas are the registry's (`identity`, `manuscript`, `storyBible`,
`structure`, `planning`) plus `workspace`. `manage` covers workspace-level
and irreversible operations: pen names, deleting forever, emptying the
Trash, imports, the JSON backup, identity moves, deleting shared
definitions (fields, templates).

| Role   | Grants                                                                                  |
| ------ | --------------------------------------------------------------------------------------- |
| OWNER  | everything                                                                              |
| EDITOR | view, comment, suggest, edit in every story area; view pen names and workspace settings |
| VIEWER | view                                                                                    |

5. **Reads (M9).** Every service that returns author data calls
   `assertCanView(ctx, area, resource?)` first: the same grants, the
   `view` action. Workspace membership alone grants nothing (a role
   without `view` sees nothing, and an unknown role fails closed). A
   refused read of a named object throws the same "not found" as a
   missing id, so a refusal never reveals that the object exists; a
   refused list or search is forbidden. The Story Graph funnel
   (`viewableKinds`, used by `resolveNodes`, `searchNodes`, `nodeKind`,
   search, connections, backlinks and the Trash) drops whatever the
   context may not view. `tests/integration/read-authorization.test.ts`
   calls every exported read service with a context that may not view and
   requires a refusal, so a new read service can't skip the check.

Members are owners today. Co-authors, editors, beta readers and ARC
readers join by granting, not by changing services: `can()` already takes a
resource (`{ kind, id }`), every read and write passes through it, and
per-book grants plug into the policy and the Story Graph funnel. Personal
preferences (Writing as, daily goal, time zone) need no role.

**Collaboration direction.** Comments, suggestions, controlled edits with
review, and granular permissions, on the current storage model (whole
ProseMirror documents with optimistic versions). Live co-editing would need
a different text-storage architecture (a CRDT per document) and is only
introduced as an explicit product decision.

## Multi-tenancy and identities

```
User ──< WorkspaceMember >── Workspace ──< PenName
                                  │
                                  └──< (all domain data: series, books, …)
```

- **Workspace** is the ownership boundary for all author data.
- The MVP gives each user one personal workspace and shows no workspace UI.
  The "primary membership" rule in `findPrimaryMembership()` is the single
  place a workspace switcher would replace.
- **Pen names** belong to the workspace; series, books and characters
  reference one (see Author identities below). Identities are private from
  each other by default; notes and ideas are shared workspace material.

## Author identities (pen names)

- A workspace has one or more **pen names**; exactly one is the default
  (database-enforced). Every series and book belongs to exactly one pen name.
- **Books in a series always use the series' pen name.** A book's own pen
  name applies only when it is standalone, and it joins only series of its
  own pen name. (Per-edition overrides arrive with Publishing in v1.1.)
- **Changing a pen name is a reviewed change (M4).** Moving a standalone
  book or a series to another pen name goes through Change Impact (below):
  never as a side effect of editing details.
- **Archive, don't delete.** Archived pen names disappear from pickers and
  the switcher; their work keeps its attribution. The default can't be
  archived.
- **Active identity** ("Writing as", sidebar): stored per member
  (`workspace_members.active_pen_name_id`), carried in `AuthorContext`. It
  narrows the Library and dashboard and is the pen name for new work. "All
  identities" (null) shows everything, grouped by pen name. The Pen names page
  is the All Identities view: every identity with its series and books.
- **Identity separation (M3).** Characters belong to one pen name (and
  optionally one of its series, appearing in any of its books). "Writing as"
  narrows characters, relationships, structures and pickers to that identity;
  "All identities" shows everything. Nothing links across identities: the
  connection service refuses it, relationships and outlines require one
  identity, and a linked character can't change pen name on its own. Notes,
  ideas, tasks and events have no pen name (author-level, shared) and may
  link to anything; capturing them never asks for an identity. **Extension
  point (notes and ideas):** an optional scope (all identities, a pen name, a
  series, a book) would be nullable columns on those tables; the resolver
  already derives each object's identity per kind, so a scoped note would
  report its scope's pen name and every identity rule (`sameIdentity()`,
  pickers, Change Impact) would apply to it unchanged. **Extension point:** a
  future "shared resource" (e.g. a world bible used by two pen names) would be
  an explicit opt-in, modeled as a null/shared identity on that object, which
  `sameIdentity()` already treats as linkable.

## Manuscript

**Structure: Book → (Part) → Chapter → Scene.** Parts are optional. A book's
top level is an ordered mix of parts and part-less chapters sharing one
position space (e.g. Prologue · Part One · Part Two · Epilogue). "Remove
part, keep chapters" dissolves a part in place.

**Ordering.** Fractional-index keys (`lib/ordering.ts`) in `COLLATE "C"`
columns: a move rewrites one row (siblings are re-keyed only in the rare
case of a key collision). Creating structure locks the parent row, so
concurrent adds (double clicks, two tabs) get distinct positions and default
titles ("Chapter 3", "Scene 2").

**Binder.** Drag-and-drop (mouse, touch, keyboard) reorders within a list;
"Move to…" moves a scene to another chapter or a chapter into/out of a part.
Screen-reader announcements name items by title.

**Editor.** Tiptap (ProseMirror). Scene content is ProseMirror JSON plus a
server-derived plain-text column (search, word counts); the server validates
the document shape and size.

**Autosave and conflicts.** Text goes to this device first (a local draft,
M8: see Author content safety), then the editor saves to the cloud ~1 s
after typing stops (and on blur and Ctrl/Cmd+S), one save in flight at a
time, retrying on failure.
Every save carries the version it was based on; the server row-locks the
scene and refuses a stale version. The editor then stops and asks the author
to reload: **edits made elsewhere are never silently overwritten.** Leaving
with unsaved text triggers the browser's warning.

**Revisions** (`history` module, shared by scenes and notes). Before content
is overwritten, the previous content is checkpointed if the last revision is
older than 10 minutes. Authors can also save named versions. Restoring first
saves the current text as a "before restore" revision, so restores are
always undoable. History lives in one `content_revisions` table keyed by
node; a new versioned kind adds one accessor in `history/versioned.ts`.

**Trash.** Series, books, parts, chapters and scenes are soft-deleted. The
Trash lists the topmost trashed item of each branch; restoring brings back
its contents (except things trashed separately). "Delete forever" removes
the item, its descendants and their revisions.

## Tropes (M13)

A trope (decision 110) is a shared story object (`TROPE`, story-bible
area, not owned by a pen name): a name and an optional description. Books,
series, relationships and structures use tropes through `uses_trope`
Universal Connections, the only link store. Names are unique among a
workspace's live tropes, ignoring case and surrounding spaces; asking for
an existing name gives the existing trope (no fuzzy matching, aliases or
merging). The common list (`tropes/suggestions.ts`) is suggestions in code;
choosing one creates the author's trope. Tropes are always the author's
statement, never inferred from text.

**Actions:** `createTrope`, `updateTrope` (stale forms refused; description
history), `trashTrope`, `restoreTrope` (refused while the name is taken),
`deleteTropeForever` (the reviewed Trash path, Red), `addTrope` (by trope
or by name), `removeTrope` — story-bible edit rights; delete forever needs
workspace management, as for every object. **Reads:** `listTropes`,
`getTrope` ("Used in" through the read funnel: nothing hidden is named),
`tropesOf`. Books and series have a chip picker; relationships and
structures use the Connect panel. Names have no history (no story object
keeps title history); descriptions do.

## Story Time (M12)

The story's own chronology (decision 109), separate from reading order (the
binder) and from real-world time. Owned by the `timeline` module.

| Piece               | What it is                                                                                        |
| ------------------- | ------------------------------------------------------------------------------------------------- |
| **Timeline**        | A standalone book's, or its series' when the book is in one. Derived from the book; never stored. |
| **Scene placement** | `scene_story_times`: one point per scene (position + free-form label). No row = not placed yet.   |
| **Timeline event**  | `TIMELINE_EVENT`, a story object owned by a book or series, placed on the same timeline.          |

**Order** uses fractional positions (`lib/ordering`); scenes and events of a
timeline share one ordering space. **Labels** are the author's words ("Day
3, evening", "Unknown"), never dates: no calendars, arithmetic or ages.
Nothing is placed automatically or inferred from the text, and nothing in
Story Time changes reading order or manuscript text (or the reverse).

**Actions:** `placeSceneInTime` (place or move after a scene or event; null
= first), `setStoryTimeLabel` (refused if the label changed since the
author saw it), `removeSceneFromTime` — manuscript edit rights, each kept in
the scene's Story History (field `storyTime`). `createTimelineEvent`,
`updateTimelineEvent` (description history, stale forms refused),
`moveTimelineEvent`, `trashTimelineEvent` — story-bible edit rights.
**Reads:** `listTimelines`, `getTimeline` (story order, the scenes not
placed yet in reading order, optional character filter through Scene
Participation), `getSceneStoryTime`, `getTimelineEvent`, all through the
Story Graph funnel: a manuscript-only reader sees scenes, not events;
anything in the Trash is left out and comes back where it was.

**Change Impact:** moving a book into or out of a series changes its
timeline — Red, listed in the series-change review and applied only with
the author's approval (joining: after the series' items, in their own
order; leaving: same order, series events stay). Delete forever reports
"Places in Story Time" and the timeline events that go. The UI is the
same on desktop and phone: the scene's "Story time" line, and the
Timeline page (drag on desktop; Earlier / Later and "Place" everywhere).

## Scene Participation (M11)

A character's relationship to a scene (decisions 106, 108) is a dedicated
relationship, not a Universal Connection: `scene_participations`, one row
per scene and character, owned by the `participation` module.

| Part in the scene | Means                                    | Rule                                      |
| ----------------- | ---------------------------------------- | ----------------------------------------- |
| **Present**       | in the scene                             | either Present or Mentioned               |
| **Mentioned**     | talked or thought about, not there       | never implies Present                     |
| **Point of view** | the scene is told from them (+ presence) | at most one per scene (index and service) |

**Actions** (each checks edit rights on the manuscript first and keeps the
change in the scene's Story History): `addParticipant`,
`addNewCharacterToScene` (checks the POV rule before creating anyone),
`updateParticipant` (presence, taking or giving up the POV; taking it
while someone else has it is refused), `setPointOfView` (the explicit
change: names the POV the author saw; the previous holder stays as they
were), `removeParticipant`. Nothing here reads or writes manuscript text,
and participation is never inferred from it (future AI suggestions would
be findings for the author to review).

**Reads** go through the Story Graph funnel: `listParticipants` (a scene's
characters, POV first) and `listCharacterScenes` (a character's scenes in
manuscript order, optionally by part). A character or scene in the Trash,
or not viewable, is left out and never named, history included; it comes
back when restored. Search takes `participant: { characterId, role }`
(the search page's `?character=…&role=pov|present|mentioned`), so "scenes
where Charlie is POV" is the existing search, not a second one.

**Elsewhere:** identity moves follow participation like links; deleting
forever reports "Characters in scenes"; the integrity audit checks pen
names, series and one POV per scene; export format 4 carries it and
imports upgrade `appears_in` connections from older files. The UI is one
component (`SceneParticipants`) for desktop and phone: the point of view
on its own line, then chips (dashed for Mentioned) with a menu per
character, and "Changes" for the history.

## Work Context (M10)

Work Context is temporary working state, not story data: where the author
is working, so a detour never loses their place. It is never exported,
never undoes anything (changes made during a detour stay), and never
authorizes anything.

| Behaviour            | Means                                                       | Kept in                                           | Survives                                                |
| -------------------- | ----------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------- |
| **Back**             | the previous page                                           | the browser's own history                         | as the browser keeps it                                 |
| **Return to Work**   | the place being worked on before this detour, from anywhere | this tab (`sessionStorage`), owned by one account | navigation and refresh in this tab; cleared at sign-out |
| **Continue Writing** | the latest manuscript writing place                         | the member's row (`workspace_members.writing_*`)  | devices, sign-out and sign-in                           |

**The work stack** (`lib/work-place.ts`). Opening a document that is in
the stack returns to it (detours above it are finished). With an empty
stack, the opened document becomes the work. Only _looking_ at another
scene or note is a detour; _writing_ in another scene moves the work on,
and writing in a note during a detour nests it: Return to Work goes to the
note, and from the note to the scene before it. The control ("Return to
work", sidebar and phone header) shows only while away; its title comes
from the server through the read funnel (`listWorkPlaces`), so a place
that is gone or no longer viewable is dropped without being named.

**Version-aware positions.** A place is the document version, the cursor
position, the 40 characters either side of it, and the page scroll. It is
restored only when coming back through Return to Work or Continue
Writing, after any device draft is recovered. Same text at the same
position: restored (with the same scroll if the version is unchanged).
Text on both sides found exactly once elsewhere: the cursor goes there.
One side only: the nearest place, and the author is told it may not be
exact. Neither: the start of the document and a note that the place
couldn't be found. A position is never invented. Scroll is not carried
across devices.

**Continue Writing** (dashboard, "Where you left off"): the scene editor
records the place on the server when it opens and a few seconds after the
cursor or scroll moves (`setWritingPlace`, the member's own state, only
for a scene they can view; never after signing out on the device). If the
place is gone or no longer viewable, the most recent scene is offered
instead, without saying why.

## Author content safety (M8)

Protecting the author's work comes before features. Four layers, each
honest about where the text is:

1. **This device, immediately.** The editor writes the document to
   IndexedDB (`lib/local-drafts.ts`, keyed by account and document) about
   150 ms after each change, with the version it was based on. The draft is
   deleted only when the cloud has exactly that text. On open, a newer draft
   on the same version is restored ("Recovered from this device"); a draft
   based on an older version is kept as a separate version ("From this
   device, not synced"), never merged or dropped. Without IndexedDB the
   status says so.
2. **The cloud, in the background.** Autosave as above. Offline, writing
   continues and the status reads "Saved on this device · offline, will
   sync"; it syncs when the connection returns. The status never says
   "saved" for text only this device has (`data-state` / `data-device` on
   the status element).
3. **Version snapshots.** Checkpoints every 10 minutes of editing, plus a
   **large-edit checkpoint** (`BEFORE_LARGE_EDIT`) before any save that
   removes ≥ 200 words or ≥ 20 % of a document of at least 50 words
   (pasting over, select-all delete). Named versions; restore keeps the
   current text first.
4. **Field history** for long-form text that isn't a document: scene
   synopses, character summaries and profile fields, descriptions (books,
   series, relationships, events), idea bodies, task notes, pen-name bios
   and beat descriptions. Every edit, restore and import that replaces a
   non-empty value keeps the old one (`history/fields.ts`, same
   transaction). "Earlier versions" on each page lists and restores them.

**Device drafts belong to one account (M9).** A draft is owned by the
signed-in member (user and workspace, `draftOwner(ctx)`) and only read
back for that member, so another account signing in on the same browser
never sees or inherits it. Signing out never deletes unsynced writing: the
sign-out button first checks this member's drafts and, if any exist,
explains that the writing is only on this device, lists it with links, and
offers **Stay signed in** (open each item while online and it syncs) or
**Sign out anyway** (the drafts stay on this device for this account and
come back after signing in again). Drafts saved before M9 (no owner) are
adopted by the member who opens that document, which the server only
allows for an account that can open it.

**Signing out works offline.** The Auth.js session cookie is httpOnly, so
a page can't remove it and the normal sign-out needs the server. Sign out
anyway (and any sign-out while offline) therefore sets a
`authoros-signed-out` cookie in the browser at once
(`lib/auth/signed-out-here.ts`): the editor stops sending anything, a
full-screen notice says the writing is kept only on this device, and
nothing for the account is usable. On the very next request the proxy
sends the browser to `/sign-out`, which ends the session on the server,
clears the mark and shows sign-in; until then the session lookup treats
the mark as signed out. The mark can only remove access, and `/sign-out`
does nothing without it.

**Stale-edit protection for metadata.** Documents use versions; metadata
forms send the `updatedAt` they opened with (`lib/concurrency.ts`). The
service reads the row, refuses a changed one, and writes with `updatedAt`
in the WHERE clause, so two tabs can't overwrite each other silently; the
form keeps the author's input. Single fields edited in place (profile
fields, scene synopsis) are guarded by the value the author started from.
Actions that change an object in several steps check the guard once, first.

**Document format versions.** Scene and note documents carry a format
number (`CURRENT_DOC_FORMAT`); `upgradeDoc()` brings older documents
forward when read, so the editor never sees an old shape, and imports
refuse documents from a newer app. Revisions store the format they were
saved with.

**Towards local-first.** The local draft is the first copy and the server
the shared one; versions are explicit (`baseVersion`). A later
offline-first editor can extend the same draft store into a queue of
changes without changing the server contract.

**The device buffer is a safety layer, not a leftover (decision 101).** The
current IndexedDB buffer is not the final offline/sync architecture. It is
the safety net and the foundation that architecture will grow from. Working
cloud autosave is **not** a reason to remove, skip or bypass it. Every
editor of long-form text writes to the device first, and deletes the local
copy only once the cloud has exactly that text. Recovery and conflict
preservation stay in place. A future sync engine replaces the buffer only
with something that gives at least the same guarantees.

## Known deferred risks (M8)

These are known, accepted and intentionally deferred, not open blockers
(decision 102). Each has a reason it is safe for now and the change that
would close it. Revisit them when the related feature is built.

| Risk                                     | Why it is acceptable now                                                                                                            | Closed by                                                                                       |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Field-history restore has no stale check | Restoring keeps the current value first, so nothing is lost; at worst a restore overrides a newer edit, which is itself restorable. | Passing the value the author saw to `restoreFieldValue()` and refusing if it changed.           |
| Direct title edits and drag/reorder      | No stale check; titles are short and visible, reorders are reversible and rewrite one position key.                                 | Guards on inline renames and moves when collaboration (several editors) arrives.                |
| Browser storage unavailable or cleared   | Only unsynced text is at risk; the status says when this device can't keep a copy ("unavailable"), and cloud autosave still runs.   | The offline-first sync architecture (persistent storage request, sync queue).                   |
| Gradual deletion across many saves       | Each small save is below the large-edit threshold; 10-minute checkpoints and named versions still capture earlier text.             | A cumulative-removal check against the last snapshot.                                           |
| Unlimited history retention              | Text history is small next to its value; nothing is pruned, so nothing is lost.                                                     | A retention rule (thinning old autosave checkpoints, never named versions) with storage limits. |
| Temporary publication field              | A compatibility stopgap, marked temporary (decision 91); nothing new may build on it. (Tropes: closed in M13, decision 110.)        | The Edition/Publishing systems, which migrate and remove it.                                    |
| Few Yellow Change Impact suggestions     | The mechanism is general (report groups with `level: "suggested"`); two suggestions exist.                                          | Adding suggestions to other reports as features need them.                                      |

## Story Graph and Universal Connections

**Identity.** Every story object (pen name, series, book, part, chapter,
scene, character, relationship, structure, note, idea, task, event) has a
row in `story_nodes`, and its typed row uses that id as its primary key,
enforced by a composite foreign key and a kind-checking trigger. A trigger
deletes the node when the typed row is deleted. Pen names joined in M7, so
they can be connected like any object (a marketing task concerns a pen
name; a note is about it); they are archived, never trashed.

**The Story Object Registry (M7)** is the authoritative definition of every
kind (`story-graph/kinds.ts`, client-safe): display names, area
(authorization), identity rule (own column, via its book, via its members,
via its owner, itself, or shared), place in the structural hierarchy,
whether it owns structures or is placed on beats, connectable, custom-field
eligible, searched by text or title, versioned, Trash or archive lifecycle,
whether it moves with its identity (Change Impact), whether it can have
dates, its table and its key in the export/import bundle. Its server half
(`story-graph/adapters.ts`) has one adapter per kind: the loader (visible
objects, by ids, title or identity) and the Trash operations (list, check,
restore). Both are typed `Record<StoryNodeKind, …>`, so a missing kind is a
compile error. The resolver, pickers, Trash, search, connections, custom
fields, Change Impact, authorization, export, integrity check and import
read the registry instead of keeping their own lists.

**Structure stays explicit.** Book → Part → Chapter → Scene, a series' books,
a relationship's members and a book's pen name are dedicated foreign
keys: fixed, typed, cascading, and queried constantly.

**Associations are connections.** Everything flexible is a row in
`connections` between two nodes: character ↔ scene appearances (with a
role), notes about anything, relationship moments in scenes, what an idea
inspired, and free "related to" links. Tasks (M4), inspiration, research,
songs, plot threads and locations will use the same table.

**The registry** (`modules/connections/registry.ts`, client-safe) defines each
kind: allowed source and target node kinds (or any), how it reads from each
end ("Develops in" / "Relationship moments"), whether it is directed, and
an optional single-choice attribute. Characters in scenes are not a
connection kind: they are Scene Participation (M11). The service validates every
connection against it; the UI builds the "Connect" picker from it.

| Kind          | From → To                                  | Reads as                           | Attribute |
| ------------- | ------------------------------------------ | ---------------------------------- | --------- |
| `develops_in` | Relationship → Scene                       | Develops in / Relationship moments |           |
| `about`       | Note → any                                 | About / Notes                      |           |
| `inspired`    | Idea → any                                 | Inspired / Inspired by             |           |
| `concerns`    | Task/Event → any                           | Concerns / Tasks & dates           |           |
| `uses_trope`  | Book/Series/Relationship/Structure → Trope | Tropes / Used in                   |           |
| `related`     | any ↔ any (undirected)                     | Related to                         |           |

**Resolution.** `story-graph/resolve.ts` turns node ids into summaries
(kind, title, context, link) with the registry's adapter per kind, each
applying that kind's visibility rule (`story-graph/visibility.ts`: nothing trashed, nothing
inside something trashed). Connections to hidden objects are skipped, not
deleted, so restoring brings them back. The same loaders power cross-kind
search for the picker.

**Adding a new object type** (e.g. a timeline event or a location): the
enum value; its table with the two node triggers; one registry entry; one
adapter (load, Trash); its bundle columns (export, `imports/bundle.ts`,
plan/apply). TypeScript flags every missing piece; the integrity test
(below) then checks it is found, searched, connected, exported, imported,
trashed, restored and deleted with Change Impact. The Connections panel,
picker, Trash, search and backlinks work without new UI.

**Integrity audit (M7).** `auditGraph(ctx)` (`story-graph/audit.ts`,
read-only) checks a workspace for what foreign keys can't express: nodes
without their row, connections across pen names, series characters
appearing outside their series, books or characters in a series of another
pen name, relationships joining pen names, structure owners of another pen
name, series beats planned for books outside the series, scenes placed on
beats outside their structure, field values on the wrong kind, deadlines
on objects that can't have dates, relationships with fewer than two
members. `tests/integration/story-graph-integrity.test.ts` runs every kind
in the registry through every capability it claims and requires a clean
audit after each.

**Four separate concepts.** (1) _Story objects_ are nodes. (2) _Structural
objects_ are the manuscript tree (Book → Part → Chapter → Scene, explicit
FKs). (3) _Structure/beat assignments_ place outline beats in scenes
(`beat_scenes`, below). (4) _Universal connections_ are flexible links. They
are never merged: a beat is not a connection, and a scene is never copied.

## Story structure

An **outline** is a structure applied to one book: plot, romance arc (owned
by a relationship), character arc (owned by a character), subplot or custom.
It is a story node, so notes and links attach to it, and it goes to the
Trash like anything else. Creating one from a **template** (five built-ins,
seeded; workspace templates use the same table) copies its beats, which are
then the author's to rename, reorder, add or remove.

**Beat assignments are structure, not connections.** `beat_scenes` is a
dedicated many-to-many table: one beat may span several scenes, and one
scene may carry beats of the plot, a romance arc, a character arc and a
subplot at once. The scene is the single underlying row in every case. The
beat board shows each beat's scenes in reading order with where they fall
in the book (%), against the beat's target %, and flags unplaced beats. The
scene editor shows every beat the scene carries, across structures.

**Series structures (M4).** An outline belongs to exactly one book _or_ one
series (database CHECK). A series structure, such as a series-long romance
arc, spans every book of the series: each beat may be **planned for a book**
(`outline_beats.book_id`, grouping only) and placed in scenes of any of the
series' books. The beat board shows the whole series or one book at a time;
every book page lists its own structures and its series' structures. This is
the same structure/beat architecture, not a separate romance system.

**Series Romance Center** (`/library/series/[id]/romance`) shows every
romance arc of a series grouped by relationship, as a progression book by
book: a beat appears under the books its scenes are in, or else its planned
book. Arcs carry a couple role (main or secondary). Any number of
relationships is shown, so secondary couples, love triangles and
multi-partner romances (as their pairwise relationships) appear side by side.
Group relationships (a Why Choose romance, a triangle) show as one row with
their own arc, alongside any pairs within the group.

**Templates.** "Save as template" copies a structure's beats (and, for a
series structure, each beat's book number) into a workspace template.
Applying a template creates a new structure with new beats; templates and
structures never share beat records or scene placements, so editing either
never changes the other. Series templates plan beats onto the matching books
of the series they're applied to. _Extension point:_ template kits (a main
plot, romance and character arcs applied together) would group templates;
the copy-on-apply rule stays.

## Custom fields

`fields` lets authors define their own fields ("Love language", "Magic type")
for any node kind. A field's scope is the **current pen name** (the default:
pen names often write different genres), all pen names, one series, or one
book. A field applies to an object in that scope: characters are in their
pen name and series, and in the books whose scenes they appear in. Values
attach to story nodes, so new object types get custom fields with no schema
change. Characters show them today; other kinds only need the section added.

**Core fields vs custom fields (M8).** A character's core fields (name,
role, summary and the profile: age, occupation, appearance, personality,
backstory, goal, motivation, inner conflict, voice) are fixed and named in
one place (`CORE_CHARACTER_FIELD_LABELS`). Custom fields add to them; a
custom field can't take a core field's name, so there are never two
competing "Goal" fields.

## Change Impact

Meaningful changes that affect connected story data are previewed before
they happen. A service produces an **impact report**: the affected objects,
grouped by kind with what happens to each, plus **blockers** (things that
must be resolved first), and a **token** that fingerprints the report. The
UI ("What will this affect?") offers **Move everything**, **Review changes**
(every affected item, linked) and **Cancel**. Applying recomputes the plan
under a row lock and refuses if the token no longer matches, so the author
only ever applies what they reviewed. Nothing is moved silently or orphaned.

**Levels (M8).** Every report has a level:

- **Green**: automatic, factual propagation (e.g. a scene's word count);
  no review.
- **Yellow**: a **suggested consequence** the author may accept or ignore,
  one by one ("Keep the beat's description as a note", "Also move notes
  and tasks that are only about this book to the Trash"). Ignored unless
  accepted; `assertReviewed(report, token, accepted)` validates the
  accepted keys against the reviewed report.
- **Red**: the change affects other data and needs the author's approval
  before it happens (the reviewed token), or is blocked.

**Presentation is factual, not alarming:** a one-line summary with concrete
counts ("This will affect 7 items: 3 characters, 2 relationships, 1 romance
arc, 1 note."), then each group with what happens to it; groups that stay
as they are (shared notes, a series' characters) are listed as such, not
counted. Reports are built with one helper (`impact/report.ts`) so every
module produces the same shape; the UI is one dialog (`ImpactDialog`).

Uses so far:

- **Moving to another pen name** (book or series): below.
- **Deleting forever / emptying the Trash:** everything removed with the
  item (contents, dependent relationships and arcs, version history, beat
  placements, custom fields limited to that work), links to items that stay,
  and what stays (a series' characters, words-written history).
- **Deleting a custom field in use:** each item with a value, the value
  that will be lost, and how many.
- **Deleting a template:** kits that include it; structures made from it
  are listed as unchanged (applied templates are independent copies).
- **A book leaving or changing series (M7):** beats of the old series'
  structures planned for the book (they stay in the arc, unplanned) and
  placements of the book's scenes on those beats (removed; the scenes
  stay). Series characters appearing in the book's scenes block it. Joining
  a series affects nothing and needs no review.
- **Removing relationship members (M7):** the members removed, with the
  roles that go, and the relationship's structures, which continue as the
  arc of the remaining members. Adding members needs no review.
- **Removing a beat (M7):** the scenes placed on it (placements go, scenes
  stay).
- **Removing a part, keeping its chapters (M7):** the chapters (moved to
  the book's top level) and what is attached to the part itself (links,
  field values, dates), via the shared `attachmentsOf()`.

**Never silently (M7).** Applying goes through `assertReviewed(report,
token)`: refused while there are blockers; refused without a review when
the change affects anything, whichever path calls the service; refused
when stale. A change that affects nothing applies directly.

Audited and left as they are (M7): moving to the Trash and restoring
(reversible); archiving a pen name (hides it from choices, work stays);
moving chapters and scenes (only within their book); removing a single
link, a deadline or a placement (the explicit action is the change);
restoring a version (the current text is saved first); renaming; kit and
template edits (never touch structures made from them); imports (their own
review). Changing a character's series is refused while they appear in
scenes outside the new series, with the count.

First use: **identity moves.** Moving a standalone book (or a series, with
all its books) to another pen name carries its associated story data: its
manuscript and structures; every character of the old pen name connected to
it (appearing in its scenes, owning its arcs, in a relationship with such a
character, or linked to it, transitively; a series' own characters always);
their relationships; and values of fields limited to the old pen name (the
field is copied to the new pen name). Shared notes, ideas, tasks and events
keep their links. If anything of the old pen name that belongs to other work
is linked in (another book's scene, a character of another series), the move
is blocked and the report says what and why.

## Group relationships (M5)

A relationship has **two or more members** (`relationship_members`), so a
couple, a love triangle, a Why Choose/reverse-harem romance and a family
are the same kind of object. One relationship exists per exact set of
members (`member_key`: the sorted member ids, unique; a deferred database
trigger checks at commit that every relationship has at least two members
and that its key matches them). The dynamics **within** a group are
relationships of their own: Elara ↔ Kael, Elara ↔ Rowan and Kael ↔ Rowan can
each develop differently, with their own scenes, notes, arcs and (later)
timeline events, next to the group's own romance arc. A group page lists its
pairs (with "Add" for missing ones); a pair page says which groups include
it. Members can be changed later (at least two, one pen name). Deleting a
character forever ends every relationship they belong to (a database
trigger), as with pairs before; trashing a member hides the relationship
until they are restored.

**Member roles (M6).** Each membership can carry an optional role
(`relationship_members.role`: Heroine, Hero, FMC, MMC, Love interest,
Rival, Partner, Ex, Family member, Other, or anything typed, up to 60
characters). A role belongs to the membership, never to the character:
Elara can be the Heroine of one romance and the Rival in another. Roles are
edited in the Members dialog, shown on the relationship page and in the
Series Romance Center, kept when members change, and exported and imported.

## Dates: one model (M7)

Dates live in one place: calendar entries (`calendar_events`, story nodes).
An entry is an event of its own (`purpose: EVENT`) or a date that belongs to
another story object (`DEADLINE`, with `subject_id`; one live deadline per
object, database-checked). A book's draft deadline is the book's DEADLINE
entry, never a column on the book: the book page, the book dialog, the
calendar, the dashboard pace and exports read the same row
(`calendar.setDeadline` / `deadlinesFor`). Tasks are planner items whose
due date is their own. Screens are views: the calendar merges entries,
tasks and words per day; a deadline shows as its object ("Ember due") and
follows "Writing as". Which kinds can have dates is the registry's `dated`
(books, series, pen names now; editions and publishing milestones later).
A deadline goes with its object (deleting the book deletes it; trashing it
hides it). Recurrence and times with zones belong to the Planner / Life
Planner roadmap; the model takes them as new columns, not a new table.

## Planning: tasks, calendar and progress

- **Tasks** and **calendar events** are story nodes (author-level, like
  notes): what they're for is `concerns` connections, so any story object
  shows its tasks and dates in its Connections panel, and "New task" is
  offered on books and scenes.
- **The calendar** merges events, task due dates, book deadlines
  (`books.due_on`, filtered by "Writing as") and words written per day. Month
  grid on wider screens, a list of busy days on phones.
- **Words written** are recorded automatically: each scene save adds its
  change in words to one row per author, book and day, in the save's
  transaction (database-unique, atomic under concurrent saves). Restores
  don't count. Authors can also log words written elsewhere. "Today" is the
  author's own day (`users.time_zone`, detected from the browser once,
  changeable in Settings).
- **The dashboard** shows words today against the daily goal, the streak,
  the last 30 days, the next 7 days, and each book's pace toward its target
  and deadline.

**Shared editor.** `components/editor/rich-text-editor.tsx` provides
autosave, Ctrl/Cmd+S, the leave-page warning and conflict protection for any
versioned rich text: scenes and notes today. When a restore produces a
newer version, the open editor loads it.

## Template kits (M5)

A kit is a named, ordered set of the author's templates ("My Romantasy Book
Kit": main plot, romance arc, character arc, a worldbuilding structure…).
Applying a kit to a book or series creates one new, independent structure
per template, all in one transaction: for romance templates the author picks
the relationship(s) (one arc each, pairs or groups), for character-arc
templates the character(s); picking none skips that template. "Save as kit"
turns a book's (or series') structures into templates gathered in a kit.
Kits never share live records between projects. _Extension point:_
`template_kit_items.item_type` leaves room for other template types (e.g.
publishing workflows in v1.1).

## Search (M5, languages M6)

`search` uses Postgres full-text search over scenes (title, synopsis,
text), notes, ideas and characters (name, aliases, summary), with
highlighted snippets; other kinds are matched by title. Two kinds of
matching are combined:

- **Exact words**, always on, in any language: the 'simple' configuration
  on expression GIN indexes, every word as a prefix ("lighth" finds
  "lighthouse"), and `"quoted phrases"` matched exactly. Exact titles and
  phrases therefore always work.
- **Word forms in the pen name's language (M6):** a pen name can have a
  writing language (`pen_names.language`, a BCP 47 code; list in
  `lib/languages.ts`, about 25 languages with Postgres stemmers). Words are
  also stemmed in that language ("running" finds "run", "corrían" finds
  "correr"), over that identity's scenes and characters; shared notes and
  ideas are searched in the languages of the identities in scope. The
  language belongs to the pen name, never to the workspace, so an author
  writing in English and Spanish gets both. Stemmed queries filter by
  workspace first and need no extra index at today's sizes; per-language
  expression indexes can be added later without changing the service.

Results are merged by best rank, resolved through the Story Graph, so the
Trash and "Writing as" apply as everywhere else.

## Export (M5)

The export wizard (`/export`) offers **current pen name, selected pen names
or the entire workspace**, then a format:

- **DOCX manuscript:** standard manuscript format (12 pt, double-spaced,
  first-line indents, title page, a chapter per page, `#` between scenes).
- **Markdown manuscript:** headings for books, parts and chapters, `* * *`
  between scenes.
- **Standard backup (JSON)** (`authoros.workspace`, version 3 since M8, `kind:
"standard"`): the structured backup. Every story object with its original
  id and story-node kind; the hierarchy with positions; scene and note
  content as ProseMirror JSON with its format version; characters, relationships with members and
  roles, connections (kind, label, note, attributes), structures, beats and
  beat → scene assignments, templates, kits, custom fields and values,
  tasks, events, writing sessions, pen names (with language). Items in the
  Trash are included (with `deletedAt`). Built-in templates are referenced
  by their fixed ids. `checkExportIntegrity()` verifies every reference
  resolves inside the export; the import validates with it first.
- **Complete archive (JSON)** (`kind: "archive"`, M6): the standard backup
  plus version history (every saved version of scenes and notes, and earlier
  values of long-form fields). Larger;
  the file name ends in `-archive-<date>.json`.

DOCX and Markdown are for reading and sharing (visible manuscript only);
JSON is the backup. Pen-name exports contain only those identities' work,
the shared objects not linked only to other identities, and links whose two
ends are both included. Exports are read-only (tested: every story table is
byte-identical before and after); downloads are a route handler that checks
the author like every page.

## Import Engine (M6)

`/import` restores a backup or brings a workspace in from another account.
The engine (`src/modules/imports`) is a pipeline, the same for every source:

```
file → source parser → Workspace Bundle → validate → plan → review
                                                       ↘ apply (one transaction)
```

- **Sources** (`sources/catalog.ts`, `sources/registry.ts`) turn a file into
  a **Workspace Bundle** (`bundle.ts`): the export's shape, validated
  column by column (only known columns are read; derived values such as
  plain text, word counts and member keys are recomputed, never trusted).
  AuthorOS JSON is implemented. Scrivener, Plottr, DOCX and EPUB are listed
  as coming later; each will be one parser producing a bundle (with fresh
  ids) and reuse everything downstream.
- **Validate** (`validate.ts`) checks the whole file before anything else:
  every reference resolves (`checkExportIntegrity`), ids are unique, and
  the product rules hold (identities never mix, relationships have two or
  more members and one per set of members, structures have one owner,
  connections follow the registry, one point of view per scene, field
  values match their field's kind). An invalid file is refused with the
  problems listed; nothing is read from the database.
- **Plan** (`plan.ts`) decides for every row: **create**, **update**,
  **skip** (already here) or **conflict**, under two options. _Ids_:
  **keep** restores with the original Story Graph ids; an id already used
  by another workspace (or by another kind of object) is a conflict, to be
  resolved by importing **as a copy**, which gives every object a new id and
  rewrites every reference. _Existing objects_: **skip** keeps them as they
  are (missing ones are still restored); **replace** updates them to the
  file's version, saving current scene and note text as a version first
  (`IMPORT` revision, "Before import") and bumping the content version so
  open editors notice. Objects moved to another pen name, book or owner
  since the backup are conflicts: an import never moves identity. Matching:
  pen names by id, then by name (the default pen name never changes);
  relationships by their members; custom fields by kind, scope and label;
  connections by ends and kind (a second point of view becomes "present");
  beat assignments and field values by their keys; the editor's daily
  writing rows by day. Imported writing sessions, versions and connections
  belong to the importing author; the daily goal is set only if unset.
- **Review** (`reviewImport`) shows the file (backup or archive, scope,
  date), a factual summary ("This import will create 52 items, skip 3 that
  already exist."), counts per kind, conflicts with the objects concerned,
  adjustments ("Good to know"), or the validation problems. It changes
  nothing and returns a token: a hash of the file and of the plan.
- **Apply** (`runImport`) re-reads and re-validates the file, recomputes the
  plan inside one database transaction, refuses if it has conflicts or no
  longer matches the token ("Your workspace changed since this file was
  reviewed"), then writes parents before children in batches. Any failure
  rolls everything back: an import is all or nothing (tested by failing a
  write midway). Story nodes are inserted with the bundle's ids in the same
  transaction as their typed rows: the one place ids don't come from
  `createStoryNode()`.

Uploads go to route handlers under `/api/import/{review,apply}` (not
Server Actions, whose bodies are capped at 1 MB; `/api` is outside the
proxy, which would buffer them). The browser gzips the file
(`CompressionStream`); the server checks the origin (route handlers don't
get Server Actions' CSRF protection), the session, and caps the upload (60
MB compressed, 200 MB decompressed).

## AI boundary (_planned, v1.2_)

Revision `source` already distinguishes `AI_ACCEPTED` from author edits.

- `src/modules/ai` builds prompts from read-only service calls and stores the
  output as `Suggestion` rows (`PENDING`).
- The module has **no write access** to creative tables. A lint rule will
  forbid `@/modules/ai` from importing the write functions of other modules.
- The user reviews a diff and accepts or rejects it. Accepting calls the
  owning module's normal update function with `source: AI_ACCEPTED`, which
  saves a revision first.

## Background work (direction, M7)

Imports, exports and builds run in the request today: imports in one
transaction (up to 10 minutes), exports streamed as downloads. Nothing
needs a job system yet, so none is built. The seam is in place: services
are plain functions of `(ctx, input)` (the import's review and apply are
already separate, token-checked steps), so a job runner (pg-boss on the same
Postgres, the planned choice) can call them unchanged, with a job row the
UI polls and files in object storage. It arrives with the first feature
that needs it: large archives, formatting builds, EPUB/PDF, media
processing, publishing packages.

## Deployment

- **Vercel** hosts the app (Node.js runtime, Fluid compute).
- **Neon Postgres**, added through the Vercel Marketplace integration:
  - `DATABASE_URL`: the pooled connection, used by the app at runtime.
  - `DATABASE_URL_UNPOOLED`: the direct connection, used by migrations
    (`prisma.config.ts`).
  - A separate database branch for each preview deployment.
- Build command (`vercel-build`): `prisma migrate deploy && next build`.
  Because previews get their own Neon branch, preview migrations never touch
  production.
- **Secrets:** `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`,
  `AUTH_RESEND_KEY`, `EMAIL_FROM`. See `.env.example`.

## Testing

| Layer       | Tool                   | What                                                                                                                                                                                                            |
| ----------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit        | Vitest                 | Pure functions (e.g. `safeCallbackUrl`). Co-located `*.test.ts`.                                                                                                                                                |
| Integration | Vitest + real Postgres | Services against `TEST_DATABASE_URL` (migrated in global setup, truncated per test). No database mocks. Includes database-level guarantees (cross-workspace FKs, node triggers, concurrency).                   |
| End-to-end  | Playwright             | Real magic-link sign-in through the dev outbox; the full writing loop (structure, keyboard drag-and-drop, autosave, history, conflicts, Trash, series, identities) on desktop, and writing on a phone viewport. |

CI (`.github/workflows/ci.yml`) runs format check, lint, typecheck,
migrations, unit/integration tests, production build, and end-to-end tests
against a Postgres service container.
