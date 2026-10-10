"use client";

import { useCallback, type ComponentProps } from "react";

import { RichTextEditor } from "@/components/editor/rich-text-editor";
import type { Doc } from "@/lib/text";
import { DocumentComments } from "@/modules/comments/ui";
import { keepDeviceDraftAction } from "@/modules/history/ui";
import { setWritingPlaceAction } from "@/modules/work-context/ui";

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
  comments,
  canComment,
  focusCommentId = null,
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
  /** The scene's comments (M16), kept beside the text. */
  comments: ComponentProps<typeof DocumentComments>["initial"];
  canComment: boolean;
  /** A comment to open the panel on (Review's "Open in text", M17). */
  focusCommentId?: string | null;
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
      workPlace={{
        owner: draftOwner,
        entry: { kind: "scene", id: sceneId, href },
        // Continue Writing, on any device.
        onPlace: (anchor) => void setWritingPlaceAction(sceneId, anchor),
      }}
      label="Scene text"
      thing="scene"
      aside={(api) => (
        <DocumentComments
          nodeId={sceneId}
          initial={comments}
          editor={api.editor}
          version={api.version}
          saved={api.saved}
          canComment={canComment}
          thing="scene"
          focusId={focusCommentId}
        />
      )}
    />
  );
}
