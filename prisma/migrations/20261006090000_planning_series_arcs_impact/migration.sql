-- CreateEnum
CREATE TYPE "arc_role" AS ENUM ('MAIN', 'SECONDARY');

-- CreateEnum
CREATE TYPE "task_status" AS ENUM ('TODO', 'IN_PROGRESS', 'DONE');

-- CreateEnum
CREATE TYPE "task_priority" AS ENUM ('LOW', 'NORMAL', 'HIGH');

-- CreateEnum
CREATE TYPE "writing_source" AS ENUM ('EDITOR', 'MANUAL');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "story_node_kind" ADD VALUE 'TASK';
ALTER TYPE "story_node_kind" ADD VALUE 'EVENT';

-- AlterTable
ALTER TABLE "books" ADD COLUMN     "due_on" DATE;

-- AlterTable
ALTER TABLE "field_definitions" ADD COLUMN     "book_id" UUID,
ADD COLUMN     "series_id" UUID;

-- AlterTable
ALTER TABLE "outline_beats" ADD COLUMN     "book_id" UUID;

-- AlterTable
ALTER TABLE "outlines" ADD COLUMN     "arc_role" "arc_role",
ADD COLUMN     "series_id" UUID,
ALTER COLUMN "book_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "structure_templates" ADD COLUMN     "for_series" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "template_beats" ADD COLUMN     "book_index" INTEGER;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "time_zone" TEXT;

-- AlterTable
ALTER TABLE "workspace_members" ADD COLUMN     "daily_word_goal" INTEGER;

-- CreateTable
CREATE TABLE "tasks" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "notes" TEXT,
    "status" "task_status" NOT NULL DEFAULT 'TODO',
    "priority" "task_priority" NOT NULL DEFAULT 'NORMAL',
    "due_on" DATE,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calendar_events" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "starts_on" DATE NOT NULL,
    "ends_on" DATE,
    "start_time" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "calendar_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "writing_sessions" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "book_id" UUID,
    "date" DATE NOT NULL,
    "source" "writing_source" NOT NULL,
    "words_added" INTEGER NOT NULL DEFAULT 0,
    "words_removed" INTEGER NOT NULL DEFAULT 0,
    "minutes" INTEGER,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "writing_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tasks_workspace_id_due_on_idx" ON "tasks"("workspace_id", "due_on");

-- CreateIndex
CREATE UNIQUE INDEX "tasks_id_workspace_id_key" ON "tasks"("id", "workspace_id");

-- CreateIndex
CREATE INDEX "calendar_events_workspace_id_starts_on_idx" ON "calendar_events"("workspace_id", "starts_on");

-- CreateIndex
CREATE UNIQUE INDEX "calendar_events_id_workspace_id_key" ON "calendar_events"("id", "workspace_id");

-- CreateIndex
CREATE INDEX "writing_sessions_workspace_id_user_id_date_idx" ON "writing_sessions"("workspace_id", "user_id", "date");

-- CreateIndex
CREATE INDEX "writing_sessions_book_id_idx" ON "writing_sessions"("book_id");

-- CreateIndex
CREATE INDEX "outlines_series_id_idx" ON "outlines"("series_id");

-- AddForeignKey
ALTER TABLE "structure_templates" ADD CONSTRAINT "structure_templates_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outlines" ADD CONSTRAINT "outlines_series_id_workspace_id_fkey" FOREIGN KEY ("series_id", "workspace_id") REFERENCES "series"("id", "workspace_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outline_beats" ADD CONSTRAINT "outline_beats_book_id_fkey" FOREIGN KEY ("book_id") REFERENCES "books"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "field_definitions" ADD CONSTRAINT "field_definitions_series_id_fkey" FOREIGN KEY ("series_id") REFERENCES "series"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "field_definitions" ADD CONSTRAINT "field_definitions_book_id_fkey" FOREIGN KEY ("book_id") REFERENCES "books"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_id_workspace_id_fkey" FOREIGN KEY ("id", "workspace_id") REFERENCES "story_nodes"("id", "workspace_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_id_workspace_id_fkey" FOREIGN KEY ("id", "workspace_id") REFERENCES "story_nodes"("id", "workspace_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "writing_sessions" ADD CONSTRAINT "writing_sessions_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "writing_sessions" ADD CONSTRAINT "writing_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "writing_sessions" ADD CONSTRAINT "writing_sessions_book_id_fkey" FOREIGN KEY ("book_id") REFERENCES "books"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── Hand-written: integrity rules Prisma can't express ─────────────────────

-- A structure belongs to exactly one book or one series.
ALTER TABLE "outlines" ADD CONSTRAINT "outlines_book_or_series"
  CHECK (num_nonnulls("book_id", "series_id") = 1);
-- Main/secondary applies to romance arcs only.
ALTER TABLE "outlines" ADD CONSTRAINT "outlines_arc_role_romance_only"
  CHECK ("arc_role" IS NULL OR "kind" = 'ROMANCE');

ALTER TABLE "template_beats" ADD CONSTRAINT "template_beats_book_index_positive"
  CHECK ("book_index" IS NULL OR "book_index" >= 1);

-- Custom fields: at most one scope (pen name, series or book); none = all identities.
ALTER TABLE "field_definitions" ADD CONSTRAINT "field_definitions_one_scope"
  CHECK (num_nonnulls("pen_name_id", "series_id", "book_id") <= 1);
DROP INDEX "field_definitions_unique_label";
CREATE UNIQUE INDEX "field_definitions_unique_label" ON "field_definitions" (
  "workspace_id", "node_kind",
  COALESCE("pen_name_id", '00000000-0000-0000-0000-000000000000'::uuid),
  COALESCE("series_id", '00000000-0000-0000-0000-000000000000'::uuid),
  COALESCE("book_id", '00000000-0000-0000-0000-000000000000'::uuid),
  lower("label")
);

-- Tasks and calendar events are story nodes.
CREATE TRIGGER "tasks_node_kind" BEFORE INSERT OR UPDATE OF "id" ON "tasks"
  FOR EACH ROW EXECUTE FUNCTION "story_node_kind_matches"('TASK');
CREATE TRIGGER "tasks_delete_node" AFTER DELETE ON "tasks"
  FOR EACH ROW EXECUTE FUNCTION "delete_story_node"();
CREATE TRIGGER "calendar_events_node_kind" BEFORE INSERT OR UPDATE OF "id" ON "calendar_events"
  FOR EACH ROW EXECUTE FUNCTION "story_node_kind_matches"('EVENT');
CREATE TRIGGER "calendar_events_delete_node" AFTER DELETE ON "calendar_events"
  FOR EACH ROW EXECUTE FUNCTION "delete_story_node"();

ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_ends_after_start"
  CHECK ("ends_on" IS NULL OR "ends_on" >= "starts_on");
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_start_time_format"
  CHECK ("start_time" IS NULL OR "start_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');

-- Writing: one automatic row per user, book and day; counts never negative.
CREATE UNIQUE INDEX "writing_sessions_one_editor_row_per_day"
  ON "writing_sessions" ("user_id", "book_id", "date")
  WHERE "source" = 'EDITOR' AND "book_id" IS NOT NULL;
ALTER TABLE "writing_sessions" ADD CONSTRAINT "writing_sessions_counts_non_negative"
  CHECK ("words_added" >= 0 AND "words_removed" >= 0 AND ("minutes" IS NULL OR "minutes" >= 0));

ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_daily_goal_positive"
  CHECK ("daily_word_goal" IS NULL OR "daily_word_goal" > 0);
