-- CreateEnum
CREATE TYPE "heat_level" AS ENUM ('CLEAN', 'CLOSED_DOOR', 'OPEN_DOOR', 'EXPLICIT');

-- CreateEnum
CREATE TYPE "structure_kind" AS ENUM ('PLOT', 'ROMANCE', 'CHARACTER_ARC', 'SUBPLOT', 'CUSTOM');

-- CreateEnum
CREATE TYPE "field_type" AS ENUM ('TEXT', 'LONG_TEXT');

-- AlterEnum
ALTER TYPE "story_node_kind" ADD VALUE 'OUTLINE';

-- DropForeignKey
ALTER TABLE "scene_revisions" DROP CONSTRAINT "scene_revisions_created_by_id_fkey";

-- DropForeignKey
ALTER TABLE "scene_revisions" DROP CONSTRAINT "scene_revisions_scene_id_workspace_id_fkey";

-- AlterTable
ALTER TABLE "books" ADD COLUMN     "heat_level" "heat_level",
ADD COLUMN     "tropes" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
-- Hand-edited: characters get an owning identity. Backfill from the series'
-- pen name, else the workspace default, then require it.
ALTER TABLE "characters" ADD COLUMN "pen_name_id" UUID;
UPDATE "characters" c SET "pen_name_id" = s."pen_name_id"
  FROM "series" s WHERE s."id" = c."series_id";
UPDATE "characters" c SET "pen_name_id" = p."id"
  FROM "pen_names" p
  WHERE c."pen_name_id" IS NULL AND p."workspace_id" = c."workspace_id" AND p."is_default";
ALTER TABLE "characters" ALTER COLUMN "pen_name_id" SET NOT NULL;

-- Hand-edited: rename scene_revisions to content_revisions, keeping every
-- revision. Scene ids are story node ids, so scene_id values are valid node_ids.
ALTER TABLE "scene_revisions" RENAME TO "content_revisions";
ALTER TABLE "content_revisions" RENAME COLUMN "scene_id" TO "node_id";
ALTER TABLE "content_revisions" RENAME CONSTRAINT "scene_revisions_pkey" TO "content_revisions_pkey";

-- CreateTable
CREATE TABLE "structure_templates" (
    "id" UUID NOT NULL,
    "workspace_id" UUID,
    "kind" "structure_kind" NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "source" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "structure_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "template_beats" (
    "id" UUID NOT NULL,
    "template_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "target_percent" INTEGER,
    "position" TEXT COLLATE "C" NOT NULL,

    CONSTRAINT "template_beats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outlines" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "book_id" UUID NOT NULL,
    "kind" "structure_kind" NOT NULL,
    "title" TEXT NOT NULL,
    "template_id" UUID,
    "relationship_id" UUID,
    "character_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "outlines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outline_beats" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "outline_id" UUID NOT NULL,
    "template_beat_id" UUID,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "target_percent" INTEGER,
    "position" TEXT COLLATE "C" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "outline_beats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "beat_scenes" (
    "workspace_id" UUID NOT NULL,
    "beat_id" UUID NOT NULL,
    "scene_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "beat_scenes_pkey" PRIMARY KEY ("beat_id","scene_id")
);

-- CreateTable
CREATE TABLE "field_definitions" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "pen_name_id" UUID,
    "node_kind" "story_node_kind" NOT NULL,
    "label" TEXT NOT NULL,
    "type" "field_type" NOT NULL DEFAULT 'TEXT',
    "position" TEXT COLLATE "C" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "field_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "node_field_values" (
    "workspace_id" UUID NOT NULL,
    "node_id" UUID NOT NULL,
    "field_id" UUID NOT NULL,
    "value" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "node_field_values_pkey" PRIMARY KEY ("node_id","field_id")
);

-- CreateIndex
ALTER INDEX "scene_revisions_scene_id_created_at_idx" RENAME TO "content_revisions_node_id_created_at_idx";

-- CreateIndex
CREATE INDEX "structure_templates_workspace_id_idx" ON "structure_templates"("workspace_id");

-- CreateIndex
CREATE INDEX "template_beats_template_id_idx" ON "template_beats"("template_id");

-- CreateIndex
CREATE INDEX "outlines_book_id_idx" ON "outlines"("book_id");

-- CreateIndex
CREATE INDEX "outlines_relationship_id_idx" ON "outlines"("relationship_id");

-- CreateIndex
CREATE INDEX "outlines_character_id_idx" ON "outlines"("character_id");

-- CreateIndex
CREATE UNIQUE INDEX "outlines_id_workspace_id_key" ON "outlines"("id", "workspace_id");

-- CreateIndex
CREATE INDEX "outline_beats_outline_id_idx" ON "outline_beats"("outline_id");

-- CreateIndex
CREATE UNIQUE INDEX "outline_beats_id_workspace_id_key" ON "outline_beats"("id", "workspace_id");

-- CreateIndex
CREATE INDEX "beat_scenes_scene_id_idx" ON "beat_scenes"("scene_id");

-- CreateIndex
CREATE INDEX "field_definitions_workspace_id_node_kind_idx" ON "field_definitions"("workspace_id", "node_kind");

-- CreateIndex
CREATE UNIQUE INDEX "field_definitions_id_workspace_id_key" ON "field_definitions"("id", "workspace_id");

-- CreateIndex
CREATE INDEX "node_field_values_field_id_idx" ON "node_field_values"("field_id");

-- CreateIndex
CREATE INDEX "characters_pen_name_id_idx" ON "characters"("pen_name_id");

-- AddForeignKey
ALTER TABLE "content_revisions" ADD CONSTRAINT "content_revisions_node_id_workspace_id_fkey" FOREIGN KEY ("node_id", "workspace_id") REFERENCES "story_nodes"("id", "workspace_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_revisions" ADD CONSTRAINT "content_revisions_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "characters" ADD CONSTRAINT "characters_pen_name_id_workspace_id_fkey" FOREIGN KEY ("pen_name_id", "workspace_id") REFERENCES "pen_names"("id", "workspace_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "template_beats" ADD CONSTRAINT "template_beats_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "structure_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outlines" ADD CONSTRAINT "outlines_id_workspace_id_fkey" FOREIGN KEY ("id", "workspace_id") REFERENCES "story_nodes"("id", "workspace_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outlines" ADD CONSTRAINT "outlines_book_id_workspace_id_fkey" FOREIGN KEY ("book_id", "workspace_id") REFERENCES "books"("id", "workspace_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outlines" ADD CONSTRAINT "outlines_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "structure_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outlines" ADD CONSTRAINT "outlines_relationship_id_fkey" FOREIGN KEY ("relationship_id") REFERENCES "relationships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outlines" ADD CONSTRAINT "outlines_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "characters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outline_beats" ADD CONSTRAINT "outline_beats_outline_id_workspace_id_fkey" FOREIGN KEY ("outline_id", "workspace_id") REFERENCES "outlines"("id", "workspace_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outline_beats" ADD CONSTRAINT "outline_beats_template_beat_id_fkey" FOREIGN KEY ("template_beat_id") REFERENCES "template_beats"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "beat_scenes" ADD CONSTRAINT "beat_scenes_beat_id_workspace_id_fkey" FOREIGN KEY ("beat_id", "workspace_id") REFERENCES "outline_beats"("id", "workspace_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "beat_scenes" ADD CONSTRAINT "beat_scenes_scene_id_workspace_id_fkey" FOREIGN KEY ("scene_id", "workspace_id") REFERENCES "scenes"("id", "workspace_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "field_definitions" ADD CONSTRAINT "field_definitions_pen_name_id_fkey" FOREIGN KEY ("pen_name_id") REFERENCES "pen_names"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "node_field_values" ADD CONSTRAINT "node_field_values_node_id_workspace_id_fkey" FOREIGN KEY ("node_id", "workspace_id") REFERENCES "story_nodes"("id", "workspace_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "node_field_values" ADD CONSTRAINT "node_field_values_field_id_workspace_id_fkey" FOREIGN KEY ("field_id", "workspace_id") REFERENCES "field_definitions"("id", "workspace_id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ─── Hand-written below: constraints Prisma cannot express ────────────────

-- Outlines: story-node integrity (functions from manuscript_structure).
CREATE TRIGGER "outlines_node_kind" BEFORE INSERT OR UPDATE OF "id" ON "outlines"
  FOR EACH ROW EXECUTE FUNCTION "story_node_kind_matches"('OUTLINE');
CREATE TRIGGER "outlines_delete_node" AFTER DELETE ON "outlines"
  FOR EACH ROW EXECUTE FUNCTION "delete_story_node"();

-- A romance arc belongs to a relationship; a character arc to a character;
-- other structures to neither.
ALTER TABLE "outlines" ADD CONSTRAINT "outlines_owner_matches_kind" CHECK (
  ("kind" = 'ROMANCE') = ("relationship_id" IS NOT NULL)
  AND ("kind" = 'CHARACTER_ARC') = ("character_id" IS NOT NULL)
);

ALTER TABLE "template_beats" ADD CONSTRAINT "template_beats_target_percent_range"
  CHECK ("target_percent" BETWEEN 0 AND 100);
ALTER TABLE "outline_beats" ADD CONSTRAINT "outline_beats_target_percent_range"
  CHECK ("target_percent" BETWEEN 0 AND 100);

-- Field labels are unique per kind within a workspace and identity scope.
CREATE UNIQUE INDEX "field_definitions_unique_label"
  ON "field_definitions" ("workspace_id", "node_kind", COALESCE("pen_name_id", '00000000-0000-0000-0000-000000000000'::uuid), lower("label"));

-- Built-in structure templates (workspace_id NULL). Fixed ids.
INSERT INTO "structure_templates" ("id", "workspace_id", "kind", "name", "description", "source") VALUES ('00000000-0000-7000-8000-000000000a01', NULL, 'PLOT', 'Three-Act Structure', 'The classic setup, confrontation and resolution.', NULL);
INSERT INTO "template_beats" ("id", "template_id", "title", "description", "target_percent", "position") VALUES ('00000000-0000-7000-8000-0000000b0101', '00000000-0000-7000-8000-000000000a01', 'Setup', 'The ordinary world, the protagonist and what they want.', 0, 'a0');
INSERT INTO "template_beats" ("id", "template_id", "title", "description", "target_percent", "position") VALUES ('00000000-0000-7000-8000-0000000b0102', '00000000-0000-7000-8000-000000000a01', 'Inciting Incident', 'The event that disrupts the ordinary world.', 12, 'a1');
INSERT INTO "template_beats" ("id", "template_id", "title", "description", "target_percent", "position") VALUES ('00000000-0000-7000-8000-0000000b0103', '00000000-0000-7000-8000-000000000a01', 'Plot Point 1', 'The protagonist commits to the story''s central conflict.', 25, 'a2');
INSERT INTO "template_beats" ("id", "template_id", "title", "description", "target_percent", "position") VALUES ('00000000-0000-7000-8000-0000000b0104', '00000000-0000-7000-8000-000000000a01', 'Rising Action', 'Escalating obstacles, allies and enemies.', 37, 'a3');
INSERT INTO "template_beats" ("id", "template_id", "title", "description", "target_percent", "position") VALUES ('00000000-0000-7000-8000-0000000b0105', '00000000-0000-7000-8000-000000000a01', 'Midpoint', 'A reversal or revelation that changes the stakes.', 50, 'a4');
INSERT INTO "template_beats" ("id", "template_id", "title", "description", "target_percent", "position") VALUES ('00000000-0000-7000-8000-0000000b0106', '00000000-0000-7000-8000-000000000a01', 'Plot Point 2', 'The lowest point; everything seems lost.', 75, 'a5');
INSERT INTO "template_beats" ("id", "template_id", "title", "description", "target_percent", "position") VALUES ('00000000-0000-7000-8000-0000000b0107', '00000000-0000-7000-8000-000000000a01', 'Climax', 'The final confrontation.', 88, 'a6');
INSERT INTO "template_beats" ("id", "template_id", "title", "description", "target_percent", "position") VALUES ('00000000-0000-7000-8000-0000000b0108', '00000000-0000-7000-8000-000000000a01', 'Resolution', 'The new normal.', 98, 'a7');
INSERT INTO "structure_templates" ("id", "workspace_id", "kind", "name", "description", "source") VALUES ('00000000-0000-7000-8000-000000000a02', NULL, 'PLOT', 'Save the Cat', 'Fifteen beats from Save the Cat! (adapted for novels by Jessica Brody).', 'Blake Snyder');
INSERT INTO "template_beats" ("id", "template_id", "title", "description", "target_percent", "position") VALUES ('00000000-0000-7000-8000-0000000b0201', '00000000-0000-7000-8000-000000000a02', 'Opening Image', 'A snapshot of the hero''s world before the story.', 1, 'a0');
INSERT INTO "template_beats" ("id", "template_id", "title", "description", "target_percent", "position") VALUES ('00000000-0000-7000-8000-0000000b0202', '00000000-0000-7000-8000-000000000a02', 'Theme Stated', 'Someone states the lesson the hero must learn.', 5, 'a1');
INSERT INTO "template_beats" ("id", "template_id", "title", "description", "target_percent", "position") VALUES ('00000000-0000-7000-8000-0000000b0203', '00000000-0000-7000-8000-000000000a02', 'Setup', 'The hero''s world, flaws and what''s missing.', 5, 'a2');
INSERT INTO "template_beats" ("id", "template_id", "title", "description", "target_percent", "position") VALUES ('00000000-0000-7000-8000-0000000b0204', '00000000-0000-7000-8000-000000000a02', 'Catalyst', 'The life-changing event.', 10, 'a3');
INSERT INTO "template_beats" ("id", "template_id", "title", "description", "target_percent", "position") VALUES ('00000000-0000-7000-8000-0000000b0205', '00000000-0000-7000-8000-000000000a02', 'Debate', 'The hero hesitates.', 15, 'a4');
INSERT INTO "template_beats" ("id", "template_id", "title", "description", "target_percent", "position") VALUES ('00000000-0000-7000-8000-0000000b0206', '00000000-0000-7000-8000-000000000a02', 'Break into Two', 'The hero chooses the new world.', 20, 'a5');
INSERT INTO "template_beats" ("id", "template_id", "title", "description", "target_percent", "position") VALUES ('00000000-0000-7000-8000-0000000b0207', '00000000-0000-7000-8000-000000000a02', 'B Story', 'A new character or relationship that carries the theme.', 22, 'a6');
INSERT INTO "template_beats" ("id", "template_id", "title", "description", "target_percent", "position") VALUES ('00000000-0000-7000-8000-0000000b0208', '00000000-0000-7000-8000-000000000a02', 'Fun and Games', 'The promise of the premise.', 30, 'a7');
INSERT INTO "template_beats" ("id", "template_id", "title", "description", "target_percent", "position") VALUES ('00000000-0000-7000-8000-0000000b0209', '00000000-0000-7000-8000-000000000a02', 'Midpoint', 'A false victory or false defeat; stakes rise.', 50, 'a8');
INSERT INTO "template_beats" ("id", "template_id", "title", "description", "target_percent", "position") VALUES ('00000000-0000-7000-8000-0000000b020a', '00000000-0000-7000-8000-000000000a02', 'Bad Guys Close In', 'Pressure from outside and doubt from within.', 62, 'a9');
INSERT INTO "template_beats" ("id", "template_id", "title", "description", "target_percent", "position") VALUES ('00000000-0000-7000-8000-0000000b020b', '00000000-0000-7000-8000-000000000a02', 'All Is Lost', 'The lowest point.', 75, 'aA');
INSERT INTO "template_beats" ("id", "template_id", "title", "description", "target_percent", "position") VALUES ('00000000-0000-7000-8000-0000000b020c', '00000000-0000-7000-8000-000000000a02', 'Dark Night of the Soul', 'The hero wallows, then finds the lesson.', 78, 'aB');
INSERT INTO "template_beats" ("id", "template_id", "title", "description", "target_percent", "position") VALUES ('00000000-0000-7000-8000-0000000b020d', '00000000-0000-7000-8000-000000000a02', 'Break into Three', 'The solution, combining A and B stories.', 80, 'aC');
INSERT INTO "template_beats" ("id", "template_id", "title", "description", "target_percent", "position") VALUES ('00000000-0000-7000-8000-0000000b020e', '00000000-0000-7000-8000-000000000a02', 'Finale', 'The hero proves they''ve changed.', 90, 'aD');
INSERT INTO "template_beats" ("id", "template_id", "title", "description", "target_percent", "position") VALUES ('00000000-0000-7000-8000-0000000b020f', '00000000-0000-7000-8000-000000000a02', 'Final Image', 'The mirror of the opening image.', 99, 'aE');
INSERT INTO "structure_templates" ("id", "workspace_id", "kind", "name", "description", "source") VALUES ('00000000-0000-7000-8000-000000000a03', NULL, 'PLOT', 'Hero''s Journey', 'Twelve stages of the hero''s journey.', 'Joseph Campbell / Christopher Vogler');
INSERT INTO "template_beats" ("id", "template_id", "title", "description", "target_percent", "position") VALUES ('00000000-0000-7000-8000-0000000b0301', '00000000-0000-7000-8000-000000000a03', 'Ordinary World', NULL, 0, 'a0');
INSERT INTO "template_beats" ("id", "template_id", "title", "description", "target_percent", "position") VALUES ('00000000-0000-7000-8000-0000000b0302', '00000000-0000-7000-8000-000000000a03', 'Call to Adventure', NULL, 10, 'a1');
INSERT INTO "template_beats" ("id", "template_id", "title", "description", "target_percent", "position") VALUES ('00000000-0000-7000-8000-0000000b0303', '00000000-0000-7000-8000-000000000a03', 'Refusal of the Call', NULL, 15, 'a2');
INSERT INTO "template_beats" ("id", "template_id", "title", "description", "target_percent", "position") VALUES ('00000000-0000-7000-8000-0000000b0304', '00000000-0000-7000-8000-000000000a03', 'Meeting the Mentor', NULL, 20, 'a3');
INSERT INTO "template_beats" ("id", "template_id", "title", "description", "target_percent", "position") VALUES ('00000000-0000-7000-8000-0000000b0305', '00000000-0000-7000-8000-000000000a03', 'Crossing the Threshold', NULL, 25, 'a4');
INSERT INTO "template_beats" ("id", "template_id", "title", "description", "target_percent", "position") VALUES ('00000000-0000-7000-8000-0000000b0306', '00000000-0000-7000-8000-000000000a03', 'Tests, Allies, Enemies', NULL, 35, 'a5');
INSERT INTO "template_beats" ("id", "template_id", "title", "description", "target_percent", "position") VALUES ('00000000-0000-7000-8000-0000000b0307', '00000000-0000-7000-8000-000000000a03', 'Approach to the Inmost Cave', NULL, 45, 'a6');
INSERT INTO "template_beats" ("id", "template_id", "title", "description", "target_percent", "position") VALUES ('00000000-0000-7000-8000-0000000b0308', '00000000-0000-7000-8000-000000000a03', 'The Ordeal', NULL, 50, 'a7');
INSERT INTO "template_beats" ("id", "template_id", "title", "description", "target_percent", "position") VALUES ('00000000-0000-7000-8000-0000000b0309', '00000000-0000-7000-8000-000000000a03', 'Reward', NULL, 60, 'a8');
INSERT INTO "template_beats" ("id", "template_id", "title", "description", "target_percent", "position") VALUES ('00000000-0000-7000-8000-0000000b030a', '00000000-0000-7000-8000-000000000a03', 'The Road Back', NULL, 75, 'a9');
INSERT INTO "template_beats" ("id", "template_id", "title", "description", "target_percent", "position") VALUES ('00000000-0000-7000-8000-0000000b030b', '00000000-0000-7000-8000-000000000a03', 'Resurrection', NULL, 90, 'aA');
INSERT INTO "template_beats" ("id", "template_id", "title", "description", "target_percent", "position") VALUES ('00000000-0000-7000-8000-0000000b030c', '00000000-0000-7000-8000-000000000a03', 'Return with the Elixir', NULL, 98, 'aB');
INSERT INTO "structure_templates" ("id", "workspace_id", "kind", "name", "description", "source") VALUES ('00000000-0000-7000-8000-000000000a04', NULL, 'ROMANCE', 'Romancing the Beat', 'The four phases of a romance arc: setup, falling in love, retreating from love, fighting for love.', 'Gwen Hayes');
INSERT INTO "template_beats" ("id", "template_id", "title", "description", "target_percent", "position") VALUES ('00000000-0000-7000-8000-0000000b0401', '00000000-0000-7000-8000-000000000a04', 'Introduce Love Interest 1', 'Phase 1, setup: who they are and what''s missing.', 1, 'a0');
INSERT INTO "template_beats" ("id", "template_id", "title", "description", "target_percent", "position") VALUES ('00000000-0000-7000-8000-0000000b0402', '00000000-0000-7000-8000-000000000a04', 'Meet', 'Phase 1: the love interests meet.', 5, 'a1');
INSERT INTO "template_beats" ("id", "template_id", "title", "description", "target_percent", "position") VALUES ('00000000-0000-7000-8000-0000000b0403', '00000000-0000-7000-8000-000000000a04', 'No Way #1', 'Phase 1: why this can never work.', 8, 'a2');
INSERT INTO "template_beats" ("id", "template_id", "title", "description", "target_percent", "position") VALUES ('00000000-0000-7000-8000-0000000b0404', '00000000-0000-7000-8000-000000000a04', 'Adhesion', 'Phase 1: what keeps them together.', 12, 'a3');
INSERT INTO "template_beats" ("id", "template_id", "title", "description", "target_percent", "position") VALUES ('00000000-0000-7000-8000-0000000b0405', '00000000-0000-7000-8000-000000000a04', 'No Way #2', 'Phase 2, falling in love: resistance continues.', 15, 'a4');
INSERT INTO "template_beats" ("id", "template_id", "title", "description", "target_percent", "position") VALUES ('00000000-0000-7000-8000-0000000b0406', '00000000-0000-7000-8000-000000000a04', 'Inkling of Desire', 'Phase 2: the first spark.', 20, 'a5');
INSERT INTO "template_beats" ("id", "template_id", "title", "description", "target_percent", "position") VALUES ('00000000-0000-7000-8000-0000000b0407', '00000000-0000-7000-8000-000000000a04', 'Deepening Desire', 'Phase 2: attraction grows.', 25, 'a6');
INSERT INTO "template_beats" ("id", "template_id", "title", "description", "target_percent", "position") VALUES ('00000000-0000-7000-8000-0000000b0408', '00000000-0000-7000-8000-000000000a04', 'Maybe This Could Work', 'Phase 2: hope.', 37, 'a7');
INSERT INTO "template_beats" ("id", "template_id", "title", "description", "target_percent", "position") VALUES ('00000000-0000-7000-8000-0000000b0409', '00000000-0000-7000-8000-000000000a04', 'Midpoint of Love', 'Phase 2: a big moment of intimacy or commitment.', 50, 'a8');
INSERT INTO "template_beats" ("id", "template_id", "title", "description", "target_percent", "position") VALUES ('00000000-0000-7000-8000-0000000b040a', '00000000-0000-7000-8000-000000000a04', 'Inkling of Doubt', 'Phase 3, retreating: the wound reopens.', 55, 'a9');
INSERT INTO "template_beats" ("id", "template_id", "title", "description", "target_percent", "position") VALUES ('00000000-0000-7000-8000-0000000b040b', '00000000-0000-7000-8000-000000000a04', 'Deepening Doubt', 'Phase 3: fears grow.', 62, 'aA');
INSERT INTO "template_beats" ("id", "template_id", "title", "description", "target_percent", "position") VALUES ('00000000-0000-7000-8000-0000000b040c', '00000000-0000-7000-8000-000000000a04', 'Retreat', 'Phase 3: pulling away.', 68, 'aB');
INSERT INTO "template_beats" ("id", "template_id", "title", "description", "target_percent", "position") VALUES ('00000000-0000-7000-8000-0000000b040d', '00000000-0000-7000-8000-000000000a04', 'Shields Up', 'Phase 3: protecting themselves.', 72, 'aC');
INSERT INTO "template_beats" ("id", "template_id", "title", "description", "target_percent", "position") VALUES ('00000000-0000-7000-8000-0000000b040e', '00000000-0000-7000-8000-000000000a04', 'Break Up', 'Phase 3: the relationship falls apart.', 75, 'aD');
INSERT INTO "template_beats" ("id", "template_id", "title", "description", "target_percent", "position") VALUES ('00000000-0000-7000-8000-0000000b040f', '00000000-0000-7000-8000-000000000a04', 'Dark Night of the Soul', 'Phase 4, fighting for love: alone with the truth.', 80, 'aE');
INSERT INTO "template_beats" ("id", "template_id", "title", "description", "target_percent", "position") VALUES ('00000000-0000-7000-8000-0000000b0410', '00000000-0000-7000-8000-000000000a04', 'Wake Up', 'Phase 4: realising what must change.', 85, 'aF');
INSERT INTO "template_beats" ("id", "template_id", "title", "description", "target_percent", "position") VALUES ('00000000-0000-7000-8000-0000000b0411', '00000000-0000-7000-8000-000000000a04', 'Grand Gesture', 'Phase 4: proving the change.', 90, 'aG');
INSERT INTO "template_beats" ("id", "template_id", "title", "description", "target_percent", "position") VALUES ('00000000-0000-7000-8000-0000000b0412', '00000000-0000-7000-8000-000000000a04', 'Whole-Hearted', 'Phase 4: the happy ending.', 98, 'aH');
INSERT INTO "structure_templates" ("id", "workspace_id", "kind", "name", "description", "source") VALUES ('00000000-0000-7000-8000-000000000a05', NULL, 'CHARACTER_ARC', 'Positive Change Arc', 'A character overcomes the lie they believe.', 'K.M. Weiland');
INSERT INTO "template_beats" ("id", "template_id", "title", "description", "target_percent", "position") VALUES ('00000000-0000-7000-8000-0000000b0501', '00000000-0000-7000-8000-000000000a05', 'The Lie', 'What the character wrongly believes.', 0, 'a0');
INSERT INTO "template_beats" ("id", "template_id", "title", "description", "target_percent", "position") VALUES ('00000000-0000-7000-8000-0000000b0502', '00000000-0000-7000-8000-000000000a05', 'The Want and the Need', 'What they pursue vs. what they truly need.', 2, 'a1');
INSERT INTO "template_beats" ("id", "template_id", "title", "description", "target_percent", "position") VALUES ('00000000-0000-7000-8000-0000000b0503', '00000000-0000-7000-8000-000000000a05', 'The Ghost', 'The wound behind the lie.', 3, 'a2');
INSERT INTO "template_beats" ("id", "template_id", "title", "description", "target_percent", "position") VALUES ('00000000-0000-7000-8000-0000000b0504', '00000000-0000-7000-8000-000000000a05', 'Characteristic Moment', 'Showing the character before change.', 5, 'a3');
INSERT INTO "template_beats" ("id", "template_id", "title", "description", "target_percent", "position") VALUES ('00000000-0000-7000-8000-0000000b0505', '00000000-0000-7000-8000-000000000a05', 'Inciting Event', NULL, 12, 'a4');
INSERT INTO "template_beats" ("id", "template_id", "title", "description", "target_percent", "position") VALUES ('00000000-0000-7000-8000-0000000b0506', '00000000-0000-7000-8000-000000000a05', 'First Plot Point', NULL, 25, 'a5');
INSERT INTO "template_beats" ("id", "template_id", "title", "description", "target_percent", "position") VALUES ('00000000-0000-7000-8000-0000000b0507', '00000000-0000-7000-8000-000000000a05', 'First Pinch Point', NULL, 37, 'a6');
INSERT INTO "template_beats" ("id", "template_id", "title", "description", "target_percent", "position") VALUES ('00000000-0000-7000-8000-0000000b0508', '00000000-0000-7000-8000-000000000a05', 'Midpoint: Moment of Truth', 'The character glimpses the truth.', 50, 'a7');
INSERT INTO "template_beats" ("id", "template_id", "title", "description", "target_percent", "position") VALUES ('00000000-0000-7000-8000-0000000b0509', '00000000-0000-7000-8000-000000000a05', 'Second Pinch Point', NULL, 62, 'a8');
INSERT INTO "template_beats" ("id", "template_id", "title", "description", "target_percent", "position") VALUES ('00000000-0000-7000-8000-0000000b050a', '00000000-0000-7000-8000-000000000a05', 'Third Plot Point', 'The lie''s final hold.', 75, 'a9');
INSERT INTO "template_beats" ("id", "template_id", "title", "description", "target_percent", "position") VALUES ('00000000-0000-7000-8000-0000000b050b', '00000000-0000-7000-8000-000000000a05', 'Climax', 'Acting on the truth.', 88, 'aA');
INSERT INTO "template_beats" ("id", "template_id", "title", "description", "target_percent", "position") VALUES ('00000000-0000-7000-8000-0000000b050c', '00000000-0000-7000-8000-000000000a05', 'Resolution', 'The changed character.', 98, 'aB');
