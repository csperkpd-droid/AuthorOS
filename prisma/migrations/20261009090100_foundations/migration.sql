-- ─── UUIDv7 in SQL, for data migrations ─────────────────────────────────────
-- 48-bit Unix milliseconds, then random bits (version 7, RFC 4122 variant).
CREATE FUNCTION "uuidv7"() RETURNS uuid AS $$
  SELECT encode(
    set_bit(set_bit(
      overlay(uuid_send(gen_random_uuid())
        PLACING substring(int8send(floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint) FROM 3)
        FROM 1 FOR 6),
      52, 1), 53, 1),
    'hex')::uuid;
$$ LANGUAGE sql VOLATILE;

-- ─── Pen names are story nodes ──────────────────────────────────────────────
-- Existing pen names keep their ids; each gets its node.
INSERT INTO "story_nodes" ("id", "workspace_id", "kind", "created_at")
SELECT "id", "workspace_id", 'PEN_NAME', "created_at" FROM "pen_names";

ALTER TABLE "pen_names" ADD CONSTRAINT "pen_names_id_workspace_id_fkey"
  FOREIGN KEY ("id", "workspace_id") REFERENCES "story_nodes"("id", "workspace_id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TRIGGER "pen_names_node_kind" BEFORE INSERT OR UPDATE OF "id" ON "pen_names"
  FOR EACH ROW EXECUTE FUNCTION "story_node_kind_matches"('PEN_NAME');
CREATE TRIGGER "pen_names_delete_node" AFTER DELETE ON "pen_names"
  FOR EACH ROW EXECUTE FUNCTION "delete_story_node"();

-- ─── Dates live in one place: calendar entries ──────────────────────────────
CREATE TYPE "calendar_purpose" AS ENUM ('EVENT', 'DEADLINE');

ALTER TABLE "calendar_events"
  ADD COLUMN "purpose" "calendar_purpose" NOT NULL DEFAULT 'EVENT',
  ADD COLUMN "subject_id" UUID;

CREATE INDEX "calendar_events_subject_id_idx" ON "calendar_events"("subject_id");

ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_subject_id_fkey"
  FOREIGN KEY ("subject_id") REFERENCES "story_nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A deadline always belongs to something; one live deadline per object.
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_deadline_has_subject"
  CHECK ("purpose" <> 'DEADLINE' OR "subject_id" IS NOT NULL);
CREATE UNIQUE INDEX "calendar_events_one_deadline_per_subject"
  ON "calendar_events" ("subject_id")
  WHERE "purpose" = 'DEADLINE' AND "deleted_at" IS NULL;

-- A subject is in the same workspace as its entry.
CREATE FUNCTION "calendar_subject_same_workspace"() RETURNS trigger AS $$
BEGIN
  IF NEW."subject_id" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "story_nodes"
    WHERE "id" = NEW."subject_id" AND "workspace_id" = NEW."workspace_id"
  ) THEN
    RAISE EXCEPTION 'calendar entry % is about a node of another workspace', NEW."id";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "calendar_events_subject_workspace"
  BEFORE INSERT OR UPDATE OF "subject_id", "workspace_id" ON "calendar_events"
  FOR EACH ROW EXECUTE FUNCTION "calendar_subject_same_workspace"();

-- Book due dates become deadline entries about the book (data kept).
CREATE TEMPORARY TABLE "book_deadlines" ON COMMIT DROP AS
SELECT "uuidv7"() AS "event_id", "id" AS "book_id", "workspace_id", "due_on"
FROM "books" WHERE "due_on" IS NOT NULL;

INSERT INTO "story_nodes" ("id", "workspace_id", "kind")
SELECT "event_id", "workspace_id", 'EVENT' FROM "book_deadlines";

INSERT INTO "calendar_events"
  ("id", "workspace_id", "title", "starts_on", "purpose", "subject_id", "updated_at")
SELECT "event_id", "workspace_id", 'Deadline', "due_on", 'DEADLINE', "book_id", now()
FROM "book_deadlines";

ALTER TABLE "books" DROP COLUMN "due_on";
