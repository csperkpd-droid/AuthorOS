<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# AuthorOS conventions

Read `docs/ARCHITECTURE.md` and `docs/DATABASE.md` before changing structure or schema.

- **Product rules:** AI never writes creative content (only `Suggestion` rows). Creative content uses soft delete and revisions.
- **Layers:** `src/app` routes are transport only. Business logic lives in `src/modules/<name>/service.ts`; services take `AuthorContext` first and scope every query by `ctx.workspaceId`.
- **Module boundaries:** import other modules only via `@/modules/<name>` (domain: services, schemas, labels) or `@/modules/<name>/ui` (components, Server Actions); enforced by ESLint. Routes and components never import `@/lib/db` or Prisma.
- **Story objects** get their id from `createStoryNode()` in the same transaction (see Story Graph in `docs/ARCHITECTURE.md`); the import is the one exception (it inserts nodes with the bundle's ids). Permanent deletion = deleting the node. Pen names are story nodes too.
- **Story Object Registry:** every kind is defined once in `story-graph/kinds.ts` (with its adapter in `story-graph/adapters.ts`). Read kinds, capabilities and labels from it; never keep another list of kinds.
- **Connections:** flexible links between story objects use the `connections` module (kinds in `connections/registry.ts`); structural relationships stay explicit FKs. A new node kind needs: the enum value, a table with the two story-node triggers, a registry entry and adapter (TypeScript flags the rest), its visibility rule, its export/import columns; `tests/integration/story-graph-integrity.test.ts` must pass for it.
- **Structure vs connections:** beat → scene placement is structural (`structure` module, `beat_scenes`), never a connection; scenes are never copied. Versioned content goes through the `history` module.
- **Identities:** characters, relationships and outlines belong to one pen name; never link across pen names (`sameIdentity()`). Notes and ideas are shared.
- **Change Impact:** changes that move, delete, detach or affect connected story data (pen-name moves, deleting forever, deleting a field or template, leaving a series, removing members, beats or parts) produce a report with `buildReport()` (`@/modules/impact`) and apply through `assertReviewed(report, token)`. Keep reports factual. Never move identity as a side effect of an edit; never detach or orphan silently.
- **Authorization:** every service that changes data calls `assertCan(ctx, action, area)` (`@/server/policy`) as its first statement; `tests/integration/authorization.test.ts` enforces it.
- **Author content safety:** long-form text gets history: documents through the `history` module (versions, checkpoints); other long-form fields through `recordFieldHistory()` in the same transaction as the edit. Metadata edits take an `EditGuard` (`lib/concurrency.ts`) and refuse stale forms. Editors keep the local draft first and never show "saved" for text only this device has. A document schema change adds an upgrade step in `lib/doc-format.ts`.
- **Change Impact levels:** Green = automatic factual propagation; Yellow = suggested consequences (report groups with `level: "suggested"`), applied only when accepted (`assertReviewed(report, token, accepted)`); Red = approval required.
- **Decided boundaries (not built, see DECISIONS 87–92):** comments are metadata with external anchors, never in the text; the Life Planner is a separate privacy boundary; workspace membership is not access to every project; beats will be separate from beat assignments; writing status is not publication (editions); tropes will be objects (`books.tropes` is transitional); core character fields are never duplicated as custom fields.
- **Dates:** a date that belongs to an object is a calendar entry about it (`calendar.setDeadline`), never a date column on the object.
- **Relationships** have two or more members (`relationship_members`); never assume a pair.
- **Exports** are read-only; the JSON export must keep `checkExportIntegrity()` passing when new tables are added.
- **Imports** go through the Import Engine (`imports` module): a source parser produces a Workspace Bundle; validation, plan and the single-transaction apply are shared. A new table needs its bundle schema, validation and plan/apply steps alongside its export. Never write partially.
- **Client components** import other modules only via `ui` entries (services are `server-only`).
- **Server Actions** wrap their body in `runAction()`, return ids instead of calling `redirect()`, and let the client navigate.
- **Auth:** call `requireAuthorContext()` in every page, action and route handler that touches author data. Don't rely on layouts or `proxy.ts` for authorization.
- **Schema:** follow `docs/DATABASE.md` conventions (UUIDv7, snake_case maps, `workspace_id` everywhere, `deleted_at` on creative content). Record notable choices in `docs/DECISIONS.md`.
- **Navigation:** add new sections to `src/config/navigation.ts`.
- **Checks before committing:** `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test` (and `pnpm test:e2e` for UI or auth changes).
