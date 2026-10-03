"use client";

import { useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Field, FormError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useAction } from "@/hooks/use-action";

import { createEventAction, updateEventAction } from "../actions";

type Event = {
  id: string;
  title: string;
  description: string | null;
  startsOn: string;
  endsOn: string | null;
  startTime: string | null;
  updatedAt?: Date | string;
};

/** Create a calendar event (optionally about a story object) or edit one. */
export function EventDialog({
  event,
  defaultDate,
  concerns,
  trigger,
}: {
  event?: Event;
  defaultDate?: string;
  concerns?: { id: string; title: string };
  trigger: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const create = useAction(createEventAction);
  const update = useAction(updateEventAction);
  const id = event?.id ?? "new-event";
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent
        title={event ? "Event details" : "New event"}
        description={concerns ? `For “${concerns.title}”.` : undefined}
      >
        <form
          className="space-y-4"
          action={async (formData) => {
            const input = {
              title: String(formData.get("title") ?? ""),
              description: String(formData.get("description") ?? ""),
              startsOn: String(formData.get("startsOn") ?? ""),
              endsOn: String(formData.get("endsOn") ?? ""),
              startTime: String(formData.get("startTime") ?? ""),
            };
            const result = event
              ? await update.run(
                  event.id,
                  input,
                  event.updatedAt ? new Date(event.updatedAt).toISOString() : undefined,
                )
              : await create.run({ ...input, concernsId: concerns?.id ?? null });
            if (result.ok) setOpen(false);
          }}
        >
          <Field label="Event" htmlFor={`${id}-title`}>
            <Input
              id={`${id}-title`}
              name="title"
              defaultValue={event?.title}
              placeholder="e.g. Cover reveal"
              required
              autoFocus
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Date" htmlFor={`${id}-starts`}>
              <Input
                id={`${id}-starts`}
                name="startsOn"
                type="date"
                defaultValue={event?.startsOn ?? defaultDate}
                required
              />
            </Field>
            <Field label="Until (optional)" htmlFor={`${id}-ends`}>
              <Input
                id={`${id}-ends`}
                name="endsOn"
                type="date"
                defaultValue={event?.endsOn ?? ""}
              />
            </Field>
            <Field label="Time (optional)" htmlFor={`${id}-time`}>
              <Input
                id={`${id}-time`}
                name="startTime"
                type="time"
                defaultValue={event?.startTime ?? ""}
              />
            </Field>
          </div>
          <Field label="Notes" htmlFor={`${id}-description`}>
            <Textarea
              id={`${id}-description`}
              name="description"
              rows={3}
              defaultValue={event?.description ?? ""}
            />
          </Field>
          <FormError message={create.error ?? update.error} />
          <div className="flex justify-end">
            <Button type="submit" disabled={create.pending || update.pending}>
              {event ? "Save" : "Add event"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
