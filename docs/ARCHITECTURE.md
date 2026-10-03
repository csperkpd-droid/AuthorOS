# Architecture

AuthorOS is a **modular monolith**: one Next.js application, one PostgreSQL
database, with the code split into domain modules that have strict boundaries.

> Status: Milestone 1 (writing loop + author identities). Sections marked
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

| Module        | Owns                                                                                                                |
| ------------- | ------------------------------------------------------------------------------------------------------------------- |
| `auth`        | Sign-in form and actions (UI only).                                                                                 |
| `workspaces`  | Personal workspace bootstrap, membership lookup.                                                                    |
| `pen-names`   | Author identities: create/edit/default/archive/restore, the active identity, the identity switcher.                 |
| `story-graph` | Story node creation and permanent deletion (the Story Graph extension point).                                       |
| `library`     | Series and books; pen-name rules for them; series order.                                                            |
| `manuscript`  | Parts, chapters, scenes (structure, ordering, moves), scene content, autosave, revisions, the binder and editor UI. |
| `trash`       | Listing, restoring and permanently deleting trashed story objects of every type.                                    |

Dependency direction: `manuscript` → `library` → `pen-names` → `workspaces`;
`trash` → `library`, `story-graph`. Nothing depends on `trash` or on UI.

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
- **Pen names** belong to the workspace; series and books reference one (see
  Author identities below). Data is not separated per pen name: one author's
  characters and notes can serve several identities.

## Author identities (pen names)

- A workspace has one or more **pen names**; exactly one is the default
  (database-enforced). Every series and book belongs to exactly one pen name.
- **Books in a series always use the series' pen name.** Changing a series'
  pen name moves its books with it; a book's own pen name applies only when
  it is standalone. (Per-edition overrides arrive with Publishing in v1.1.)
- **Archive, don't delete.** Archived pen names disappear from pickers and
  the switcher; their work keeps its attribution. The default can't be
  archived.
- **Active identity** ("Writing as", sidebar): stored per member
  (`workspace_members.active_pen_name_id`), carried in `AuthorContext`. It
  narrows the Library and dashboard and is the pen name for new work. "All
  identities" (null) shows everything, grouped by pen name. The Pen names page
  is the All Identities view: every identity with its series and books.

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

**Revisions.** Before content is overwritten, the previous content is
checkpointed if the last revision is older than 10 minutes. Authors can also
save named versions. Restoring first saves the current text as a "before
restore" revision, so restores are always undoable.

**Trash.** Series, books, parts, chapters and scenes are soft-deleted. The
Trash lists the topmost trashed item of each branch; restoring brings back
its contents (except things trashed separately). "Delete forever" removes
the item, its descendants and their revisions.

## Story Graph (extension point for Universal Connections)

Every story object has a row in `story_nodes` (id, workspace, kind), and its
typed row (series, book, part, chapter, scene) uses that id as its primary
key, enforced by a composite foreign key and a kind-checking trigger. A
trigger deletes the node when the typed row is deleted, so the graph never
holds orphans.

This gives every object one universal, foreign-key-addressable identity.
The planned **Universal Connection layer** (Character → Inspiration, Scene →
Song, Research → Scene, Plot Thread → Scene, Note → Romance Arc…) becomes a
single `connections` table between two `story_nodes`, with no per-type join
tables. New object types (characters, locations, research, songs) join the
graph by getting a node. Explicit foreign keys remain for structural
relationships (a scene's chapter), where the type is fixed and cascades
matter. See [DATABASE.md](DATABASE.md#universal-connections-target-design).

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
