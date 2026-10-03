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
- **Story objects** get their id from `createStoryNode()` in the same transaction (see Story Graph in `docs/ARCHITECTURE.md`). Permanent deletion = deleting the node.
- **Server Actions** wrap their body in `runAction()`, return ids instead of calling `redirect()`, and let the client navigate.
- **Auth:** call `requireAuthorContext()` in every page, action and route handler that touches author data. Don't rely on layouts or `proxy.ts` for authorization.
- **Schema:** follow `docs/DATABASE.md` conventions (UUIDv7, snake_case maps, `workspace_id` everywhere, `deleted_at` on creative content). Record notable choices in `docs/DECISIONS.md`.
- **Navigation:** add new sections to `src/config/navigation.ts`.
- **Checks before committing:** `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test` (and `pnpm test:e2e` for UI or auth changes).
