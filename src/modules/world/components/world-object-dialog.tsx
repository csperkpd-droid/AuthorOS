"use client";

import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Field, FormError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAction } from "@/hooks/use-action";

import {
  createPlaceAction,
  createWorldEntryAction,
  updatePlaceAction,
  updateWorldEntryAction,
} from "../actions";

type WorldObject = {
  id: string;
  name: string;
  summary: string | null;
  penNameId: string;
  series: { id: string } | null;
  entryType?: string;
  updatedAt?: Date | string;
};

const COPY = {
  PLACE: { new: "New place", edit: "Place details", create: "Create place", path: "/places" },
  WORLD_ENTRY: {
    new: "New world entry",
    edit: "World entry details",
    create: "Create entry",
    path: "/world-entries",
  },
} as const;

/**
 * Create a place or world entry (no `object`) or edit one. It belongs to one
 * pen name and optionally to one of its series, like a character.
 */
export function WorldObjectDialog({
  kind,
  object,
  penNames,
  defaultPenNameId,
  seriesOptions,
  entryTypes = [],
  defaultEntryType,
  trigger,
}: {
  kind: "PLACE" | "WORLD_ENTRY";
  object?: WorldObject;
  penNames: { id: string; name: string }[];
  defaultPenNameId: string;
  seriesOptions: { id: string; title: string; penName: { id: string } }[];
  /** World entries: the types to suggest (the author may type any other). */
  entryTypes?: string[];
  defaultEntryType?: string;
  trigger: ReactNode;
}) {
  const [penNameId, setPenNameId] = useState(object?.penNameId ?? defaultPenNameId);
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const create = useAction(kind === "PLACE" ? createPlaceAction : createWorldEntryAction);
  const update = useAction(kind === "PLACE" ? updatePlaceAction : updateWorldEntryAction);
  const copy = COPY[kind];
  const id = object?.id ?? `new-${kind.toLowerCase()}`;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent title={object ? copy.edit : copy.new}>
        <form
          className="space-y-4"
          action={async (formData) => {
            if (object) {
              if ((await update.run(object.id, formData)).ok) setOpen(false);
              return;
            }
            const result = await create.run(formData);
            if (result.ok) router.push(`${copy.path}/${result.data.id}`);
          }}
        >
          <Field label="Name" htmlFor={`${id}-name`}>
            <Input id={`${id}-name`} name="name" defaultValue={object?.name} required autoFocus />
          </Field>
          {kind === "WORLD_ENTRY" && (
            <Field
              label="Type"
              htmlFor={`${id}-type`}
              hint="What it is, in your words: an organization, an item, or anything else."
            >
              <Input
                id={`${id}-type`}
                name="entryType"
                list={`${id}-types`}
                defaultValue={object?.entryType ?? defaultEntryType ?? ""}
                required
              />
              <datalist id={`${id}-types`}>
                {entryTypes.map((t) => (
                  <option key={t} value={t} />
                ))}
              </datalist>
            </Field>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            {penNames.length > 1 ? (
              <Field label="Pen name" htmlFor={`${id}-pen-name`}>
                <Select
                  id={`${id}-pen-name`}
                  name="penNameId"
                  value={penNameId}
                  onChange={(e) => setPenNameId(e.target.value)}
                >
                  {penNames.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : (
              <input type="hidden" name="penNameId" value={penNameId} />
            )}
            <Field label="Series" htmlFor={`${id}-series`}>
              <Select
                id={`${id}-series`}
                name="seriesId"
                key={penNameId}
                defaultValue={
                  seriesOptions.some(
                    (s) => s.id === object?.series?.id && s.penName.id === penNameId,
                  )
                    ? object?.series?.id
                    : ""
                }
              >
                <option value="">Any book of this pen name</option>
                {seriesOptions
                  .filter((s) => s.penName.id === penNameId)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.title}
                    </option>
                  ))}
              </Select>
            </Field>
          </div>
          <Field label="Summary" htmlFor={`${id}-summary`}>
            <Textarea
              id={`${id}-summary`}
              name="summary"
              defaultValue={object?.summary ?? ""}
              rows={3}
            />
          </Field>
          <FormError message={create.error ?? update.error} />
          <div className="flex justify-end">
            <Button type="submit" disabled={create.pending || update.pending}>
              {create.pending || update.pending ? "Saving…" : object ? "Save" : copy.create}
            </Button>
          </div>
          {object?.updatedAt && (
            <input
              type="hidden"
              name="updatedAt"
              value={new Date(object.updatedAt).toISOString()}
            />
          )}
        </form>
      </DialogContent>
    </Dialog>
  );
}
