-- M15 World objects (decision 113): places and world entries are story
-- objects of one pen name (optionally of one of its series), like
-- characters; a scene's setting is a dedicated relationship
-- (`scene_settings`), not a connection. Nothing existing changes.

CREATE TABLE "places" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "pen_name_id" UUID NOT NULL,
    "series_id" UUID,
    "name" TEXT NOT NULL,
    "summary" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "places_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "places_workspace_id_idx" ON "places"("workspace_id");
CREATE INDEX "places_pen_name_id_idx" ON "places"("pen_name_id");
CREATE INDEX "places_series_id_idx" ON "places"("series_id");
CREATE UNIQUE INDEX "places_id_workspace_id_key" ON "places"("id", "workspace_id");
ALTER TABLE "places" ADD CONSTRAINT "places_id_workspace_id_fkey" FOREIGN KEY ("id", "workspace_id") REFERENCES "story_nodes"("id", "workspace_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "places" ADD CONSTRAINT "places_pen_name_id_workspace_id_fkey" FOREIGN KEY ("pen_name_id", "workspace_id") REFERENCES "pen_names"("id", "workspace_id") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "places" ADD CONSTRAINT "places_series_id_fkey" FOREIGN KEY ("series_id") REFERENCES "series"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "places" ADD CONSTRAINT "places_name_not_blank" CHECK (btrim("name") <> '' AND char_length("name") <= 200);

CREATE TABLE "world_entries" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "pen_name_id" UUID NOT NULL,
    "series_id" UUID,
    "entry_type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "summary" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "world_entries_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "world_entries_workspace_id_idx" ON "world_entries"("workspace_id");
CREATE INDEX "world_entries_pen_name_id_idx" ON "world_entries"("pen_name_id");
CREATE INDEX "world_entries_series_id_idx" ON "world_entries"("series_id");
CREATE UNIQUE INDEX "world_entries_id_workspace_id_key" ON "world_entries"("id", "workspace_id");
ALTER TABLE "world_entries" ADD CONSTRAINT "world_entries_id_workspace_id_fkey" FOREIGN KEY ("id", "workspace_id") REFERENCES "story_nodes"("id", "workspace_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "world_entries" ADD CONSTRAINT "world_entries_pen_name_id_workspace_id_fkey" FOREIGN KEY ("pen_name_id", "workspace_id") REFERENCES "pen_names"("id", "workspace_id") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "world_entries" ADD CONSTRAINT "world_entries_series_id_fkey" FOREIGN KEY ("series_id") REFERENCES "series"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "world_entries" ADD CONSTRAINT "world_entries_name_not_blank" CHECK (btrim("name") <> '' AND char_length("name") <= 200);
-- The author's own word for what it is ("Organization", "Item", "Guild"…): free text, never parsed.
ALTER TABLE "world_entries" ADD CONSTRAINT "world_entries_type_not_blank" CHECK (btrim("entry_type") <> '' AND char_length("entry_type") <= 60);

-- Story-node integrity (functions from manuscript_structure).
CREATE TRIGGER "places_node_kind" BEFORE INSERT OR UPDATE OF "id" ON "places"
  FOR EACH ROW EXECUTE FUNCTION "story_node_kind_matches"('PLACE');
CREATE TRIGGER "places_delete_node" AFTER DELETE ON "places"
  FOR EACH ROW EXECUTE FUNCTION "delete_story_node"();
CREATE TRIGGER "world_entries_node_kind" BEFORE INSERT OR UPDATE OF "id" ON "world_entries"
  FOR EACH ROW EXECUTE FUNCTION "story_node_kind_matches"('WORLD_ENTRY');
CREATE TRIGGER "world_entries_delete_node" AFTER DELETE ON "world_entries"
  FOR EACH ROW EXECUTE FUNCTION "delete_story_node"();

-- Scene setting: where a scene takes place, as the author states it. A scene
-- may be set in several places; tenant-safe FKs, cascading both ways.
CREATE TABLE "scene_settings" (
    "workspace_id" UUID NOT NULL,
    "scene_id" UUID NOT NULL,
    "place_id" UUID NOT NULL,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scene_settings_pkey" PRIMARY KEY ("scene_id","place_id")
);

CREATE INDEX "scene_settings_place_id_idx" ON "scene_settings"("place_id");
ALTER TABLE "scene_settings" ADD CONSTRAINT "scene_settings_scene_id_workspace_id_fkey" FOREIGN KEY ("scene_id", "workspace_id") REFERENCES "scenes"("id", "workspace_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "scene_settings" ADD CONSTRAINT "scene_settings_place_id_workspace_id_fkey" FOREIGN KEY ("place_id", "workspace_id") REFERENCES "places"("id", "workspace_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "scene_settings" ADD CONSTRAINT "scene_settings_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
