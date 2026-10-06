-- M12 Story Time (decision 109): the story's own chronology, separate from
-- reading order and from real-world time. Positions are fractional keys
-- (lib/ordering) within a timeline: a standalone book's, or its series'.
-- Labels are free-form narrative time, never dates. Nothing is migrated:
-- every scene starts "not placed yet".

-- A scene's single point in Story Time (no row = not placed).
CREATE TABLE "scene_story_times" (
    "scene_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "position" TEXT COLLATE "C" NOT NULL,
    "label" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scene_story_times_pkey" PRIMARY KEY ("scene_id")
);

CREATE INDEX "scene_story_times_workspace_id_idx" ON "scene_story_times"("workspace_id");
CREATE UNIQUE INDEX "scene_story_times_scene_id_workspace_id_key" ON "scene_story_times"("scene_id", "workspace_id");

ALTER TABLE "scene_story_times" ADD CONSTRAINT "scene_story_times_scene_id_workspace_id_fkey" FOREIGN KEY ("scene_id", "workspace_id") REFERENCES "scenes"("id", "workspace_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "scene_story_times" ADD CONSTRAINT "scene_story_times_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "scene_story_times" ADD CONSTRAINT "scene_story_times_label_length" CHECK (char_length("label") <= 200);

-- Things that happen in the story world, owned by a book or a series.
CREATE TABLE "timeline_events" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "book_id" UUID,
    "series_id" UUID,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "label" TEXT,
    "position" TEXT COLLATE "C" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "timeline_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "timeline_events_book_id_idx" ON "timeline_events"("book_id");
CREATE INDEX "timeline_events_series_id_idx" ON "timeline_events"("series_id");
CREATE UNIQUE INDEX "timeline_events_id_workspace_id_key" ON "timeline_events"("id", "workspace_id");

ALTER TABLE "timeline_events" ADD CONSTRAINT "timeline_events_id_workspace_id_fkey" FOREIGN KEY ("id", "workspace_id") REFERENCES "story_nodes"("id", "workspace_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "timeline_events" ADD CONSTRAINT "timeline_events_book_id_workspace_id_fkey" FOREIGN KEY ("book_id", "workspace_id") REFERENCES "books"("id", "workspace_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "timeline_events" ADD CONSTRAINT "timeline_events_series_id_workspace_id_fkey" FOREIGN KEY ("series_id", "workspace_id") REFERENCES "series"("id", "workspace_id") ON DELETE CASCADE ON UPDATE CASCADE;
-- Exactly one owner: a book or a series.
ALTER TABLE "timeline_events" ADD CONSTRAINT "timeline_events_one_owner"
  CHECK (("book_id" IS NULL) <> ("series_id" IS NULL));
ALTER TABLE "timeline_events" ADD CONSTRAINT "timeline_events_label_length" CHECK (char_length("label") <= 200);

-- Story-node integrity (functions from manuscript_structure).
CREATE TRIGGER "timeline_events_node_kind" BEFORE INSERT OR UPDATE OF "id" ON "timeline_events"
  FOR EACH ROW EXECUTE FUNCTION "story_node_kind_matches"('TIMELINE_EVENT');
CREATE TRIGGER "timeline_events_delete_node" AFTER DELETE ON "timeline_events"
  FOR EACH ROW EXECUTE FUNCTION "delete_story_node"();
