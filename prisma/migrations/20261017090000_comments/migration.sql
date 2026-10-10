-- M16 Comments with external anchors (decisions 87 and 114). A comment
-- annotates a passage of a scene's or note's text without ever entering the
-- document: the passage is remembered here (plain-text offsets, the exact
-- quote and its surrounding text, the document version) and found again
-- when the text changes. Comments are not story objects. Nothing existing
-- changes.

CREATE TYPE "comment_state" AS ENUM ('OPEN', 'NEEDS_REVIEW', 'RESOLVED');

CREATE TABLE "comments" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "node_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "state" "comment_state" NOT NULL DEFAULT 'OPEN',
    "anchor_start" INTEGER NOT NULL,
    "anchor_end" INTEGER NOT NULL,
    "quote" TEXT NOT NULL,
    "prefix" TEXT NOT NULL DEFAULT '',
    "suffix" TEXT NOT NULL DEFAULT '',
    "doc_version" INTEGER NOT NULL,
    "anchor_lost" BOOLEAN NOT NULL DEFAULT false,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "resolved_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "comments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "comments_node_id_idx" ON "comments"("node_id");
CREATE INDEX "comments_workspace_id_idx" ON "comments"("workspace_id");
-- The commented scene or note: tenant-safe, and its comments go when it is deleted forever.
ALTER TABLE "comments" ADD CONSTRAINT "comments_node_id_workspace_id_fkey" FOREIGN KEY ("node_id", "workspace_id") REFERENCES "story_nodes"("id", "workspace_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "comments" ADD CONSTRAINT "comments_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "comments" ADD CONSTRAINT "comments_body_length" CHECK (btrim("body") <> '' AND char_length("body") <= 5000);
ALTER TABLE "comments" ADD CONSTRAINT "comments_anchor_range" CHECK ("anchor_start" >= 0 AND "anchor_end" > "anchor_start" AND char_length("quote") BETWEEN 1 AND 2000 AND char_length("prefix") <= 32 AND char_length("suffix") <= 32);
-- A comment that lost its passage is never shown as anchored: open ones need review.
ALTER TABLE "comments" ADD CONSTRAINT "comments_lost_needs_review" CHECK (NOT "anchor_lost" OR "state" <> 'OPEN');
-- Needs review always means the passage wasn't found with certainty.
ALTER TABLE "comments" ADD CONSTRAINT "comments_review_is_lost" CHECK ("state" <> 'NEEDS_REVIEW' OR "anchor_lost");
