"use client";

import { useCallback } from "react";

import { RichTextEditor } from "@/components/editor/rich-text-editor";
import type { Doc } from "@/lib/text";

import { saveSceneContentAction } from "../actions";

/** The manuscript editor for one scene (autosave, conflict protection, word count). */
export function SceneEditor({
  sceneId,
  content,
  version,
  wordCount,
}: {
  sceneId: string;
  content: Doc | null;
  version: number;
  wordCount: number;
}) {
  const save = useCallback(
    (doc: Doc, baseVersion: number) => saveSceneContentAction(sceneId, doc, baseVersion),
    [sceneId],
  );
  return (
    <RichTextEditor
      content={content}
      version={version}
      wordCount={wordCount}
      onSave={save}
      label="Scene text"
      thing="scene"
    />
  );
}
