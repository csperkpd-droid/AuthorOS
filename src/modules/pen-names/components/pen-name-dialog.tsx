"use client";

import { useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Field, FormError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAction } from "@/hooks/use-action";
import { LANGUAGES } from "@/lib/languages";

import { savePenNameAction } from "../actions";

/** Create (penName omitted) or edit a pen name. */
export function PenNameDialog({
  penName,
  trigger,
}: {
  penName?: { id: string; name: string; bio: string | null; language?: string | null };
  trigger: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const { run, pending, error, setError } = useAction(savePenNameAction);

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setError(null);
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent
        title={penName ? "Edit pen name" : "New pen name"}
        description="A name you publish under. Each series and book belongs to one pen name."
      >
        <form
          className="space-y-4"
          action={async (formData) => {
            const result = await run(penName?.id ?? null, formData);
            if (result.ok) setOpen(false);
          }}
        >
          <Field label="Name" htmlFor="pen-name-name">
            <Input id="pen-name-name" name="name" defaultValue={penName?.name} required autoFocus />
          </Field>
          <Field
            label="Writing language"
            htmlFor="pen-name-language"
            hint="Search in this pen name’s work understands word forms (“running” finds “run”)."
          >
            <Select id="pen-name-language" name="language" defaultValue={penName?.language ?? ""}>
              <option value="">Not set (exact words only)</option>
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Bio" htmlFor="pen-name-bio" hint="Optional. For your reference for now.">
            <Textarea id="pen-name-bio" name="bio" defaultValue={penName?.bio ?? ""} rows={4} />
          </Field>
          <FormError message={error} />
          <div className="flex justify-end">
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : penName ? "Save" : "Create pen name"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
