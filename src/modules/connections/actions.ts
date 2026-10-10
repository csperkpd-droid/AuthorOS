"use server";

import type { StoryNodeKind } from "@/generated/prisma/enums";
import { resolveNode, searchNodes } from "@/modules/story-graph";
import { runAction } from "@/server/action";
import { requireAuthorContext } from "@/server/context";

import type { ConnectionDetails, NewConnectionInput } from "./schemas";
import { connect, disconnect, updateConnection } from "./service";

export async function connectAction(input: NewConnectionInput) {
  return runAction(async () => connect(await requireAuthorContext(), input));
}

export async function updateConnectionAction(id: string, details: ConnectionDetails) {
  return runAction(async () => updateConnection(await requireAuthorContext(), id, details));
}

export async function disconnectAction(id: string) {
  return runAction(async () => disconnect(await requireAuthorContext(), id));
}

/**
 * Picker search for things to connect to `forNodeId`; read-only, so no
 * refresh. Results stay within that object's pen name (or, for shared objects
 * such as notes, the one the author is writing as), and a scene is only
 * offered characters and places of its own series or none.
 */
export async function searchNodesAction(query: string, kinds: StoryNodeKind[], forNodeId?: string) {
  return runAction(
    async () => {
      const ctx = await requireAuthorContext();
      const node = forNodeId ? await resolveNode(ctx, forNodeId) : null;
      const results = await searchNodes(ctx, {
        query,
        kinds,
        limit: 12,
        penNameId: node?.penNameId ?? ctx.activePenNameId,
      });
      return results.filter(
        (r) =>
          r.id !== forNodeId &&
          !(
            node?.kind === "SCENE" &&
            (r.kind === "CHARACTER" || r.kind === "PLACE") &&
            r.seriesId &&
            r.seriesId !== node.seriesId
          ),
      );
    },
    { refresh: false },
  );
}
