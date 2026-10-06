-- M11 Scene Participation (decision 106): a character's relationship to a
-- scene becomes its own table instead of the temporary `appears_in`
-- connection kind. Present or Mentioned, plus whether the scene is told
-- from the character's point of view (at most one per scene).

CREATE TYPE "scene_presence" AS ENUM ('PRESENT', 'MENTIONED');

CREATE TABLE "scene_participations" (
    "workspace_id" UUID NOT NULL,
    "scene_id" UUID NOT NULL,
    "character_id" UUID NOT NULL,
    "presence" "scene_presence" NOT NULL DEFAULT 'PRESENT',
    "is_pov" BOOLEAN NOT NULL DEFAULT false,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scene_participations_pkey" PRIMARY KEY ("scene_id","character_id")
);

CREATE INDEX "scene_participations_character_id_idx" ON "scene_participations"("character_id");

-- Tenant-safe: both ends in the participation's workspace; it disappears with either.
ALTER TABLE "scene_participations" ADD CONSTRAINT "scene_participations_scene_id_workspace_id_fkey" FOREIGN KEY ("scene_id", "workspace_id") REFERENCES "scenes"("id", "workspace_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "scene_participations" ADD CONSTRAINT "scene_participations_character_id_workspace_id_fkey" FOREIGN KEY ("character_id", "workspace_id") REFERENCES "characters"("id", "workspace_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "scene_participations" ADD CONSTRAINT "scene_participations_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A scene has at most one point-of-view character.
CREATE UNIQUE INDEX "scene_participations_one_pov"
  ON "scene_participations" ("scene_id") WHERE "is_pov";

-- Move every existing appearance across, keeping its role and dates:
-- POV → point of view and present; Present → present; Mentioned → mentioned.
INSERT INTO "scene_participations"
  ("workspace_id", "scene_id", "character_id", "presence", "is_pov", "created_by_id", "created_at", "updated_at")
SELECT c."workspace_id", c."target_id", c."source_id",
       (CASE WHEN c."attributes" ->> 'role' = 'MENTIONED' THEN 'MENTIONED' ELSE 'PRESENT' END)::"scene_presence",
       coalesce(c."attributes" ->> 'role' = 'POV', false),
       c."created_by_id", c."created_at", c."updated_at"
  FROM "connections" c
  JOIN "characters" ch ON ch."id" = c."source_id" AND ch."workspace_id" = c."workspace_id"
  JOIN "scenes" s ON s."id" = c."target_id" AND s."workspace_id" = c."workspace_id"
 WHERE c."kind" = 'appears_in';

-- The connection kind is retired: its rows now live in scene_participations.
DROP INDEX "connections_one_pov_per_scene";
DELETE FROM "connections" WHERE "kind" = 'appears_in';
