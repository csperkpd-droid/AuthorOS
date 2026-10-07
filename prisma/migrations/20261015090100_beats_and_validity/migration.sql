-- M14 Beats, Beat Assignments and Validity (decisions 90 and 112).
--
-- Every existing beat becomes a Story Graph object with its id kept, and
-- every existing placement becomes a Beat Assignment with its identity
-- (beat, scene) kept. Nothing is removed, restored or rebuilt: the tables are
-- renamed and extended in place. Each existing placement's validity is
-- derived from the data as it is now, by the same rules that apply from
-- then on (end of this file). The description history of beats
-- ("beat:<id>.description" on the structure) moves onto each beat.

-- ── Beats ───────────────────────────────────────────────────────────────────
ALTER TABLE "outline_beats" RENAME TO "beats";
ALTER TABLE "beats" RENAME CONSTRAINT "outline_beats_pkey" TO "beats_pkey";
ALTER INDEX "outline_beats_id_workspace_id_key" RENAME TO "beats_id_workspace_id_key";
ALTER INDEX "outline_beats_outline_id_idx" RENAME TO "beats_outline_id_idx";
ALTER TABLE "beats" RENAME CONSTRAINT "outline_beats_target_percent_range" TO "beats_target_percent_range";
ALTER TABLE "beats" RENAME CONSTRAINT "outline_beats_book_id_fkey" TO "beats_book_id_fkey";
ALTER TABLE "beats" RENAME CONSTRAINT "outline_beats_outline_id_workspace_id_fkey" TO "beats_outline_id_workspace_id_fkey";
ALTER TABLE "beats" RENAME CONSTRAINT "outline_beats_template_beat_id_fkey" TO "beats_template_beat_id_fkey";

-- One story node per existing beat, with the beat's own id.
INSERT INTO "story_nodes" ("id", "workspace_id", "kind")
SELECT "id", "workspace_id", 'BEAT' FROM "beats";

ALTER TABLE "beats" ADD CONSTRAINT "beats_id_workspace_id_fkey" FOREIGN KEY ("id", "workspace_id") REFERENCES "story_nodes"("id", "workspace_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Story-node integrity (functions from manuscript_structure).
CREATE TRIGGER "beats_node_kind" BEFORE INSERT OR UPDATE OF "id" ON "beats"
  FOR EACH ROW EXECUTE FUNCTION "story_node_kind_matches"('BEAT');
CREATE TRIGGER "beats_delete_node" AFTER DELETE ON "beats"
  FOR EACH ROW EXECUTE FUNCTION "delete_story_node"();

-- Description history moves from the structure onto the beat it describes.
UPDATE "field_revisions" r
   SET "node_id" = b."id", "field" = 'description'
  FROM "beats" b
 WHERE r."workspace_id" = b."workspace_id"
   AND r."node_id" = b."outline_id"
   AND r."field" = 'beat:' || b."id"::text || '.description';

-- ── Beat Assignments and the validity vocabulary ────────────────────────────
CREATE TYPE "validity_state" AS ENUM (
  'CURRENT', 'POTENTIALLY_STALE', 'CONFLICTED', 'INVALID', 'SUPERSEDED', 'UNKNOWN',
  'INTENTIONALLY_EXCEPTED'
);

ALTER TABLE "beat_scenes" RENAME TO "beat_assignments";
ALTER TABLE "beat_assignments" RENAME CONSTRAINT "beat_scenes_pkey" TO "beat_assignments_pkey";
ALTER INDEX "beat_scenes_scene_id_idx" RENAME TO "beat_assignments_scene_id_idx";
ALTER TABLE "beat_assignments" RENAME CONSTRAINT "beat_scenes_beat_id_workspace_id_fkey" TO "beat_assignments_beat_id_workspace_id_fkey";
ALTER TABLE "beat_assignments" RENAME CONSTRAINT "beat_scenes_scene_id_workspace_id_fkey" TO "beat_assignments_scene_id_workspace_id_fkey";

-- New placements start Current; existing ones are backfilled below from
-- their actual state (decision 112).
ALTER TABLE "beat_assignments"
  ADD COLUMN "validity" "validity_state" NOT NULL DEFAULT 'CURRENT',
  ADD COLUMN "excepted_at" TIMESTAMP(3),
  ADD COLUMN "note" TEXT;
ALTER TABLE "beat_assignments" ADD CONSTRAINT "beat_assignments_note_length"
  CHECK ("note" IS NULL OR char_length("note") <= 2000);

-- ── Validity follows the scene ──────────────────────────────────────────────
-- Re-evaluates the assignments of these scenes, by exactly the M14 rules:
--   the scene (or what contains it) is in the Trash → Potentially Stale;
--   it no longer belongs to the structure's book or series → Conflicted,
--     or Intentionally Excepted when the author chose to keep it;
--   otherwise → Current (and the author's exception is no longer needed).
-- Nothing is removed, moved or re-placed; only the state changes.
CREATE FUNCTION "evaluate_beat_assignments"(scene_ids uuid[]) RETURNS void
LANGUAGE sql AS $$
  WITH state AS (
    SELECT a."beat_id", a."scene_id",
           (s."deleted_at" IS NULL AND c."deleted_at" IS NULL
             AND (p."id" IS NULL OR p."deleted_at" IS NULL)
             AND bk."deleted_at" IS NULL
             AND (sr."id" IS NULL OR sr."deleted_at" IS NULL)) AS live,
           coalesce(CASE WHEN o."series_id" IS NOT NULL THEN bk."series_id" = o."series_id"
                         ELSE s."book_id" = o."book_id" END, false) AS fits
      FROM "beat_assignments" a
      JOIN "scenes" s ON s."id" = a."scene_id"
      JOIN "chapters" c ON c."id" = s."chapter_id"
      LEFT JOIN "parts" p ON p."id" = c."part_id"
      JOIN "books" bk ON bk."id" = s."book_id"
      LEFT JOIN "series" sr ON sr."id" = bk."series_id"
      JOIN "beats" bt ON bt."id" = a."beat_id"
      JOIN "outlines" o ON o."id" = bt."outline_id"
     WHERE a."scene_id" = ANY(scene_ids)
  ), next AS (
    SELECT st."beat_id", st."scene_id",
           CASE WHEN NOT st.live THEN 'POTENTIALLY_STALE'
                WHEN NOT st.fits AND a."excepted_at" IS NOT NULL THEN 'INTENTIONALLY_EXCEPTED'
                WHEN NOT st.fits THEN 'CONFLICTED'
                ELSE 'CURRENT' END::"validity_state" AS validity,
           CASE WHEN st.live AND st.fits THEN NULL ELSE a."excepted_at" END AS excepted_at
      FROM state st
      JOIN "beat_assignments" a ON a."beat_id" = st."beat_id" AND a."scene_id" = st."scene_id"
  )
  UPDATE "beat_assignments" a
     SET "validity" = n.validity, "excepted_at" = n.excepted_at
    FROM next n
   WHERE a."beat_id" = n."beat_id" AND a."scene_id" = n."scene_id"
     AND (a."validity", a."excepted_at") IS DISTINCT FROM (n.validity, n.excepted_at);
$$;

-- When a scene, or anything that contains it, is trashed, restored or moved
-- (a book joining or leaving a series), its assignments are re-evaluated in
-- the same transaction, whatever made the change (binder, Trash, Change
-- Impact, import).
CREATE FUNCTION "beat_assignments_follow"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM "evaluate_beat_assignments"(CASE TG_TABLE_NAME
    WHEN 'scenes' THEN ARRAY[NEW."id"]
    WHEN 'chapters' THEN ARRAY(SELECT s."id" FROM "scenes" s WHERE s."chapter_id" = NEW."id")
    WHEN 'parts' THEN ARRAY(
      SELECT s."id" FROM "scenes" s JOIN "chapters" c ON c."id" = s."chapter_id"
       WHERE c."part_id" = NEW."id")
    WHEN 'books' THEN ARRAY(SELECT s."id" FROM "scenes" s WHERE s."book_id" = NEW."id")
    WHEN 'series' THEN ARRAY(
      SELECT s."id" FROM "scenes" s JOIN "books" b ON b."id" = s."book_id"
       WHERE b."series_id" = NEW."id")
  END);
  RETURN NULL;
END;
$$;

CREATE TRIGGER "scenes_beat_validity" AFTER UPDATE OF "deleted_at", "chapter_id", "book_id" ON "scenes"
  FOR EACH ROW WHEN (OLD."deleted_at" IS DISTINCT FROM NEW."deleted_at"
                     OR OLD."chapter_id" IS DISTINCT FROM NEW."chapter_id"
                     OR OLD."book_id" IS DISTINCT FROM NEW."book_id")
  EXECUTE FUNCTION "beat_assignments_follow"();
CREATE TRIGGER "chapters_beat_validity" AFTER UPDATE OF "deleted_at", "part_id" ON "chapters"
  FOR EACH ROW WHEN (OLD."deleted_at" IS DISTINCT FROM NEW."deleted_at"
                     OR OLD."part_id" IS DISTINCT FROM NEW."part_id")
  EXECUTE FUNCTION "beat_assignments_follow"();
CREATE TRIGGER "parts_beat_validity" AFTER UPDATE OF "deleted_at" ON "parts"
  FOR EACH ROW WHEN (OLD."deleted_at" IS DISTINCT FROM NEW."deleted_at")
  EXECUTE FUNCTION "beat_assignments_follow"();
CREATE TRIGGER "books_beat_validity" AFTER UPDATE OF "deleted_at", "series_id" ON "books"
  FOR EACH ROW WHEN (OLD."deleted_at" IS DISTINCT FROM NEW."deleted_at"
                     OR OLD."series_id" IS DISTINCT FROM NEW."series_id")
  EXECUTE FUNCTION "beat_assignments_follow"();
CREATE TRIGGER "series_beat_validity" AFTER UPDATE OF "deleted_at" ON "series"
  FOR EACH ROW WHEN (OLD."deleted_at" IS DISTINCT FROM NEW."deleted_at")
  EXECUTE FUNCTION "beat_assignments_follow"();

-- ── Backfill: each existing placement's validity from its actual state ─────
-- The same rules as above, from the scenes, chapters, parts, books, series
-- and structures as they are: scene (or what contains it) in the Trash →
-- Potentially Stale; scene's book outside the structure's book or series →
-- Conflicted; otherwise Current. Every placement's scene, book, beat and
-- structure exist (foreign keys) and a structure belongs to exactly one book
-- or series (CHECK), so every state can be established: none is Unknown.
-- No exception is invented (excepted_at stays null), no scene is restored,
-- no placement removed. Running it again changes nothing.
SELECT "evaluate_beat_assignments"(ARRAY(SELECT DISTINCT "scene_id" FROM "beat_assignments"));
