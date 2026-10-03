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

import { createSeriesAction, updateSeriesAction } from "../actions";

type Option = { id: string; name: string };

export function SeriesDialog({
  series,
  penNames,
  defaultPenNameId,
  trigger,
}: {
  series?: { id: string; title: string; description: string | null; penName: Option };
  penNames: Option[];
  defaultPenNameId?: string;
  trigger: ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const create = useAction(createSeriesAction);
  const update = useAction(updateSeriesAction);
  const pending = create.pending || update.pending;
  const error = create.error ?? update.error;
  const penOptions =
    series && !penNames.some((p) => p.id === series.penName.id)
      ? [...penNames, series.penName]
      : penNames;
  const id = series?.id ?? "new-series";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent title={series ? "Series details" : "New series"}>
        <form
          className="space-y-4"
          action={async (formData) => {
            if (series) {
              if ((await update.run(series.id, formData)).ok) setOpen(false);
              return;
            }
            const result = await create.run(formData);
            if (result.ok) router.push(`/library/series/${result.data.id}`);
          }}
        >
          <Field label="Title" htmlFor={`${id}-title`}>
            <Input
              id={`${id}-title`}
              name="title"
              defaultValue={series?.title}
              required
              autoFocus
            />
          </Field>
          {series ? (
            <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
              Published as <strong className="text-foreground">{series.penName.name}</strong>. To
              move the series to another pen name, use “Change pen name…”: you’ll see what moves
              with it first.
            </p>
          ) : (
            <Field label="Pen name" htmlFor={`${id}-pen`}>
              <Select id={`${id}-pen`} name="penNameId" defaultValue={defaultPenNameId}>
                {penOptions.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field label="Description" htmlFor={`${id}-description`}>
            <Textarea
              id={`${id}-description`}
              name="description"
              defaultValue={series?.description ?? ""}
              rows={4}
            />
          </Field>
          <FormError message={error} />
          <div className="flex justify-end">
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : series ? "Save" : "Create series"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
