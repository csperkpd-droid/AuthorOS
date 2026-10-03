"use server";

import { runAction } from "@/server/action";
import { requireAuthorContext } from "@/server/context";

import { getRevision, listRevisions, restoreRevision, saveVersion } from "./service";

export async function listRevisionsAction(nodeId: string) {
  return runAction(async () => listRevisions(await requireAuthorContext(), nodeId), {
    refresh: false,
  });
}

export async function getRevisionAction(revisionId: string) {
  return runAction(async () => getRevision(await requireAuthorContext(), revisionId), {
    refresh: false,
  });
}

export async function saveVersionAction(nodeId: string, label: string) {
  return runAction(async () => saveVersion(await requireAuthorContext(), nodeId, label), {
    refresh: false,
  });
}

/** Restores a revision; refreshes so the editor picks up the restored version. */
export async function restoreRevisionAction(revisionId: string) {
  return runAction(async () => restoreRevision(await requireAuthorContext(), revisionId));
}
