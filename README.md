# AuthorOS

An all-in-one workspace for authors: series, books, manuscripts, characters,
relationships, story structure, romance planning, notes, tasks and more.

**Principles:** authors stay in control · AI suggests, never changes ·
everything is connected · built to grow.

> **Status:** the MVP is complete, plus Milestone 6 (JSON import, search languages, relationship roles) Milestone 7 (Foundations: Story Object Registry, authorization, one model for dates, Story Graph integrity) Milestone 8 (Safety & Readiness: local drafts, version and field history, stale-edit protection, document formats, Change Impact levels) Milestone 9 (Access Boundary: permission-aware reads, account-owned device drafts, the architecture baseline) and Milestone 10 (Work Context: Back, Return to Work, Continue Writing). See [docs/ROADMAP.md](docs/ROADMAP.md).

## Documentation

| Doc                                                           | What's in it                                                |
| ------------------------------------------------------------- | ----------------------------------------------------------- |
| [ARCHITECTURE.md](docs/ARCHITECTURE.md)                       | System design, layers, auth, module rules, deployment       |
| [DATABASE.md](docs/DATABASE.md)                               | Conventions, current schema, target schema for every module |
| [MVP.md](docs/MVP.md)                                         | MVP scope and milestone acceptance criteria                 |
| [ROADMAP.md](docs/ROADMAP.md)                                 | Milestones and post-MVP releases                            |
| [DECISIONS.md](docs/DECISIONS.md)                             | Architecture decision log                                   |
| [ARCHITECTURE-CHECKPOINT.md](docs/ARCHITECTURE-CHECKPOINT.md) | Pre-v1.1 review: findings and recommendations               |
| [MVP-CHECKPOINT.md](docs/MVP-CHECKPOINT.md)                   | Post-Foundations audit: MVP scope, safety, readiness        |

## Stack

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS 4 ·
PostgreSQL 16 + Prisma 7 · Auth.js v5 · Vitest · Playwright · Vercel + Neon

## Local development

Requirements: Node.js 22+, pnpm 10, and Docker (or any local PostgreSQL 16).

```bash
pnpm install                  # also generates the Prisma client
cp .env.example .env          # then set AUTH_SECRET: npx auth secret
docker compose up -d          # Postgres on :5432 (creates authoros + authoros_test)
pnpm db:migrate               # apply migrations
pnpm dev                      # http://localhost:3000
```

**Signing in locally:** enter any email. Without `AUTH_RESEND_KEY`, the
sign-in link is printed in the terminal running `pnpm dev` (and saved to
`.dev-mail/outbox.jsonl`). Google sign-in appears once `AUTH_GOOGLE_ID` and
`AUTH_GOOGLE_SECRET` are set.

### Scripts

| Command                                                    | Does                                                 |
| ---------------------------------------------------------- | ---------------------------------------------------- |
| `pnpm dev` / `build` / `start`                             | Next.js                                              |
| `pnpm lint` · `typecheck` · `format`                       | Code quality                                         |
| `pnpm test`                                                | Unit + integration tests (needs `TEST_DATABASE_URL`) |
| `pnpm test:e2e`                                            | Playwright end-to-end tests (starts the dev server)  |
| `pnpm db:migrate` · `db:deploy` · `db:studio` · `db:reset` | Prisma                                               |

## Deploying to Vercel

1. Import the repository in Vercel.
2. **Storage → Marketplace → Neon**: create a database and connect it to the
   project. This sets `DATABASE_URL` and `DATABASE_URL_UNPOOLED`; enable
   preview branching.
3. Set environment variables: `AUTH_SECRET`, `AUTH_RESEND_KEY`, `EMAIL_FROM`
   (a sender on a domain verified in Resend), and optionally `AUTH_GOOGLE_ID`
   / `AUTH_GOOGLE_SECRET`.
4. Google OAuth redirect URI: `https://<your-domain>/api/auth/callback/google`.
5. Deploy. The `vercel-build` script runs migrations before building.
