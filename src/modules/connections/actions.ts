"use server";

import type { StoryNodeKind } from "@/generated/prisma/enums";
import { searchNodes } from "@/modules/story-graph";
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

/** Picker search; read-only, so no refresh. */
export async function searchNodesAction(query: string, kinds: StoryNodeKind[]) {
  return runAction(
    async () => searchNodes(await requireAuthorContext(), { query, kinds, limit: 12 }),
    {
      refresh: false,
    },
  );
}
