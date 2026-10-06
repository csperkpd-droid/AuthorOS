"use client";

import { Clock, History } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { FormError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useAction } from "@/hooks/use-action";
import { formatDateTime } from "@/lib/format";

import {
  listStoryTimeHistoryAction,
  removeSceneFromTimeAction,
  setStoryTimeLabelAction,
} from "../actions";
import { ordinal } from "../labels";
import { PlaceInTimeDialog, type TimelineChoice } from "./place-dialog";

/**
 * A scene's place in Story Time, on the scene page: its label and its
 * place in story order, or "not placed yet". Placing, moving and labelling
 * are explicit; nothing is guessed from the text.
 */
export function SceneStoryTime({
  sceneId,
  sceneTitle,
  placed,
  label,
  order,
  timelineHref,
  choices,
  canEdit,
}: {
  sceneId: string;
  sceneTitle: string;
  placed: boolean;
  label: string | null;
  order: number | null;
  timelineHref: string;
  choices: TimelineChoice[];
  canEdit: boolean;
}) {
  const remove = useAction(removeSceneFromTimeAction);
  const index = choices.findIndex((c) => c.id === sceneId);
  const others = choices.filter((c) => c.id !== sceneId);
  const currentAfter = index > 0 ? choices[index - 1].id : null;

  return (
    <section aria-label="Story time" className="space-y-1 text-sm">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1" data-testid="scene-story-time">
        <Clock className="size-4 text-muted-foreground" aria-hidden />
        {placed ? (
          <>
            <span className="text-muted-foreground">Story time:</span>
            <span className="font-medium">{label || "No label"}</span>
            {order && (
              <span className="text-muted-foreground">· {ordinal(order)} in story order</span>
            )}
          </>
        ) : (
          <span className="text-muted-foreground">Not placed in the story’s timeline yet</span>
        )}
        <Link href={timelineHref} className="text-xs text-muted-foreground underline">
          Open timeline
        </Link>
      </p>
      <div className="flex flex-wrap gap-1">
        {canEdit && (
          <>
            <PlaceInTimeDialog
              sceneId={sceneId}
              sceneTitle={sceneTitle}
              choices={others}
              label={label}
              defaultAfterId={placed ? currentAfter : undefined}
              trigger={
                <Button variant="ghost" size="sm">
                  {placed ? "Move in story time" : "Place in story time"}
                </Button>
              }
            />
            {placed && <EditLabel sceneId={sceneId} label={label} />}
            {placed && (
              <Button variant="ghost" size="sm" onClick={() => remove.run(sceneId)}>
                Take out of story time
              </Button>
            )}
          </>
        )}
        <StoryTimeHistory sceneId={sceneId} />
      </div>
      <FormError message={remove.error} />
    </section>
  );
}

function EditLabel({ sceneId, label }: { sceneId: string; label: string | null }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(label ?? "");
  const save = useAction(setStoryTimeLabelAction);
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        save.setError(null);
        if (o) setText(label ?? "");
      }}
    >
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          Edit story time
        </Button>
      </DialogTrigger>
      <DialogContent
        title="Story time"
        description="Your own words for when this happens, e.g. “Day 3, evening” or “Ten years earlier”. Never read as a date."
      >
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            const result = await save.run(sceneId, text, label);
            if (result.ok) setOpen(false);
          }}
        >
          <Input
            aria-label="Story time"
            value={text}
            maxLength={200}
            onChange={(e) => setText(e.target.value)}
            autoFocus
          />
          <FormError message={save.error} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={save.pending}>
              Save
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

type Change =
  Awaited<ReturnType<typeof listStoryTimeHistoryAction>> extends infer R
    ? R extends { ok: true; data: (infer E)[] }
      ? E
      : never
    : never;

function describeChange(c: Change) {
  const label = (l: string | null) => (l ? `“${l}”` : "no label");
  const after = c.after ? `after “${c.after.title}”` : "at the start";
  switch (c.change.action) {
    case "placed":
      return `Placed in story time ${c.change.afterId && !c.after ? "after an item that isn’t shown" : after} (${label(c.change.label)})`;
    case "moved":
      return `Moved ${c.change.afterId && !c.after ? "after an item that isn’t shown" : after}`;
    case "label":
      return `Story time ${label(c.change.previousLabel)} → ${label(c.change.label)}`;
    case "unplaced":
      return "Taken out of story time";
  }
}

function StoryTimeHistory({ sceneId }: { sceneId: string }) {
  const [entries, setEntries] = useState<Change[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog
      onOpenChange={async (o) => {
        if (!o) return;
        setEntries(null);
        const result = await listStoryTimeHistoryAction(sceneId);
        if (result.ok) setEntries(result.data);
        else setError(result.error);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          <History />
          Story time changes
        </Button>
      </DialogTrigger>
      <DialogContent
        title="Story time changes"
        description="Every change to this scene’s story time."
      >
        <FormError message={error} />
        {entries === null ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">No changes yet.</p>
        ) : (
          <ul
            aria-label="Changes to this scene’s story time"
            className="max-h-[60vh] divide-y divide-border overflow-y-auto rounded-md border border-border"
          >
            {entries.map((c) => (
              <li key={c.id} className="space-y-0.5 p-3 text-sm">
                <p>{describeChange(c)}</p>
                <p className="text-xs text-muted-foreground">
                  {formatDateTime(new Date(c.createdAt))}
                </p>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
