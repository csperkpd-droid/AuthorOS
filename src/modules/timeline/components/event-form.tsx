"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useAction } from "@/hooks/use-action";

import { updateTimelineEventAction } from "../actions";

/** A timeline event's name, story time and description. Stale forms are refused. */
export function TimelineEventForm({
  event,
  canEdit,
}: {
  event: {
    id: string;
    title: string;
    label: string | null;
    description: string | null;
    updatedAt: string;
  };
  canEdit: boolean;
}) {
  const save = useAction(updateTimelineEventAction);
  const [saved, setSaved] = useState(false);
  return (
    <form
      className="max-w-prose space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setSaved(false);
        const result = await save.run(event.id, new FormData(e.currentTarget));
        if (result.ok) setSaved(true);
      }}
    >
      <input type="hidden" name="updatedAt" value={event.updatedAt} />
      <label className="block space-y-1 text-sm">
        <span className="font-medium">Event</span>
        <Input name="title" defaultValue={event.title} required disabled={!canEdit} />
      </label>
      <label className="block space-y-1 text-sm">
        <span className="font-medium">Story time</span>
        <Input
          name="label"
          defaultValue={event.label ?? ""}
          maxLength={200}
          placeholder="e.g. Ten years earlier"
          disabled={!canEdit}
        />
        <span className="block text-xs text-muted-foreground">
          Your own words. It’s never read as a date.
        </span>
      </label>
      <label className="block space-y-1 text-sm">
        <span className="font-medium">What happens</span>
        <Textarea
          name="description"
          defaultValue={event.description ?? ""}
          rows={6}
          disabled={!canEdit}
        />
      </label>
      <FormError message={save.error} />
      {canEdit && (
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={save.pending}>
            Save
          </Button>
          {saved && (
            <span role="status" className="text-sm text-muted-foreground">
              Saved
            </span>
          )}
        </div>
      )}
    </form>
  );
}
