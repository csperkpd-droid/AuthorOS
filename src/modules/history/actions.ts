"use server";

import { runAction } from "@/server/action";
import { requireAuthorContext } from "@/server/context";

import { listFieldHistory, restoreFieldValue } from "./fields";
import {
  getRevision,
  keepDeviceDraft,
  listRevisions,
  restoreRevision,
  saveVersion,
} from "./service";

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

/** Keeps unsynced text from this device as a version (the current text stays). */
export async function keepDeviceDraftAction(nodeId: string, content: unknown, writtenAt: string) {
  return runAction(
    async () => keepDeviceDraft(await requireAuthorContext(), { nodeId, content, writtenAt }),
    { refresh: false },
  );
}

export async function listFieldHistoryAction(nodeId: string, field?: string) {
  return runAction(async () => listFieldHistory(await requireAuthorContext(), nodeId, field), {
    refresh: false,
  });
}

export async function restoreFieldValueAction(revisionId: string) {
  return runAction(async () => restoreFieldValue(await requireAuthorContext(), revisionId));
}
