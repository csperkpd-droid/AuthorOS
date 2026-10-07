"use client";

import { useRef, useState } from "react";

import { FormError } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { SceneStatus } from "@/generated/prisma/enums";
import { useAction } from "@/hooks/use-action";

import { updateSceneDetailsAction } from "../actions";
import { SCENE_STATUS_LABELS } from "../labels";

/** Scene title, status and synopsis. Each saves when it changes. */
export function SceneDetails({
  sceneId,
  title,
  status,
  synopsis,
}: {
  sceneId: string;
  title: string;
  status: SceneStatus;
  synopsis: string | null;
}) {
  const { run, error } = useAction(updateSceneDetailsAction);
  const [titleValue, setTitleValue] = useState(title);
  // The synopsis this panel last knew: a save is refused if it changed elsewhere since.
  const knownSynopsis = useRef(synopsis ?? "");

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <input
          aria-label="Scene title"
          value={titleValue}
          onChange={(e) => setTitleValue(e.target.value)}
          onBlur={() => {
            const next = titleValue.trim();
            if (next && next !== title) void run(sceneId, { title: next });
            else setTitleValue(title);
          }}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          className="min-w-0 flex-1 rounded-md bg-transparent px-1 font-display text-3xl font-semibold tracking-tight focus-visible:focus-ring"
        />
        <Select
          aria-label="Scene status"
          defaultValue={status}
          onChange={(e) => void run(sceneId, { status: e.target.value as SceneStatus })}
          className="h-8 w-auto"
        >
          {Object.values(SceneStatus).map((s) => (
            <option key={s} value={s}>
              {SCENE_STATUS_LABELS[s]}
            </option>
          ))}
        </Select>
      </div>
      <details className="group" open={Boolean(synopsis)}>
        <summary className="cursor-pointer px-1 text-sm text-muted-foreground select-none hover:text-foreground">
          Synopsis
        </summary>
        <Textarea
          aria-label="Synopsis"
          defaultValue={synopsis ?? ""}
          placeholder="What happens in this scene?"
          rows={3}
          className="mt-2"
          onBlur={async (e) => {
            const value = e.target.value;
            if (value.trim() === knownSynopsis.current.trim()) return;
            const result = await run(sceneId, { synopsis: value }, knownSynopsis.current);
            if (result.ok) knownSynopsis.current = value;
          }}
        />
      </details>
      <FormError message={error} />
    </div>
  );
}
