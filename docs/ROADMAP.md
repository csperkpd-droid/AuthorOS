# Roadmap

Milestones are sequenced so each one builds on data the previous one created.
Scope details: [MVP.md](MVP.md). Schema: [DATABASE.md](DATABASE.md).

## MVP

|     | Milestone                                                                                                                                                  | Status                           |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| 0   | Foundations: repo, database architecture, auth, shell, docs                                                                                                | ✅ Complete                      |
| 1   | Writing loop + author identities: series/books/parts/chapters/scenes, editor, revisions, Trash, pen names, Story Graph extension point                     | ✅ Complete                      |
| 2   | Story bible + Universal Connections: characters, relationships, notes, ideas, connections                                                                  | ✅ Complete                      |
| 3   | Structure and romance: beat templates, outlines, romance arcs (outlines become story nodes)                                                                | ✅ Complete                      |
| 4   | Getting work done: tasks, calendar, writing sessions, goals, dashboard; series arcs, Change Impact                                                         | ✅ Complete                      |
| 5   | Ownership: search, manuscript export, workspace export; group relationships, template kits, Change Impact for deletions                                    | ✅ Complete                      |
| 6   | Import Engine: JSON restore and move between accounts; search languages per pen name; relationship roles; complete archive export                          | ✅ Complete                      |
| 7   | Foundations: Story Object Registry, authorization in services, one model for dates, connectable pen names, Change Impact gaps, Story Graph integrity audit | ✅ Complete                      |
| 8   | Safety & Readiness: local drafts, large-edit checkpoints, field history, stale-edit protection, document formats, Change Impact levels, writing status     | ✅ Complete                      |
| 9   | Access Boundary: permission-aware reads, account-owned device drafts, sign-out warning, architecture baseline in the repository                            | ✅ Complete                      |
| 10  | Work Context: Back, Return to Work and Continue Writing, with version-aware positions                                                                      | ✅ Complete                      |
| 11  | Scene Participation: point of view, present and mentioned characters as a dedicated relationship                                                           | ✅ Complete                      |
| 12  | Story Time: scenes and timeline events in story order, per book or series, apart from reading order and real-world time                                    | ✅ Complete                      |
| 13  | Tropes: shared, reusable trope objects for books, series, relationships and structures (replacing the book trope text)                                     | ✅ Complete                      |
| 14  | Beats, Beat Assignments and Validity: beats as story objects; placements Current, Potentially Stale, Conflicted or Intentionally Excepted                  | ✅ Complete (manually validated) |
| 15  | World objects: places and world entries as story objects for every genre; scenes set in places (Scene Setting)                                             | ✅ Complete (manually validated) |
| 16  | Comments with external anchors: comments on scene and note text, kept outside the document and re-found strictly when the text changes                     | ✅ Complete (awaiting approval)  |

**Status words.** _Planned_: documented, not approved for implementation.
_Approved_: authorized, not yet started. _In progress_: authorized and begun.
_Complete (awaiting approval)_: implemented and automatically validated,
waiting for the author's manual acceptance. _Complete (manually validated)_:
the author accepted it and approved closing it.

### Planned milestones (M17–M24)

From the implementation-readiness plan (sixteen milestones, M9–M24; the plan
itself is a separate report, not in this repository). Built so far, in a
different order than planned: plan M9–M10 as M9–M10, plan M12 (Scene
Participation) as M11, plan M13 (Story Time) as M12, plan M15 (Tropes) as
M13, plan M11 (Beats and Validity) as M14, plan M14 (World objects) as M15,
plan M16 (Comments) as M16. From M17 the numbers match the plan again. None
of these is approved; each gets its full breakdown before it is authorized,
since earlier milestones change what it needs.

|     | Milestone                                                                                                                                       | Status  |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| 17  | Findings and Review: evidence-based observations the author reviews (not errors, not changes); a Review page; first finders                     | Planned |
| 18  | Task views: Home, Kanban and a weekly Planner over the one tasks table; tasks from findings and comments                                        | Planned |
| 19  | Assets and Files: an asset (cover, map, image) separate from its stored file and versions; needs an object-storage package (approval)           | Planned |
| 20  | Editions, provenance and the Publication Boundary: Book ≠ Edition, lineage to the manuscript version; replaces the "Publication status" stopgap | Planned |
| 21  | Publishing workflows and publication export: checklists per edition; EPUB, DOCX and PDF from an edition; first background jobs                  | Planned |
| 22  | Project access and co-authoring: per-book, series and pen-name grants; invitations; collaborators comment and suggest                           | Planned |
| 23  | Life Planner boundary and data classification: only explicitly shared tasks and events cross; sensitivity separate from permission              | Planned |
| 24  | AI suggestions and governance: AI suggests, the author approves, domain actions apply; provenance; governance can't be bypassed                 | Planned |

Not scheduled in the plan: the offline-first sync engine, formatting,
marketing and analytics, query and reasoning, tablet layouts, more import
sources. **Uncertain:** the release sections below (v1.1 publishing, v1.2 AI,
v1.3 collaboration) predate this plan, which orders the same work as M20–M21,
M24 and M22; the plan's order is the current intent, and their release
labels are not yet decided.

**Why this order:** the editor and binder are used every day, so they come
first. The story bible needs scenes to link to. Structure maps onto scenes
and relationships. Planning tools are most useful once there is a
manuscript. Export closes the MVP with the "you own your data" promise.

## After the MVP

### Architecture checkpoint (before v1.1)

Findings and recommendations in
[ARCHITECTURE-CHECKPOINT.md](ARCHITECTURE-CHECKPOINT.md). Milestone 7
(Foundations) implemented the approved direction; the v1.1 order is decided
after Foundations is reviewed. A second checkpoint after Foundations
([MVP-CHECKPOINT.md](MVP-CHECKPOINT.md)) audits MVP scope, safety and
readiness; Timeline stays in v1.1.

### v1.1: Timeline, publishing, pen-name branding

- ~~In-world timeline~~: built in M12 (Story Time). Later: custom calendars, durations, an event ↔ scene "shown in" link (backlog).
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
  built: outlines and romance arcs (M3), tasks and events (M4), timeline events (v1.1),
  then locations, research, songs, plot threads, worldbuilding.
- Later: a graph view of connections; tags on any node; optional scopes for
  notes and ideas; more custom-field types and kinds; deliberately shared
  resources across pen names; publishing workflows in template kits (v1.1).

### Later

- More import sources on the M6 Import Engine: Scrivener, Plottr, DOCX, EPUB, Markdown.
- Book covers and media (Vercel Blob).
- Public author pages per pen name.
- Offline-first editor (builds on the M8 local draft store); mobile-optimized writing mode.
- Public API built on the module services.
