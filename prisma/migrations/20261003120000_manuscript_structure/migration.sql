-- CreateEnum
CREATE TYPE "story_node_kind" AS ENUM ('SERIES', 'BOOK', 'PART', 'CHAPTER', 'SCENE');

-- CreateEnum
CREATE TYPE "book_status" AS ENUM ('PLANNING', 'DRAFTING', 'REVISING', 'COMPLETE', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "scene_status" AS ENUM ('OUTLINED', 'DRAFT', 'REVISED', 'FINAL');

-- CreateEnum
CREATE TYPE "revision_source" AS ENUM ('AUTOSAVE', 'MANUAL', 'BEFORE_RESTORE', 'AI_ACCEPTED', 'IMPORT');

-- AlterTable (hand-edited: rename, not drop + add, so no data is lost)
-- Pen names are archived rather than deleted.
DROP INDEX "pen_names_one_default_per_workspace";
ALTER TABLE "pen_names" RENAME COLUMN "deleted_at" TO "archived_at";

-- AlterTable
ALTER TABLE "workspace_members" ADD COLUMN     "active_pen_name_id" UUID;

-- CreateTable
CREATE TABLE "story_nodes" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "kind" "story_node_kind" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "story_nodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "series" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "pen_name_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "series_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "books" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "pen_name_id" UUID NOT NULL,
    "series_id" UUID,
    "series_position" TEXT COLLATE "C",
    "title" TEXT NOT NULL,
    "subtitle" TEXT,
    "description" TEXT,
    "status" "book_status" NOT NULL DEFAULT 'PLANNING',
    "target_word_count" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "books_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parts" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "book_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "position" TEXT COLLATE "C" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "parts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chapters" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "book_id" UUID NOT NULL,
    "part_id" UUID,
    "title" TEXT NOT NULL,
    "position" TEXT COLLATE "C" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "chapters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scenes" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "book_id" UUID NOT NULL,
    "chapter_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "position" TEXT COLLATE "C" NOT NULL,
    "status" "scene_status" NOT NULL DEFAULT 'DRAFT',
    "synopsis" TEXT,
    "content" JSONB,
    "content_text" TEXT NOT NULL DEFAULT '',
    "word_count" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "scenes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scene_revisions" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "scene_id" UUID NOT NULL,
    "content" JSONB,
    "content_text" TEXT NOT NULL,
    "word_count" INTEGER NOT NULL,
    "source" "revision_source" NOT NULL,
    "label" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scene_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "story_nodes_workspace_id_kind_idx" ON "story_nodes"("workspace_id", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "story_nodes_id_workspace_id_key" ON "story_nodes"("id", "workspace_id");

-- CreateIndex
CREATE INDEX "series_workspace_id_idx" ON "series"("workspace_id");

-- CreateIndex
CREATE INDEX "series_pen_name_id_idx" ON "series"("pen_name_id");

-- CreateIndex
CREATE UNIQUE INDEX "series_id_workspace_id_key" ON "series"("id", "workspace_id");

-- CreateIndex
CREATE INDEX "books_workspace_id_idx" ON "books"("workspace_id");

-- CreateIndex
CREATE INDEX "books_pen_name_id_idx" ON "books"("pen_name_id");

-- CreateIndex
CREATE INDEX "books_series_id_idx" ON "books"("series_id");

-- CreateIndex
CREATE UNIQUE INDEX "books_id_workspace_id_key" ON "books"("id", "workspace_id");

-- CreateIndex
CREATE INDEX "parts_book_id_idx" ON "parts"("book_id");

-- CreateIndex
CREATE UNIQUE INDEX "parts_id_workspace_id_key" ON "parts"("id", "workspace_id");

-- CreateIndex
CREATE UNIQUE INDEX "parts_id_book_id_key" ON "parts"("id", "book_id");

-- CreateIndex
CREATE INDEX "chapters_book_id_idx" ON "chapters"("book_id");

-- CreateIndex
CREATE INDEX "chapters_part_id_idx" ON "chapters"("part_id");

-- CreateIndex
CREATE UNIQUE INDEX "chapters_id_workspace_id_key" ON "chapters"("id", "workspace_id");

-- CreateIndex
CREATE UNIQUE INDEX "chapters_id_book_id_key" ON "chapters"("id", "book_id");

-- CreateIndex
CREATE INDEX "scenes_book_id_idx" ON "scenes"("book_id");

-- CreateIndex
CREATE INDEX "scenes_chapter_id_idx" ON "scenes"("chapter_id");

-- CreateIndex
CREATE UNIQUE INDEX "scenes_id_workspace_id_key" ON "scenes"("id", "workspace_id");

-- CreateIndex
CREATE INDEX "scene_revisions_scene_id_created_at_idx" ON "scene_revisions"("scene_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "pen_names_id_workspace_id_key" ON "pen_names"("id", "workspace_id");

-- AddForeignKey
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_active_pen_name_id_fkey" FOREIGN KEY ("active_pen_name_id") REFERENCES "pen_names"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "story_nodes" ADD CONSTRAINT "story_nodes_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "series" ADD CONSTRAINT "series_id_workspace_id_fkey" FOREIGN KEY ("id", "workspace_id") REFERENCES "story_nodes"("id", "workspace_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "series" ADD CONSTRAINT "series_pen_name_id_workspace_id_fkey" FOREIGN KEY ("pen_name_id", "workspace_id") REFERENCES "pen_names"("id", "workspace_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "books" ADD CONSTRAINT "books_id_workspace_id_fkey" FOREIGN KEY ("id", "workspace_id") REFERENCES "story_nodes"("id", "workspace_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "books" ADD CONSTRAINT "books_pen_name_id_workspace_id_fkey" FOREIGN KEY ("pen_name_id", "workspace_id") REFERENCES "pen_names"("id", "workspace_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "books" ADD CONSTRAINT "books_series_id_fkey" FOREIGN KEY ("series_id") REFERENCES "series"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parts" ADD CONSTRAINT "parts_id_workspace_id_fkey" FOREIGN KEY ("id", "workspace_id") REFERENCES "story_nodes"("id", "workspace_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parts" ADD CONSTRAINT "parts_book_id_workspace_id_fkey" FOREIGN KEY ("book_id", "workspace_id") REFERENCES "books"("id", "workspace_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chapters" ADD CONSTRAINT "chapters_id_workspace_id_fkey" FOREIGN KEY ("id", "workspace_id") REFERENCES "story_nodes"("id", "workspace_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chapters" ADD CONSTRAINT "chapters_book_id_workspace_id_fkey" FOREIGN KEY ("book_id", "workspace_id") REFERENCES "books"("id", "workspace_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chapters" ADD CONSTRAINT "chapters_part_id_fkey" FOREIGN KEY ("part_id") REFERENCES "parts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scenes" ADD CONSTRAINT "scenes_id_workspace_id_fkey" FOREIGN KEY ("id", "workspace_id") REFERENCES "story_nodes"("id", "workspace_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scenes" ADD CONSTRAINT "scenes_book_id_workspace_id_fkey" FOREIGN KEY ("book_id", "workspace_id") REFERENCES "books"("id", "workspace_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scenes" ADD CONSTRAINT "scenes_chapter_id_book_id_fkey" FOREIGN KEY ("chapter_id", "book_id") REFERENCES "chapters"("id", "book_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scene_revisions" ADD CONSTRAINT "scene_revisions_scene_id_workspace_id_fkey" FOREIGN KEY ("scene_id", "workspace_id") REFERENCES "scenes"("id", "workspace_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scene_revisions" ADD CONSTRAINT "scene_revisions_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ─── Hand-written below: constraints Prisma cannot express ────────────────

-- Pen names: at most one default per workspace, and the default cannot be archived.
CREATE UNIQUE INDEX "pen_names_one_default_per_workspace"
  ON "pen_names" ("workspace_id")
  WHERE "is_default";
ALTER TABLE "pen_names" ADD CONSTRAINT "pen_names_default_not_archived"
  CHECK (NOT ("is_default" AND "archived_at" IS NOT NULL));

-- A book has a series position exactly when it belongs to a series.
ALTER TABLE "books" ADD CONSTRAINT "books_series_position_matches_series"
  CHECK (("series_id" IS NULL) = ("series_position" IS NULL));

-- Story graph integrity.
-- 1. A typed row must point at a story node of the matching kind.
CREATE FUNCTION "story_node_kind_matches"() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "story_nodes"
    WHERE "id" = NEW."id" AND "kind" = TG_ARGV[0]::"story_node_kind"
  ) THEN
    RAISE EXCEPTION 'story node % is not of kind %', NEW."id", TG_ARGV[0];
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 2. Deleting a typed row (directly or by cascade) deletes its story node,
--    so the graph never holds orphaned nodes.
CREATE FUNCTION "delete_story_node"() RETURNS trigger AS $$
BEGIN
  DELETE FROM "story_nodes" WHERE "id" = OLD."id";
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "series_node_kind" BEFORE INSERT OR UPDATE OF "id" ON "series"
  FOR EACH ROW EXECUTE FUNCTION "story_node_kind_matches"('SERIES');
CREATE TRIGGER "books_node_kind" BEFORE INSERT OR UPDATE OF "id" ON "books"
  FOR EACH ROW EXECUTE FUNCTION "story_node_kind_matches"('BOOK');
CREATE TRIGGER "parts_node_kind" BEFORE INSERT OR UPDATE OF "id" ON "parts"
  FOR EACH ROW EXECUTE FUNCTION "story_node_kind_matches"('PART');
CREATE TRIGGER "chapters_node_kind" BEFORE INSERT OR UPDATE OF "id" ON "chapters"
  FOR EACH ROW EXECUTE FUNCTION "story_node_kind_matches"('CHAPTER');
CREATE TRIGGER "scenes_node_kind" BEFORE INSERT OR UPDATE OF "id" ON "scenes"
  FOR EACH ROW EXECUTE FUNCTION "story_node_kind_matches"('SCENE');

CREATE TRIGGER "series_delete_node" AFTER DELETE ON "series"
  FOR EACH ROW EXECUTE FUNCTION "delete_story_node"();
CREATE TRIGGER "books_delete_node" AFTER DELETE ON "books"
  FOR EACH ROW EXECUTE FUNCTION "delete_story_node"();
CREATE TRIGGER "parts_delete_node" AFTER DELETE ON "parts"
  FOR EACH ROW EXECUTE FUNCTION "delete_story_node"();
CREATE TRIGGER "chapters_delete_node" AFTER DELETE ON "chapters"
  FOR EACH ROW EXECUTE FUNCTION "delete_story_node"();
CREATE TRIGGER "scenes_delete_node" AFTER DELETE ON "scenes"
  FOR EACH ROW EXECUTE FUNCTION "delete_story_node"();
