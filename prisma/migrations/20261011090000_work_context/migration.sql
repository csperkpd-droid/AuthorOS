-- M10 Work Context: each member's latest writing place, for Continue Writing
-- on any device. Temporary working state, not story data: it is not exported
-- and never authorizes anything (reads go through the Story Graph funnel).

ALTER TABLE "workspace_members"
  ADD COLUMN "writing_scene_id" UUID,
  ADD COLUMN "writing_anchor" JSONB,
  ADD COLUMN "writing_at" TIMESTAMP(3);

ALTER TABLE "workspace_members"
  ADD CONSTRAINT "workspace_members_writing_scene_id_fkey"
  FOREIGN KEY ("writing_scene_id") REFERENCES "scenes"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "workspace_members_writing_scene_id_idx" ON "workspace_members"("writing_scene_id");
