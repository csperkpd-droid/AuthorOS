-- M14 Beats: beats join the Story Graph. A separate migration: a new enum
-- value can only be used once it is committed.
ALTER TYPE "story_node_kind" ADD VALUE 'BEAT';
