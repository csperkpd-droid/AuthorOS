import "server-only";

import type { Prisma, StoryNodeKind } from "@/generated/prisma/client";

/**
 * The Story Graph extension point (docs/ARCHITECTURE.md → Story Graph).
 *
 * Every story object gets a row in `story_nodes`, and its typed row (book,
 * scene…) uses the node id as its primary key. Future cross-cutting features
 * (universal connections, tags, comments) reference nodes, so they work for
 * every object type without new foreign keys per pair of types.
 */
export type NodeRef = { id: string; kind: StoryNodeKind };

/** Creates the node a typed row will use as its id. Call inside the same transaction. */
export async function createStoryNode(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  kind: StoryNodeKind,
): Promise<string> {
  const node = await tx.storyNode.create({ data: { workspaceId, kind }, select: { id: true } });
  return node.id;
}

/**
 * Permanently deletes story objects. Deleting the node cascades to its typed
 * row and that row's children; triggers remove the children's nodes.
 */
export async function purgeStoryNodes(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  ids: string[],
): Promise<void> {
  await tx.storyNode.deleteMany({ where: { workspaceId, id: { in: ids } } });
}
