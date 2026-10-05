"use client";

import { useCallback } from "react";

import { RichTextEditor } from "@/components/editor/rich-text-editor";
import type { Doc } from "@/lib/text";
import { keepDeviceDraftAction } from "@/modules/history/ui";

import { saveSceneContentAction } from "../actions";

/** The manuscript editor for one scene (autosave, conflict protection, word count). */
export function SceneEditor({
  sceneId,
  content,
  version,
  wordCount,
  draftOwner,
  draftLabel,
  href,
}: {
  sceneId: string;
  content: Doc | null;
  version: number;
  wordCount: number;
  /** The signed-in member unsynced text on this device belongs to (`draftOwner(ctx)`). */
  draftOwner: string;
  /** How a sign-out warning names this scene. */
  draftLabel: string;
  href: string;
}) {
  const save = useCallback(
    (doc: Doc, baseVersion: number) => saveSceneContentAction(sceneId, doc, baseVersion),
    [sceneId],
  );
  const keep = useCallback(
    (doc: Doc, writtenAt: string) => keepDeviceDraftAction(sceneId, doc, writtenAt),
    [sceneId],
  );
  return (
    <RichTextEditor
      content={content}
      version={version}
      wordCount={wordCount}
      onSave={save}
      onKeepDraft={keep}
      draft={{ owner: draftOwner, item: `scene:${sceneId}`, label: draftLabel, href }}
      label="Scene text"
      thing="scene"
    />
  );
}
