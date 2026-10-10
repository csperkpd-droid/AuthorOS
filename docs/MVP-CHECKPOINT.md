# Architecture and MVP checkpoint (after Foundations)

An audit of the implementation after Milestone 7 against the full AuthorOS
design ([ARCHITECTURE.md](ARCHITECTURE.md), [DATABASE.md](DATABASE.md),
[DECISIONS.md](DECISIONS.md), [ROADMAP.md](ROADMAP.md) and the direction
given at each approval). **Findings and recommendations only; nothing here
is implemented.** Timeline stays a v1.1 feature; the next milestone is
chosen after this review.

Recommendations are numbered **C1…C20**, with a proposed order at the end.

---

## 1. What is implemented and should be considered MVP

| Area                    | MVP scope                                                                                                                                                                          |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Account and workspace   | Sign-in (magic link, Google), one personal workspace, settings (time zone, daily goal)                                                                                             |
| Identities              | Pen names (default, archive, language), "Writing as" / All Identities, identity separation, pen-name moves with Change Impact                                                      |
| Manuscript              | Series → books → optional parts → chapters → scenes; binder with drag-and-drop; editor with autosave, conflict protection, word counts; version history with named versions; Trash |
| Story bible             | Characters (profile, series scope), relationships of two or more members, notes (versioned), ideas (promote to book), custom text fields                                           |
| Story Graph             | Story nodes for 13 kinds, Universal Connections (6 kinds), Story Object Registry, integrity audit                                                                                  |
| Structure               | Built-in and own beat templates, structures per book or series, romance arcs per relationship, beats placed in scenes, Romance Center                                              |
| Planning                | Tasks, calendar events and deadlines (one date model), writing sessions, daily goal, streak, deadline pace                                                                         |
| Ownership               | Search, DOCX/Markdown manuscripts, Standard backup and Complete archive (JSON v2), JSON import (restore, copy)                                                                     |
| Safety and architecture | Change Impact with reviewed tokens, authorization in services, tenant-safe keys                                                                                                    |

## 2. What has expanded beyond the MVP

Everything shipped was approved, but measured against the original MVP
definition (M0–M5, single author, "find anything and take your data with
you"), these went further:

| Expansion                                                  | Came from       | Assessment                                                                                                                            |
| ---------------------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Series-long arcs, Series Romance Center                    | M4 approval     | Core to the romance promise; keep                                                                                                     |
| Group relationships, member roles                          | M5/M6 approvals | Keep; roles are free text, so cheap                                                                                                   |
| Template kits                                              | M5 approval     | Small; keep. Not linked from much of the UI                                                                                           |
| Search stemming in ~25 languages                           | M6 approval     | Small code; the language list is broader than any current author needs. Keep, but don't advertise beyond a few languages until tested |
| Import Engine catalog showing 4 future sources             | M6              | UI promises sources that don't exist yet ("coming later"); consider hiding until one ships                                            |
| Roles EDITOR / VIEWER with grants                          | M7              | Defined but unreachable (no invitations). Correct as infrastructure; not a feature                                                    |
| Deadlines on series and pen names (registry `dated`)       | M7              | Model allows it, no UI. Fine                                                                                                          |
| Writing sessions from the editor (automatic word tracking) | M4              | MVP-adjacent; keep                                                                                                                    |

Nothing needs removing. **C1:** treat M6–M7 as post-MVP and stop adding
"while we're here" features: each next milestone gets an explicit scope
list approved before work starts (as Foundations had).

## 3. Decisions that are now locked

Changing any of these would mean data migrations across every table and
rewriting large parts of the code:

1. Workspace is the tenancy boundary; every row carries `workspace_id`;
   same-workspace references use composite foreign keys.
2. Story objects are story nodes (UUIDv7, global ids); the typed row uses
   the node id; two triggers per table; deleting the node deletes the
   object.
3. The four layers stay separate: story objects, the structural hierarchy
   (foreign keys), structure/beat placements (`beat_scenes`), Universal
   Connections (`connections` + registry).
4. Scenes are the only manuscript text containers; chapters and parts hold
   no text; text is ProseMirror JSON with derived plain text and word count.
5. Pen names partition work: series, books, characters, relationships and
   structures belong to one pen name; notes, ideas, tasks and events are
   shared.
6. Soft delete (Trash) for creative content; permanent deletion only
   through Change Impact.
7. Versioned content through the history module (whole-document
   snapshots); optimistic versions for concurrent edits.
8. Change Impact reports with tokens; `assertReviewed` for anything that
   affects other data.
9. Authorization in services (`assertCan` first).
10. Dates that belong to an object are calendar entries about it.
11. Export format `authoros.workspace` with versioned upgrades on import.
12. Modular monolith on Next.js + Postgres; services are plain functions of
    `(ctx, input)`.

## 4. Future systems with clean extension points

| System                                | Extension point                                                                                          |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Timeline                              | New node kind via the registry; events link to scenes (connections) and carry in-world time              |
| Worldbuilding, Research, Inspiration  | New node kinds; connections (`about`, `related`, new kinds in the registry); custom fields               |
| Planner (writing tasks)               | Tasks and calendar entries are story nodes with `concerns` links; deadlines already unified              |
| Publishing workflows                  | Template + kit pattern (`item_type`); tasks and dated entries as the workflow's steps; editions as nodes |
| More import sources                   | One parser producing a Workspace Bundle                                                                  |
| Formatting / EPUB / PDF               | `lib/doc-blocks.ts` renders read-only from the manuscript                                                |
| Collaboration (comments, suggestions) | Policy actions `comment`/`suggest` already defined; resource parameter in `can()`                        |
| AI suggestions                        | Same as suggestions; `AI_ACCEPTED` revision source                                                       |
| Analytics                             | Word counts, writing sessions and revisions are already event data to derive from                        |
| Background jobs                       | Services are callable from a runner unchanged                                                            |

## 5. Future systems that would be expensive or risky to retrofit

| System                                      | Why it's expensive later                                                                                                                                                                      | Do now?                                               |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| **Offline / sync**                          | Needs client-generated ids, a change feed, and tombstones for hard deletes (connections, placements, field values are hard-deleted today, so a device can't learn they're gone)               | Cheap groundwork now (C8, C9); sync itself much later |
| **Comments / suggestions anchored in text** | The anchor model decides whether the manuscript stays clean (see §7.1). Retrofitting anchors after comments exist means migrating every comment                                               | Decide the model now (C6); build with collaboration   |
| **Life Planner privacy**                    | Tasks and events are workspace story nodes; personal life items mixed in would be visible to future collaborators and appear in backups                                                       | Decide the scope model now (C10); build with Planner  |
| **Co-authoring across workspaces**          | Composite foreign keys forbid cross-workspace links (by design). Co-authored books need a shared workspace, so authors need several workspaces, a switcher and cross-workspace personal views | Decide now (C11); build with collaboration            |
| **Typed custom fields**                     | `node_field_values.value` is `text`; typed values (number, date, select, reference) need a typed column or JSON and a data migration                                                          | Cheap now while values are few (C13)                  |
| **Content schema migrations**               | Documents have no format version; an editor upgrade that renames node types has no way to tell old documents from new                                                                         | Cheap now (C12)                                       |

## 6. Infrastructure to put in place before the next feature areas

| Before                            | Needed                                                                                                                   |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Any of them                       | **C2** big-change checkpoints, **C3** version history for other long text, **C4** stale-edit protection on metadata (§9) |
| Timeline, Worldbuilding, Research | Decide the reserved kinds (§11); decide beats as nodes (C14)                                                             |
| Publishing, Marketing, Business   | **C15** split book writing stage from publication state; assets/media storage (earlier R2); jobs for builds              |
| Planner / Life Planner            | **C10** personal vs workspace scope; recurrence (deferred, decision 86)                                                  |
| Revision, Collaboration, AI       | **C6** anchor model; suggestions table (designed); activity log (earlier R6)                                             |
| Formatting                        | **C12** content format version; front/back matter (earlier R9); a defined block vocabulary                               |
| Inspiration                       | Assets (earlier R2)                                                                                                      |

## 7. Current implementation that conflicts with the long-term design

1. **The earlier anchor recommendation (R7) would pollute the manuscript.**
   It proposed marks with ids inside the scene document. That breaks
   "manuscript text remains clean and separate from planning metadata":
   every export, word count and formatting build would have to strip
   them, and a comment would change the master text's version. **C6:**
   anchors live outside the text: an `annotations` table keyed by scene,
   holding a text-quote selector (exact text plus prefix/suffix) and the
   document version it was made on, re-anchored by matching on later
   versions. The document never changes for a comment.
   **Status (M16, decision 114):** built for comments with one `comments`
   table holding the anchor as columns, not a general `annotations` table;
   a shared anchor table waits for its second use (suggestions, M24).
2. **Book status mixes writing stage and publication.** `books.status` has
   `PLANNING … COMPLETE, PUBLISHED`. Publication belongs to editions
   (a book can be published in one format, unpublished in another) and to
   the publishing workflow. **C15:** before Publishing, keep `status` as
   the writing stage and derive "published" from editions.
3. **Two attribute systems for characters.** A fixed `profile` JSON
   (hard-coded fields) plus custom fields. Worldbuilding needs one system.
   Already deferred (decision 86); **C13** keeps it cheap.
4. **Tropes are a string array on books.** They can't be searched across
   books, connected, renamed in one place or analysed. A shared vocabulary
   (tags on story nodes, as designed in DATABASE.md "tags") fits "store
   once, many views". **C16** (low priority; migrate when tags arrive).
5. **Personal planning lives in the story workspace** (see §5, C10).
6. **The import catalog advertises sources** that don't exist yet (C1).

No conflict found with: Story Graph centrality, the four layers, Change
Impact, identity separation, export/import, analytics derivation.

## 8. Data-model decisions to reconsider before more migrations

| #   | Decision                                                                       | Recommendation                                                                                                                |
| --- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| C12 | Scene and note documents carry no format version                               | Add `content_format` (integer) to versioned objects now                                                                       |
| C13 | Custom field values are untyped text                                           | Add a `value_json` (or typed columns) before the first non-text type; plan the migration now                                  |
| C14 | Beats aren't story nodes                                                       | Decide before Timeline: beats as nodes (connectable to timeline events and notes) or not                                      |
| C15 | `books.status` includes `PUBLISHED`                                            | Split before Publishing                                                                                                       |
| C8  | Ids are always generated on the server                                         | Let create services accept a client-generated UUIDv7 (validated, unique); prerequisite for offline and for idempotent retries |
| C9  | Hard deletes leave no trace (connections, placements, field values, deadlines) | An append-only change log (also the activity log, R6) records deletes; no tombstone columns needed                            |
| C10 | Tasks/events are workspace-scoped                                              | Add an owner/visibility concept before Life Planner (personal items never in the workspace's story data)                      |
| C11 | One personal workspace per user                                                | Confirm "co-authored projects live in their own workspace" before collaboration                                               |

## 9. Missing safety mechanisms

1. **C2: Large deletions within 10 minutes can be lost.** Autosave
   checkpoints are purely time-based: the previous text is saved only if
   the last checkpoint is older than 10 minutes. Text written since the
   last checkpoint and then deleted or overwritten (a bad paste, an
   accidental select-all) is unrecoverable. Fix: also checkpoint before a
   save that removes a large share of the words (for example over 20% or
   over 200 words), regardless of time.
2. **C3: Other long creative text has no history.** Synopses, character
   summaries and profiles, relationship and series descriptions, idea
   bodies and beat descriptions are overwritten in place. Fix: route them
   through the history module (or a lighter field-history table).
3. **C4: Last write wins on metadata.** Two tabs editing a synopsis or a
   character overwrite each other silently. Scene text is protected;
   other edits are not. Fix: optimistic `updatedAt` checks on update
   services (the same conflict message as scenes).
4. **C5: Unsaved editor text exists only in memory.** If the network drops
   or the tab crashes between autosaves, typing since the last save is
   lost (the page only warns before unloading). Fix: keep unsaved editor
   content in the browser (IndexedDB) until the server confirms the save,
   and offer it back on reload. This is also the first piece of offline
   support.
5. **C7: Backups depend on the database provider and on the author.**
   Production relies on Neon's point-in-time recovery (retention not
   documented in the repo) and on the author exporting. Fix: document and
   test a restore drill; later, scheduled author backups once jobs exist.
6. Activity log (earlier R6): no record of who deleted forever, imported or
   moved identities. Becomes necessary with collaboration.
7. Version history grows without limit (whole-document snapshots every 10
   minutes of editing). Not a safety risk, but see §10.

## 10. Performance as data grows

Typical large author: a 10-book series, 1–1.5 million words, 3,000+
scenes, hundreds of characters, thousands of connections and notes.

| Area                          | Concern                                                                                                                                                                                                                              | Severity                  | Recommendation                                                                                                                                                                       |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Stemmed search                | Computes `to_tsvector(<language>, …)` over every scene of the workspace per query (no index)                                                                                                                                         | High at 1M+ words         | **C17:** expression indexes per used language, or a stored per-language vector column                                                                                                |
| Version history size          | Full snapshots, up to one per 10 minutes of editing: a scene worked on most days gathers hundreds of versions a year, so across thousands of scenes history soon outweighs the manuscript, and Complete archive exports grow with it | Medium (storage, exports) | **C18:** thin old autosave checkpoints (keep named versions, before-restore and import versions; keep e.g. daily after 30 days, weekly after a year); requires author-visible policy |
| Exports and imports           | Built fully in memory (JSON string), in the request                                                                                                                                                                                  | Medium at archive size    | Stream exports; jobs when needed (decision 85)                                                                                                                                       |
| Visibility filters            | Nested relation filters (scene → chapter → part → book → series) on every list                                                                                                                                                       | Low–medium                | Fine now; add `deleted_at`-aware partial indexes when lists slow down                                                                                                                |
| Identity move / Change Impact | Transitive closure of linked characters computed in a loop of queries                                                                                                                                                                | Low                       | Fine for hundreds of characters                                                                                                                                                      |
| Integrity audit               | Correlated subqueries per connection                                                                                                                                                                                                 | Low (tooling only)        | Keep out of request paths                                                                                                                                                            |
| Calendar range                | Resolves deadline subjects per request                                                                                                                                                                                               | Low                       | Fine                                                                                                                                                                                 |

Indexes checked and present: connections by source (unique) and target,
revisions by node and date, scenes by book and chapter, field values,
beat placements by scene.

## 11. Principles audit

| Principle                                                   | Status               | Notes                                                                                                                                                                                                                                                                                                                                                                                          |
| ----------------------------------------------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Store information once; many views                          | ✅ mostly            | Deadlines unified (M7). Derived caches (plain text, word counts, member keys) are recomputed, never edited. Exceptions: book tropes (§7.4); character profile vs custom fields (§7.3)                                                                                                                                                                                                          |
| Story Graph is the central architecture                     | ✅                   | All 13 story kinds are nodes, read through one registry. Templates, kits, field definitions, revisions and writing sessions are deliberately infrastructure, not story objects. Beats: decide (C14)                                                                                                                                                                                            |
| The four layers stay distinct                               | ✅ enforced          | Hierarchy = foreign keys, placements = `beat_scenes`, connections = registry; the audit checks each                                                                                                                                                                                                                                                                                            |
| Scene is the atomic bridge                                  | ✅                   | Placements, appearances (POV), relationship moments and word tracking all point at scenes; scenes are never copied                                                                                                                                                                                                                                                                             |
| Change Impact protects connected data                       | ✅                   | Never silently (`assertReviewed`); audited in M7                                                                                                                                                                                                                                                                                                                                               |
| Green / Yellow / Red                                        | ⚠ partial            | Today: green (affects nothing, applies directly) and red (author approval). **Yellow** (suggested consequences) doesn't exist: automatic adjustments (e.g. an import demoting a second POV to "present") are listed but not offered as choices. **C19:** add a level to report groups (`automatic`, `suggested`, `requires approval`) and let the author accept or skip suggested consequences |
| Never silently overwrite or delete creative work            | ⚠ gaps               | Scenes and notes are protected; see §9 (C2–C5) for other text and edge cases                                                                                                                                                                                                                                                                                                                   |
| Manuscript text clean and separate                          | ✅ now; ⚠ at risk    | Scene documents contain only text. Keep annotations outside (C6)                                                                                                                                                                                                                                                                                                                               |
| Analytics derive from existing data                         | ✅                   | Word counts, streaks and pace are computed. Writing sessions are primary event data (deltas can't be rebuilt from periodic snapshots), not duplication                                                                                                                                                                                                                                         |
| Planner tasks first-class, not duplicate checklists         | ✅                   | Tasks are story nodes with `concerns` links. Publishing steps should be tasks generated by the workflow, not a separate checklist table (C20)                                                                                                                                                                                                                                                  |
| Publishing is a workflow applied to a book                  | ✅ path clear        | Kits/templates pattern; C15 first                                                                                                                                                                                                                                                                                                                                                              |
| Formatting operates on the clean manuscript                 | ✅ path clear        | Renderers read; formatting settings must be stored per book/edition, never in the text                                                                                                                                                                                                                                                                                                         |
| Collaboration never silently modifies the master manuscript | ✅ by design         | Suggestions as separate rows applied by the author (decision 79). Policy separates `suggest` from `edit`                                                                                                                                                                                                                                                                                       |
| Offline/sync remains possible                               | ⚠ groundwork missing | Fractional positions and optimistic versions help; client ids (C8), a change log (C9) and local unsaved buffers (C5) are the missing groundwork                                                                                                                                                                                                                                                |
| Import/export prevents lock-in                              | ✅                   | Full JSON both ways, DOCX/Markdown out; other imports planned                                                                                                                                                                                                                                                                                                                                  |
| Multiple pen names properly separated                       | ✅                   | Services, connections, exports, search and the audit enforce it. With collaboration, reads must become scope-aware (a collaborator for one pen name) via resource grants                                                                                                                                                                                                                       |
| Life Planner must not expose manuscript information         | ⚠ decide now         | Decide the scope model (C10): personal items owned by the user outside story data; links into a workspace show a neutral label ("Writing: 2 h") unless the viewer can see the book                                                                                                                                                                                                             |

## 12. The Story Object Registry: kinds to define now

Today: `PEN_NAME, SERIES, BOOK, PART, CHAPTER, SCENE, CHARACTER,
RELATIONSHIP, OUTLINE, NOTE, IDEA, TASK, EVENT`.

Adding enum values without tables would break the registry's guarantees
(every kind has a table, an adapter, export/import and passes the
integrity test). Instead, **reserve them in the documentation now**, with
their decisions made, and add each when its feature starts:

| Reserved kind                 | Area       | Identity                      | Lifecycle            | Notes                                                                                                                                                |
| ----------------------------- | ---------- | ----------------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TIMELINE_EVENT` (built, M12) | storyBible | owner (book or series)        | trash                | Built in M12 (decision 109): a position on the timeline and a free-form label; no link to scenes                                                     |
| `PLACE` (built, M15)          | storyBible | column (pen name), series opt | trash                | Built in M15 (decision 113) as `PLACE`; scenes are set in places through `scene_settings` (a dedicated relationship, not `set_in`); no hierarchy yet |
| `WORLD_ENTRY` (built, M15)    | storyBible | column                        | trash                | Built in M15 (decision 113): an author-named type (free text); custom fields as for every kind                                                       |
| `PLOT_THREAD`                 | structure  | owner                         | trash                | Threads across scenes (connections); could replace subplot structures later                                                                          |
| `RESEARCH_ITEM`               | storyBible | shared                        | trash                | Source, citation, file (asset); `about` any                                                                                                          |
| `ASSET`                       | storyBible | shared                        | trash                | Images, files, covers, mood-board items (object storage); Inspiration = assets + ideas                                                               |
| `EDITION` (Publishing)        | manuscript | column (pen name)             | archive              | Format, ISBN, release date (a `RELEASE` calendar entry about it), retailers                                                                          |
| `CAMPAIGN` (Marketing)        | planning   | column                        | trash                | Launches, promotions; its steps are tasks and dated entries                                                                                          |
| `BEAT` (if C14 says yes)      | structure  | owner                         | (with its structure) | Today a structure's child rows                                                                                                                       |

Deliberately **not** story objects: comments, suggestions and annotations
(they annotate nodes and text); publishing workflows (a template applied
to a book, producing tasks and dates); revisions, writing sessions,
templates, kits, field definitions (infrastructure); business records
(sales, expenses: their own ledger, linked to editions).

## 13. Proposed order

A short **Safety & Readiness** milestone before any v1.1 feature:

| #   | Recommendation                                       | Size     |
| --- | ---------------------------------------------------- | -------- |
| C2  | Big-change checkpoints for scene and note text       | Small    |
| C3  | Version history for other long creative text         | Medium   |
| C4  | Stale-edit protection on metadata updates            | Small    |
| C5  | Local unsaved-text buffer in the editor              | Small    |
| C12 | Content format version on versioned objects          | Small    |
| C19 | Green / Yellow / Red levels in Change Impact reports | Small    |
| C6  | Annotation anchor model (decision + ADR, no feature) | Decision |
| C10 | Life Planner scope model (decision + ADR)            | Decision |
| C11 | Co-authoring workspace model (decision + ADR)        | Decision |
| C14 | Beats as nodes or not (decision + ADR)               | Decision |
| §12 | Reserved kinds recorded in ARCHITECTURE.md           | Docs     |

Then with their features: C8/C9 (with offline or collaboration), C13 (with
the first typed field), C15 (with Publishing), C16 (with tags), C17 (when
a workspace passes ~500k words, or with the next search work), C18 (with a
retention setting the author controls), C20 (with Publishing), C7 (restore
drill now; scheduled backups with jobs), C1 (process).
