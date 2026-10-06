"use client";

import { useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { FormError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useAction } from "@/hooks/use-action";

import { placeSceneInTimeAction } from "../actions";
import { STORY_TIME_EXAMPLES } from "../labels";

export type TimelineChoice = { id: string; kind: string; title: string; label: string | null };

const describe = (e: TimelineChoice) =>
  `${e.kind === "TIMELINE_EVENT" ? "Event: " : ""}${e.title}${e.label ? ` (${e.label})` : ""}`;

/**
 * Places a scene in Story Time (or moves it): right after a scene or event
 * of its timeline, or at the start, with an optional free-form label.
 * Never touches reading order or the scene's text.
 */
export function PlaceInTimeDialog({
  sceneId,
  sceneTitle,
  choices,
  label,
  defaultAfterId,
  trigger,
}: {
  sceneId: string;
  sceneTitle: string;
  /** The timeline in story order, without this scene. */
  choices: TimelineChoice[];
  label: string | null;
  /** Preselected neighbour; defaults to the last item. */
  defaultAfterId?: string | null;
  trigger: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const initialAfter = defaultAfterId !== undefined ? defaultAfterId : (choices.at(-1)?.id ?? null);
  const [after, setAfter] = useState<string>(initialAfter ?? "");
  const [text, setText] = useState(label ?? "");
  const place = useAction(placeSceneInTimeAction);

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        place.setError(null);
        if (o) {
          setAfter(initialAfter ?? "");
          setText(label ?? "");
        }
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent
        title={`Place “${sceneTitle}” in story time`}
        description="Where it happens in the story, not where it is in the book. Reading order and the text don’t change."
      >
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            const result = await place.run(sceneId, { afterId: after || null, label: text });
            if (result.ok) setOpen(false);
          }}
        >
          <label className="block space-y-1 text-sm">
            <span className="font-medium">Happens after</span>
            <Select value={after} onChange={(e) => setAfter(e.target.value)}>
              <option value="">At the very start</option>
              {choices.map((c) => (
                <option key={c.id} value={c.id}>
                  {describe(c)}
                </option>
              ))}
            </Select>
          </label>
          <label className="block space-y-1 text-sm">
            <span className="font-medium">Story time (optional)</span>
            <Input
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={200}
              placeholder={`e.g. ${STORY_TIME_EXAMPLES.slice(0, 3).join(", ")}`}
            />
            <span className="block text-xs text-muted-foreground">
              Your own words. It’s never read as a date.
            </span>
          </label>
          <FormError message={place.error} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={place.pending}>
              Place in story time
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
