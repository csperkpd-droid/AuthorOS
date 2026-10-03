-- ─── Group relationships ────────────────────────────────────────────────────
-- A relationship has two or more members (relationship_members). Existing
-- pairs become two-member relationships; nothing is lost.

-- CreateTable
CREATE TABLE "relationship_members" (
    "workspace_id" UUID NOT NULL,
    "relationship_id" UUID NOT NULL,
    "character_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "relationship_members_pkey" PRIMARY KEY ("relationship_id","character_id")
);

-- Data: the pair's two characters, in their stored order.
INSERT INTO "relationship_members" ("workspace_id", "relationship_id", "character_id", "position")
SELECT "workspace_id", "id", "character_a_id", 0 FROM "relationships"
UNION ALL
SELECT "workspace_id", "id", "character_b_id", 1 FROM "relationships";

ALTER TABLE "relationships" ADD COLUMN "member_key" TEXT;
-- Pairs were stored with character_a_id < character_b_id: already sorted.
UPDATE "relationships" SET "member_key" = "character_a_id"::text || ',' || "character_b_id"::text;
ALTER TABLE "relationships" ALTER COLUMN "member_key" SET NOT NULL;

-- DropForeignKey
ALTER TABLE "relationships" DROP CONSTRAINT "relationships_character_a_id_workspace_id_fkey";
ALTER TABLE "relationships" DROP CONSTRAINT "relationships_character_b_id_workspace_id_fkey";
ALTER TABLE "relationships" DROP CONSTRAINT "relationships_ordered_pair";
DROP INDEX "relationships_character_a_id_character_b_id_key";
DROP INDEX "relationships_character_b_id_idx";
ALTER TABLE "relationships" DROP COLUMN "character_a_id", DROP COLUMN "character_b_id";

CREATE INDEX "relationship_members_character_id_idx" ON "relationship_members"("character_id");
CREATE UNIQUE INDEX "relationships_workspace_id_member_key_key" ON "relationships"("workspace_id", "member_key");

ALTER TABLE "relationship_members" ADD CONSTRAINT "relationship_members_relationship_id_workspace_id_fkey" FOREIGN KEY ("relationship_id", "workspace_id") REFERENCES "relationships"("id", "workspace_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "relationship_members" ADD CONSTRAINT "relationship_members_character_id_workspace_id_fkey" FOREIGN KEY ("character_id", "workspace_id") REFERENCES "characters"("id", "workspace_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- At commit, every relationship has at least two members and its
-- member_key is exactly its sorted member ids (so "one relationship per set
-- of members" holds for groups as for pairs).
CREATE FUNCTION "relationship_members_valid"() RETURNS trigger AS $$
DECLARE
  rel_id uuid;
  rel record;
BEGIN
  IF TG_TABLE_NAME = 'relationships' THEN
    rel_id := NEW."id";
  ELSIF TG_OP = 'DELETE' THEN
    rel_id := OLD."relationship_id";
  ELSE
    rel_id := NEW."relationship_id";
  END IF;
  SELECT r."member_key",
         (SELECT count(*) FROM "relationship_members" m WHERE m."relationship_id" = r."id") AS n,
         (SELECT string_agg(m."character_id"::text, ',' ORDER BY m."character_id"::text)
            FROM "relationship_members" m WHERE m."relationship_id" = r."id") AS computed
    INTO rel FROM "relationships" r WHERE r."id" = rel_id;
  IF NOT FOUND THEN RETURN NULL; END IF; -- the relationship itself was deleted
  IF rel.n < 2 THEN
    RAISE EXCEPTION 'relationship % needs at least two members', rel_id;
  END IF;
  IF rel."member_key" <> rel.computed THEN
    RAISE EXCEPTION 'relationship % member_key does not match its members', rel_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "relationships_members_valid"
  AFTER INSERT OR UPDATE OF "member_key" ON "relationships"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "relationship_members_valid"();
CREATE CONSTRAINT TRIGGER "relationship_members_valid"
  AFTER INSERT OR DELETE ON "relationship_members"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "relationship_members_valid"();

-- Deleting a character for good ends every relationship they belong to
-- (as when relationships were pairs). Their nodes go with them.
CREATE FUNCTION "delete_character_relationships"() RETURNS trigger AS $$
BEGIN
  DELETE FROM "relationships" WHERE "id" IN (
    SELECT "relationship_id" FROM "relationship_members" WHERE "character_id" = OLD."id"
  );
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "characters_delete_relationships" BEFORE DELETE ON "characters"
  FOR EACH ROW EXECUTE FUNCTION "delete_character_relationships"();

-- ─── Template kits ──────────────────────────────────────────────────────────

CREATE TYPE "kit_item_type" AS ENUM ('STRUCTURE');

CREATE TABLE "template_kits" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "template_kits_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "template_kit_items" (
    "id" UUID NOT NULL,
    "kit_id" UUID NOT NULL,
    "item_type" "kit_item_type" NOT NULL DEFAULT 'STRUCTURE',
    "template_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "template_kit_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "template_kits_workspace_id_idx" ON "template_kits"("workspace_id");
CREATE INDEX "template_kit_items_kit_id_idx" ON "template_kit_items"("kit_id");
CREATE INDEX "template_kit_items_template_id_idx" ON "template_kit_items"("template_id");

ALTER TABLE "template_kits" ADD CONSTRAINT "template_kits_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "template_kit_items" ADD CONSTRAINT "template_kit_items_kit_id_fkey" FOREIGN KEY ("kit_id") REFERENCES "template_kits"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "template_kit_items" ADD CONSTRAINT "template_kit_items_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "structure_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── Search ─────────────────────────────────────────────────────────────────
-- Full-text expression indexes ('simple': no stemming, any language). Queries
-- must use the same expressions (see modules/search).

CREATE INDEX "scenes_search_idx" ON "scenes"
  USING GIN (to_tsvector('simple', "title" || ' ' || coalesce("synopsis", '') || ' ' || "content_text"));
CREATE INDEX "notes_search_idx" ON "notes"
  USING GIN (to_tsvector('simple', "title" || ' ' || "body_text"));
CREATE INDEX "ideas_search_idx" ON "ideas"
  USING GIN (to_tsvector('simple', "title" || ' ' || coalesce("body", '')));
-- array_to_string isn't IMMUTABLE (it depends on type output functions in
-- general); for text[] it is, so wrap it to use it in an index.
CREATE FUNCTION "search_join"(text[]) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$ SELECT array_to_string($1, ' ') $$;
CREATE INDEX "characters_search_idx" ON "characters"
  USING GIN (to_tsvector('simple', "name" || ' ' || "search_join"("aliases") || ' ' || coalesce("summary", '')));
