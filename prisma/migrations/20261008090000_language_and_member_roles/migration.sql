-- A pen name's writing language (BCP 47 tag) for search stemming.
ALTER TABLE "pen_names" ADD COLUMN "language" TEXT;
ALTER TABLE "pen_names" ADD CONSTRAINT "pen_names_language_format"
  CHECK ("language" IS NULL OR "language" ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$');

-- A member's optional role within one relationship.
ALTER TABLE "relationship_members" ADD COLUMN "role" TEXT;
ALTER TABLE "relationship_members" ADD CONSTRAINT "relationship_members_role_length"
  CHECK ("role" IS NULL OR char_length("role") BETWEEN 1 AND 60);
