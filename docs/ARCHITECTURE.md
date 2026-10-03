# Architecture

AuthorOS is a **modular monolith**: one Next.js application, one PostgreSQL
database, with the code split into domain modules that have strict boundaries.

> Status: Milestone 5 (group relationships, kits, Change Impact, search, export). Sections marked
> _planned_ describe the agreed design for later milestones so that early code
> doesn't block it.

## Principles → mechanisms

| Principle                  | How the architecture enforces it                                                                                                                            |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authors remain in control  | Revision history and soft-delete Trash for creative content; full export (manuscript and whole workspace); nothing is ever changed without a user action.   |
| AI suggests, never changes | The AI module can write to exactly one table, `Suggestion`. Applying a suggestion is an ordinary user action that saves a revision first. (_planned, v1.2_) |
| Strongly connected data    | Relational schema with real foreign keys and constraints; see [DATABASE.md](DATABASE.md).                                                                   |
| Modular and expandable     | Domain modules with public `index.ts` APIs, lint-enforced; a single feature registry drives navigation.                                                     |

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

**Roles.** `WorkspaceMember.role` (OWNER / EDITOR / VIEWER) exists now. In the
single-author MVP everyone is OWNER and no role checks are needed.
Collaboration later adds a `can(ctx, action)` policy helper in `server/` that
services call before writes.

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

**Autosave and conflicts.** The editor saves ~1 s after typing stops (and on
blur and Ctrl/Cmd+S), one save in flight at a time, retrying on failure.
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

## Story Graph and Universal Connections

**Identity.** Every story object (series, book, part, chapter, scene,
character, relationship, outline, note, idea) has a row in `story_nodes`, and its
typed row uses that id as its primary key, enforced by a composite foreign
key and a kind-checking trigger. A trigger deletes the node when the typed
row is deleted.

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
end ("Appears in" / "Characters"), whether it is directed, and an optional
single-choice attribute (a scene role). The service validates every
connection against it; the UI builds the "Connect" picker from it.

| Kind          | From → To              | Reads as                           | Attribute                                         |
| ------------- | ---------------------- | ---------------------------------- | ------------------------------------------------- |
| `appears_in`  | Character → Scene      | Appears in / Characters            | role: POV, present, mentioned (one POV per scene) |
| `develops_in` | Relationship → Scene   | Develops in / Relationship moments |                                                   |
| `about`       | Note → any             | About / Notes                      |                                                   |
| `inspired`    | Idea → any             | Inspired / Inspired by             |                                                   |
| `concerns`    | Task/Event → any       | Concerns / Tasks & dates           |                                                   |
| `related`     | any ↔ any (undirected) | Related to                         |                                                   |

**Resolution.** `story-graph/resolve.ts` turns node ids into summaries
(kind, title, context, link) with one loader per kind, each applying that
kind's visibility rule (`story-graph/visibility.ts`: nothing trashed, nothing
inside something trashed). Connections to hidden objects are skipped, not
deleted, so restoring brings them back. The same loaders power cross-kind
search for the picker.

**Adding a new object type** (e.g. Location): add the node kind and the
table (with the two triggers), a resolver case (the switch is exhaustive, so
TypeScript flags every place to update, including the Trash), and allow it
in the registry kinds it should join. The Connections panel, picker, Trash
and backlinks then work for it without new UI.

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

## Change Impact

Meaningful changes that affect connected story data are previewed before
they happen. A service produces an **impact report**: the affected objects,
grouped by kind with what happens to each, plus **blockers** (things that
must be resolved first), and a **token** that fingerprints the report. The
UI ("What will this affect?") offers **Move everything**, **Review changes**
(every affected item, linked) and **Cancel**. Applying recomputes the plan
under a row lock and refuses if the token no longer matches, so the author
only ever applies what they reviewed. Nothing is moved silently or orphaned.

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

## Search (M5)

`search` uses Postgres full-text search with expression GIN indexes
('simple' configuration: any language, no stemming; every word must match,
as a prefix) over scenes (title, synopsis, text), notes, ideas and
characters (name, aliases, summary), with highlighted snippets; other kinds
are matched by title. Results are resolved through the Story Graph, so the
Trash and "Writing as" apply as everywhere else.

## Export (M5)

The export wizard (`/export`) offers **current pen name, selected pen names
or the entire workspace**, then a format:

- **DOCX manuscript:** standard manuscript format (12 pt, double-spaced,
  first-line indents, title page, a chapter per page, `#` between scenes).
- **Markdown manuscript:** headings for books, parts and chapters, `* * *`
  between scenes.
- **Full workspace JSON** (`authoros.workspace`, version 1): the structured
  backup. Every story object with its original id and story-node kind; the
  hierarchy with positions; scene and note content as ProseMirror JSON;
  characters, relationships with members, connections (kind, label, note,
  attributes), structures, beats and beat → scene assignments, templates,
  kits, custom fields and values, tasks, events, writing sessions, pen names;
  version history optionally. Items in the Trash are included (with
  `deletedAt`). Built-in templates are referenced by their fixed ids.
  `checkExportIntegrity()` verifies every reference resolves inside the
  export; a future import validates with it first and can rebuild the Story
  Graph with the same ids.

DOCX and Markdown are for reading and sharing (visible manuscript only);
JSON is the backup. Pen-name exports contain only those identities' work,
the shared objects not linked only to other identities, and links whose two
ends are both included. Exports are read-only (tested: every story table is
byte-identical before and after); downloads are a route handler that checks
the author like every page.

## AI boundary (_planned, v1.2_)

Revision `source` already distinguishes `AI_ACCEPTED` from author edits.

- `src/modules/ai` builds prompts from read-only service calls and stores the
  output as `Suggestion` rows (`PENDING`).
- The module has **no write access** to creative tables. A lint rule will
  forbid `@/modules/ai` from importing the write functions of other modules.
- The user reviews a diff and accepts or rejects it. Accepting calls the
  owning module's normal update function with `source: AI_ACCEPTED`, which
  saves a revision first.

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
