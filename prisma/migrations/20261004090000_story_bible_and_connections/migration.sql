-- CreateEnum
CREATE TYPE "character_role" AS ENUM ('PROTAGONIST', 'ANTAGONIST', 'LOVE_INTEREST', 'SUPPORTING', 'MINOR');

-- CreateEnum
CREATE TYPE "idea_status" AS ENUM ('OPEN', 'USED', 'ARCHIVED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "story_node_kind" ADD VALUE 'CHARACTER';
ALTER TYPE "story_node_kind" ADD VALUE 'RELATIONSHIP';
ALTER TYPE "story_node_kind" ADD VALUE 'NOTE';
ALTER TYPE "story_node_kind" ADD VALUE 'IDEA';

-- CreateTable
CREATE TABLE "characters" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "series_id" UUID,
    "name" TEXT NOT NULL,
    "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "role" "character_role" NOT NULL DEFAULT 'SUPPORTING',
    "summary" TEXT,
    "profile" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "characters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "relationships" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "character_a_id" UUID NOT NULL,
    "character_b_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "relationships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notes" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "body" JSONB,
    "body_text" TEXT NOT NULL DEFAULT '',
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ideas" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "status" "idea_status" NOT NULL DEFAULT 'OPEN',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "ideas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "connections" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "source_id" UUID NOT NULL,
    "target_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "label" TEXT,
    "note" TEXT,
    "attributes" JSONB NOT NULL DEFAULT '{}',
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "connections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "characters_workspace_id_idx" ON "characters"("workspace_id");

-- CreateIndex
CREATE INDEX "characters_series_id_idx" ON "characters"("series_id");

-- CreateIndex
CREATE UNIQUE INDEX "characters_id_workspace_id_key" ON "characters"("id", "workspace_id");

-- CreateIndex
CREATE INDEX "relationships_character_b_id_idx" ON "relationships"("character_b_id");

-- CreateIndex
CREATE INDEX "relationships_workspace_id_idx" ON "relationships"("workspace_id");

-- CreateIndex
CREATE UNIQUE INDEX "relationships_character_a_id_character_b_id_key" ON "relationships"("character_a_id", "character_b_id");

-- CreateIndex
CREATE UNIQUE INDEX "relationships_id_workspace_id_key" ON "relationships"("id", "workspace_id");

-- CreateIndex
CREATE INDEX "notes_workspace_id_idx" ON "notes"("workspace_id");

-- CreateIndex
CREATE UNIQUE INDEX "notes_id_workspace_id_key" ON "notes"("id", "workspace_id");

-- CreateIndex
CREATE INDEX "ideas_workspace_id_idx" ON "ideas"("workspace_id");

-- CreateIndex
CREATE UNIQUE INDEX "ideas_id_workspace_id_key" ON "ideas"("id", "workspace_id");

-- CreateIndex
CREATE INDEX "connections_target_id_idx" ON "connections"("target_id");

-- CreateIndex
CREATE INDEX "connections_workspace_id_kind_idx" ON "connections"("workspace_id", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "connections_source_id_target_id_kind_key" ON "connections"("source_id", "target_id", "kind");

-- AddForeignKey
ALTER TABLE "characters" ADD CONSTRAINT "characters_id_workspace_id_fkey" FOREIGN KEY ("id", "workspace_id") REFERENCES "story_nodes"("id", "workspace_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "characters" ADD CONSTRAINT "characters_series_id_fkey" FOREIGN KEY ("series_id") REFERENCES "series"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "relationships" ADD CONSTRAINT "relationships_id_workspace_id_fkey" FOREIGN KEY ("id", "workspace_id") REFERENCES "story_nodes"("id", "workspace_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "relationships" ADD CONSTRAINT "relationships_character_a_id_workspace_id_fkey" FOREIGN KEY ("character_a_id", "workspace_id") REFERENCES "characters"("id", "workspace_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "relationships" ADD CONSTRAINT "relationships_character_b_id_workspace_id_fkey" FOREIGN KEY ("character_b_id", "workspace_id") REFERENCES "characters"("id", "workspace_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notes" ADD CONSTRAINT "notes_id_workspace_id_fkey" FOREIGN KEY ("id", "workspace_id") REFERENCES "story_nodes"("id", "workspace_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ideas" ADD CONSTRAINT "ideas_id_workspace_id_fkey" FOREIGN KEY ("id", "workspace_id") REFERENCES "story_nodes"("id", "workspace_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connections" ADD CONSTRAINT "connections_source_id_workspace_id_fkey" FOREIGN KEY ("source_id", "workspace_id") REFERENCES "story_nodes"("id", "workspace_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connections" ADD CONSTRAINT "connections_target_id_workspace_id_fkey" FOREIGN KEY ("target_id", "workspace_id") REFERENCES "story_nodes"("id", "workspace_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connections" ADD CONSTRAINT "connections_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ─── Hand-written below: constraints Prisma cannot express ────────────────

-- Story graph integrity for the new typed tables (functions from the
-- manuscript_structure migration).
CREATE TRIGGER "characters_node_kind" BEFORE INSERT OR UPDATE OF "id" ON "characters"
  FOR EACH ROW EXECUTE FUNCTION "story_node_kind_matches"('CHARACTER');
CREATE TRIGGER "relationships_node_kind" BEFORE INSERT OR UPDATE OF "id" ON "relationships"
  FOR EACH ROW EXECUTE FUNCTION "story_node_kind_matches"('RELATIONSHIP');
CREATE TRIGGER "notes_node_kind" BEFORE INSERT OR UPDATE OF "id" ON "notes"
  FOR EACH ROW EXECUTE FUNCTION "story_node_kind_matches"('NOTE');
CREATE TRIGGER "ideas_node_kind" BEFORE INSERT OR UPDATE OF "id" ON "ideas"
  FOR EACH ROW EXECUTE FUNCTION "story_node_kind_matches"('IDEA');

CREATE TRIGGER "characters_delete_node" AFTER DELETE ON "characters"
  FOR EACH ROW EXECUTE FUNCTION "delete_story_node"();
CREATE TRIGGER "relationships_delete_node" AFTER DELETE ON "relationships"
  FOR EACH ROW EXECUTE FUNCTION "delete_story_node"();
CREATE TRIGGER "notes_delete_node" AFTER DELETE ON "notes"
  FOR EACH ROW EXECUTE FUNCTION "delete_story_node"();
CREATE TRIGGER "ideas_delete_node" AFTER DELETE ON "ideas"
  FOR EACH ROW EXECUTE FUNCTION "delete_story_node"();

-- A relationship's pair is stored in id order, so (A, B) and (B, A) can't
-- both exist, and a character can't have a relationship with themselves.
ALTER TABLE "relationships" ADD CONSTRAINT "relationships_ordered_pair"
  CHECK ("character_a_id" < "character_b_id");

-- Connections: no self-links; kind is a registry key.
ALTER TABLE "connections" ADD CONSTRAINT "connections_not_self"
  CHECK ("source_id" <> "target_id");
ALTER TABLE "connections" ADD CONSTRAINT "connections_kind_format"
  CHECK ("kind" ~ '^[a-z][a-z_]{0,62}$');
ALTER TABLE "connections" ADD CONSTRAINT "connections_attributes_object"
  CHECK (jsonb_typeof("attributes") = 'object');

-- A scene has at most one point-of-view character.
CREATE UNIQUE INDEX "connections_one_pov_per_scene"
  ON "connections" ("target_id")
  WHERE "kind" = 'appears_in' AND "attributes" ->> 'role' = 'POV';
