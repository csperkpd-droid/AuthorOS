-- M13 Tropes (decision 110): tropes become shared story objects, linked to
-- books, series, relationships and structures by `uses_trope` connections.
-- The temporary `books.tropes` text array is migrated into them, then
-- dropped, so it is no longer a second source of truth.

CREATE TABLE "tropes" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "tropes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "tropes_workspace_id_idx" ON "tropes"("workspace_id");
CREATE UNIQUE INDEX "tropes_id_workspace_id_key" ON "tropes"("id", "workspace_id");
ALTER TABLE "tropes" ADD CONSTRAINT "tropes_id_workspace_id_fkey" FOREIGN KEY ("id", "workspace_id") REFERENCES "story_nodes"("id", "workspace_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tropes" ADD CONSTRAINT "tropes_name_not_blank" CHECK (btrim("name") <> '' AND char_length("name") <= 200);

-- One live trope per name in a workspace, ignoring case and surrounding spaces.
CREATE UNIQUE INDEX "tropes_unique_live_name"
  ON "tropes" ("workspace_id", lower(btrim("name"))) WHERE "deleted_at" IS NULL;

-- Story-node integrity (functions from manuscript_structure).
CREATE TRIGGER "tropes_node_kind" BEFORE INSERT OR UPDATE OF "id" ON "tropes"
  FOR EACH ROW EXECUTE FUNCTION "story_node_kind_matches"('TROPE');
CREATE TRIGGER "tropes_delete_node" AFTER DELETE ON "tropes"
  FOR EACH ROW EXECUTE FUNCTION "delete_story_node"();

-- ── Migrate books.tropes ────────────────────────────────────────────────────
-- Every non-blank value, trimmed; values equal ignoring case are one trope
-- per workspace, named by the most used spelling (ties: the first in
-- byte order, as the import upgrade). Every book keeps each of its tropes as a `uses_trope` link.
CREATE TEMP TABLE "m13_book_tropes" AS
SELECT DISTINCT b."workspace_id", b."id" AS book_id,
       btrim(t.value) AS name, lower(btrim(t.value)) AS key
  FROM "books" b, unnest(b."tropes") AS t(value)
 WHERE btrim(t.value) <> '';

CREATE TEMP TABLE "m13_tropes" AS
SELECT uuidv7() AS id, "workspace_id", key,
       left(mode() WITHIN GROUP (ORDER BY name COLLATE "C"), 200) AS name
  FROM "m13_book_tropes"
 GROUP BY "workspace_id", key;

INSERT INTO "story_nodes" ("id", "workspace_id", "kind")
SELECT id, "workspace_id", 'TROPE' FROM "m13_tropes";

INSERT INTO "tropes" ("id", "workspace_id", "name", "updated_at")
SELECT id, "workspace_id", name, CURRENT_TIMESTAMP FROM "m13_tropes";

INSERT INTO "connections" ("id", "workspace_id", "source_id", "target_id", "kind", "attributes", "updated_at")
SELECT DISTINCT ON (bt.book_id, t.id) uuidv7(), bt."workspace_id", bt.book_id, t.id, 'uses_trope', '{}'::jsonb, CURRENT_TIMESTAMP
  FROM "m13_book_tropes" bt
  JOIN "m13_tropes" t ON t."workspace_id" = bt."workspace_id" AND t.key = bt.key;

ALTER TABLE "books" DROP COLUMN "tropes";

DROP TABLE "m13_tropes";
DROP TABLE "m13_book_tropes";
