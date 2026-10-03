-- ─── Version history sources (not used in this migration) ───────────────────
ALTER TYPE "revision_source" ADD VALUE IF NOT EXISTS 'BEFORE_LARGE_EDIT';
ALTER TYPE "revision_source" ADD VALUE IF NOT EXISTS 'BEFORE_EDIT';

-- ─── Writing status, separate from publication ──────────────────────────────
CREATE TYPE "writing_status" AS ENUM (
  'IDEA', 'PLANNING', 'DRAFTING', 'DRAFTED', 'REVISING', 'EDITING', 'PROOFREADING', 'COMPLETE'
);
ALTER TABLE "books" ADD COLUMN "writing_status" "writing_status" NOT NULL DEFAULT 'PLANNING';
UPDATE "books" SET "writing_status" = CASE "status"::text
  WHEN 'PLANNING' THEN 'PLANNING'
  WHEN 'DRAFTING' THEN 'DRAFTING'
  WHEN 'REVISING' THEN 'REVISING'
  ELSE 'COMPLETE' -- COMPLETE, and PUBLISHED (the writing was complete)
END::"writing_status";

-- "Published" is not a writing status. Nothing is lost: each workspace with
-- published books gets a "Publication status" field on books, and those
-- books the value "Published", until editions carry it (Publishing).
-- (No temporary tables: statements here may each commit on their own.)
INSERT INTO "field_definitions" ("id", "workspace_id", "node_kind", "label", "type", "position")
SELECT "uuidv7"(), w."workspace_id", 'BOOK', 'Publication status', 'TEXT', 'a0'
FROM (SELECT DISTINCT "workspace_id" FROM "books" WHERE "status"::text = 'PUBLISHED') w
ON CONFLICT DO NOTHING;

INSERT INTO "node_field_values" ("workspace_id", "node_id", "field_id", "value", "updated_at")
SELECT b."workspace_id", b."id", f."id", 'Published', now()
FROM "books" b
JOIN "field_definitions" f
  ON f."workspace_id" = b."workspace_id" AND f."node_kind" = 'BOOK'
 AND f."pen_name_id" IS NULL AND f."series_id" IS NULL AND f."book_id" IS NULL
 AND lower(f."label") = 'publication status'
WHERE b."status"::text = 'PUBLISHED'
ON CONFLICT DO NOTHING;

ALTER TABLE "books" DROP COLUMN "status";
DROP TYPE "book_status";

-- ─── Document format versions ───────────────────────────────────────────────
ALTER TABLE "scenes" ADD COLUMN "content_format" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "notes" ADD COLUMN "body_format" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "content_revisions" ADD COLUMN "content_format" INTEGER NOT NULL DEFAULT 1;

-- ─── Field history: earlier values of long-form text fields ─────────────────
CREATE TABLE "field_revisions" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "node_id" UUID NOT NULL,
    "field" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "source" "revision_source" NOT NULL,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "field_revisions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "field_revisions_node_id_field_created_at_idx"
  ON "field_revisions"("node_id", "field", "created_at" DESC);
ALTER TABLE "field_revisions" ADD CONSTRAINT "field_revisions_node_id_workspace_id_fkey"
  FOREIGN KEY ("node_id", "workspace_id") REFERENCES "story_nodes"("id", "workspace_id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "field_revisions" ADD CONSTRAINT "field_revisions_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "field_revisions" ADD CONSTRAINT "field_revisions_field_format"
  CHECK (char_length("field") BETWEEN 1 AND 200);
