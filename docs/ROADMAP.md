# Roadmap

Milestones are sequenced so each one builds on data the previous one created.
Scope details: [MVP.md](MVP.md). Schema: [DATABASE.md](DATABASE.md).

## MVP

|     | Milestone                                                                                                                              | Status                          |
| --- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| 0   | Foundations: repo, database architecture, auth, shell, docs                                                                            | ✅ Complete                     |
| 1   | Writing loop + author identities: series/books/parts/chapters/scenes, editor, revisions, Trash, pen names, Story Graph extension point | ✅ Complete                     |
| 2   | Story bible + Universal Connections: characters, relationships, notes, ideas, connections                                              | ✅ Complete (awaiting approval) |
| 3   | Structure and romance: beat templates, outlines, romance arcs (outlines become story nodes)                                            | Next                            |
| 4   | Getting work done: tasks, calendar, writing sessions, goals, dashboard                                                                 | Planned                         |
| 5   | Ownership: search, manuscript export, workspace export                                                                                 | Planned                         |

**Why this order:** the editor and binder are used every day, so they come
first. The story bible needs scenes to link to. Structure maps onto scenes
and relationships. Planning tools are most useful once there is a
manuscript. Export closes the MVP with the "you own your data" promise.

## After the MVP

### v1.1: Timeline, publishing, pen-name branding

- In-world timeline across books and series (custom calendars via label + sort key).
- Per-book publishing workflows from a default checklist; editions and retail listings.
- Pen-name depth: per-edition pen names, links/socials, brand kit, publishing accounts.
- Background jobs (pg-boss) for exports and statistics.

### v1.2: AI suggestions

- Suggestion inbox; per-scene "ask for feedback"; diff review with accept/reject.
- Strictly opt-in, per workspace. Claude by default.
- Prompt versions and model are recorded on every suggestion.

### v1.3: Collaboration

- Invite co-authors, editors (comment and suggest) and beta readers (view and comment).
- Role checks via a policy helper; activity log; presence.

### Story Graph growth

- Universal Connections shipped in M2. New object types join as they are
  built: outlines and romance arcs (M3), tasks (M4), timeline events (v1.1),
  then locations, research, songs, plot threads, worldbuilding.
- Later: a graph view of connections; tags on any node.

### Later

- Imports: DOCX, Scrivener, Markdown.
- Book covers and media (Vercel Blob).
- Public author pages per pen name.
- Offline-tolerant editor; mobile-optimized writing mode.
- Public API built on the module services.
