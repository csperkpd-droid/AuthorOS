"use client";

import { ArrowDown, ArrowUp, Plus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { FormError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { SortableList } from "@/components/ui/sortable-list";
import { useAction } from "@/hooks/use-action";
import { cn } from "@/lib/utils";

import {
  createTimelineEventAction,
  moveTimelineEventAction,
  placeSceneInTimeAction,
  removeSceneFromTimeAction,
} from "../actions";
import { STORY_TIME_EXAMPLES } from "../labels";
import { PlaceInTimeDialog } from "./place-dialog";

type Entry = {
  kind: "SCENE" | "TIMELINE_EVENT";
  id: string;
  title: string;
  href: string;
  label: string | null;
  context: string | null;
  readingIndex: number | null;
};

/**
 * A timeline in story order: scenes and timeline events together. Drag (or
 * the Earlier / Later buttons, also on a phone) to change story order;
 * reading order is shown beside each scene and never changes here.
 */
export function TimelineBoard({
  ownerId,
  entries,
  unplaced,
  canEditScenes,
  canEditEvents,
  filtered,
}: {
  ownerId: string;
  entries: Entry[];
  unplaced: Entry[];
  canEditScenes: boolean;
  canEditEvents: boolean;
  /** A character filter is on (moves would be relative to hidden scenes). */
  filtered: boolean;
}) {
  const placeScene = useAction(placeSceneInTimeAction);
  const moveEvent = useAction(moveTimelineEventAction);
  const remove = useAction(removeSceneFromTimeAction);
  const canMove = (e: Entry) => !filtered && (e.kind === "SCENE" ? canEditScenes : canEditEvents);

  const move = (e: Entry, afterId: string | null) =>
    e.kind === "SCENE" ? placeScene.run(e.id, { afterId }) : moveEvent.run(e.id, afterId);

  const row = (e: Entry, handle: React.ReactNode, i: number) => (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2 px-3 py-2",
        e.kind === "TIMELINE_EVENT" && "bg-primary/5",
      )}
      data-testid="timeline-entry"
    >
      {handle}
      <span className="w-7 text-right text-xs text-muted-foreground tabular-nums" aria-hidden>
        {i + 1}
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2">
          <Badge className={e.kind === "TIMELINE_EVENT" ? "bg-primary/15 text-primary" : ""}>
            {e.kind === "TIMELINE_EVENT" ? "Event" : "Scene"}
          </Badge>
          <Link href={e.href} className="font-medium hover:underline">
            {e.title}
          </Link>
          {e.label && <span className="text-sm text-muted-foreground">{e.label}</span>}
        </p>
        <p className="text-xs text-muted-foreground">
          {e.context}
          {e.readingIndex !== null && ` · ${ordinalReading(e.readingIndex)}`}
        </p>
      </div>
      {canMove(e) && (
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="sm"
            aria-label={`Move ${e.title} earlier in story time`}
            disabled={i === 0}
            onClick={() => move(e, i >= 2 ? entries[i - 2].id : null)}
          >
            <ArrowUp />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            aria-label={`Move ${e.title} later in story time`}
            disabled={i === entries.length - 1}
            onClick={() => move(e, entries[i + 1].id)}
          >
            <ArrowDown />
          </Button>
          {e.kind === "SCENE" && (
            <Button
              variant="ghost"
              size="sm"
              aria-label={`Take ${e.title} out of story time`}
              onClick={() => remove.run(e.id)}
            >
              Take out
            </Button>
          )}
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-8">
      <section aria-labelledby="story-order" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="story-order" className="font-serif text-xl">
            In story order
          </h2>
          {canEditEvents && !filtered && <AddEvent ownerId={ownerId} entries={entries} />}
        </div>
        {entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing placed yet. Place scenes from the list below, or add an event.
          </p>
        ) : !filtered && (canEditScenes || canEditEvents) ? (
          <SortableList
            label="Story order"
            items={entries}
            itemLabel={(e) => e.title}
            onMove={async (id, afterId) => {
              const e = entries.find((x) => x.id === id)!;
              if (canMove(e)) await move(e, afterId);
            }}
            className="divide-y divide-border rounded-lg border border-border bg-surface"
            renderItem={(e, handle) => row(e, handle, entries.indexOf(e))}
          />
        ) : (
          <ol
            aria-label="Story order"
            className="divide-y divide-border rounded-lg border border-border bg-surface"
          >
            {entries.map((e, i) => (
              <li key={e.id}>{row(e, null, i)}</li>
            ))}
          </ol>
        )}
        <FormError message={placeScene.error ?? moveEvent.error ?? remove.error} />
      </section>

      <section aria-labelledby="not-placed" className="space-y-3">
        <h2 id="not-placed" className="font-serif text-xl">
          Not placed yet
        </h2>
        {unplaced.length === 0 ? (
          <p className="text-sm text-muted-foreground">Every scene has a place in story time.</p>
        ) : (
          <ul
            aria-label="Scenes not placed yet"
            className="divide-y divide-border rounded-lg border border-border bg-surface"
          >
            {unplaced.map((s) => (
              <li
                key={s.id}
                className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
              >
                <span className="min-w-0">
                  <Link href={s.href} className="font-medium hover:underline">
                    {s.title}
                  </Link>
                  <span className="block text-xs text-muted-foreground">
                    {s.context}
                    {s.readingIndex !== null && ` · ${ordinalReading(s.readingIndex)}`}
                  </span>
                </span>
                {canEditScenes && !filtered && (
                  <PlaceInTimeDialog
                    sceneId={s.id}
                    sceneTitle={s.title}
                    choices={entries}
                    label={null}
                    trigger={
                      <Button variant="outline" size="sm" aria-label={`Place ${s.title}`}>
                        Place
                      </Button>
                    }
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

const ordinalReading = (n: number) => `#${n} in reading order`;

function AddEvent({ ownerId, entries }: { ownerId: string; entries: Entry[] }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [label, setLabel] = useState("");
  const [after, setAfter] = useState("end");
  const create = useAction(createTimelineEventAction);
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        create.setError(null);
        if (o) {
          setTitle("");
          setLabel("");
          setAfter("end");
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Plus />
          Add event
        </Button>
      </DialogTrigger>
      <DialogContent
        title="Add a timeline event"
        description="Something that happens in the story world, on or off the page."
      >
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            const result = await create.run({
              ownerId,
              title,
              label,
              ...(after === "end" ? {} : { afterId: after || null }),
            });
            if (result.ok) setOpen(false);
          }}
        >
          <label className="block space-y-1 text-sm">
            <span className="font-medium">Event</span>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. The shipwreck"
              autoFocus
            />
          </label>
          <label className="block space-y-1 text-sm">
            <span className="font-medium">Story time (optional)</span>
            <Input
              value={label}
              maxLength={200}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={`e.g. ${STORY_TIME_EXAMPLES[1]}`}
            />
          </label>
          <label className="block space-y-1 text-sm">
            <span className="font-medium">Happens after</span>
            <Select value={after} onChange={(e) => setAfter(e.target.value)}>
              <option value="end">At the end</option>
              <option value="">At the very start</option>
              {entries.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.kind === "TIMELINE_EVENT" ? "Event: " : ""}
                  {x.title}
                  {x.label ? ` (${x.label})` : ""}
                </option>
              ))}
            </Select>
          </label>
          <FormError message={create.error} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={create.pending}>
              Add event
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
