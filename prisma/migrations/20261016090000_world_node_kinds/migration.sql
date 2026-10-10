-- M15 World objects: places and world entries join the Story Graph. A
-- separate migration: a new enum value can only be used once it is committed.
ALTER TYPE "story_node_kind" ADD VALUE 'PLACE';
ALTER TYPE "story_node_kind" ADD VALUE 'WORLD_ENTRY';
