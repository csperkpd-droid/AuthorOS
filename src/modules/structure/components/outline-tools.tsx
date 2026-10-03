"use client";

import { BookmarkPlus } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Field, FormError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ArcRole } from "@/generated/prisma/enums";
import { useAction } from "@/hooks/use-action";

import { saveAsTemplateAction, setArcRoleAction } from "../actions";
import { ARC_ROLE_LABELS } from "../labels";

/**
 * Saves this structure's beats as a reusable template. Applying the template
 * later creates new, independent structures and beats.
 */
export function SaveTemplateDialog({
  outlineId,
  defaultName,
  forSeries,
}: {
  outlineId: string;
  defaultName: string;
  forSeries: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const { run, pending, error } = useAction(saveAsTemplateAction);
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        setSaved(false);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline">
          <BookmarkPlus />
          Save as template
        </Button>
      </DialogTrigger>
      <DialogContent
        title="Save as template"
        description={
          forSeries
            ? "Copies these beats, with the book each is planned for, into a template you can apply to another series."
            : "Copies these beats into a template you can apply to other books."
        }
      >
        {saved ? (
          <div className="space-y-4">
            <p role="status" className="text-sm">
              Template saved. It appears under “Template” when you create a new structure.
            </p>
            <div className="flex justify-end">
              <Button onClick={() => setOpen(false)}>Done</Button>
            </div>
          </div>
        ) : (
          <form
            className="space-y-4"
            action={async (formData) => {
              const result = await run(outlineId, {
                name: String(formData.get("name") ?? ""),
                description: String(formData.get("description") ?? ""),
              });
              if (result.ok) setSaved(true);
            }}
          >
            <Field label="Template name" htmlFor="template-name">
              <Input id="template-name" name="name" defaultValue={defaultName} required autoFocus />
            </Field>
            <Field label="Description" htmlFor="template-description">
              <Textarea id="template-description" name="description" rows={2} />
            </Field>
            <p className="text-xs text-muted-foreground">
              Scene placements aren’t copied, and later edits to this structure or the template
              never affect each other.
            </p>
            <FormError message={error} />
            <div className="flex justify-end">
              <Button type="submit" disabled={pending}>
                {pending ? "Saving…" : "Save template"}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Main or secondary couple, for romance arcs (orders the Romance Center). */
export function ArcRoleSelect({ outlineId, value }: { outlineId: string; value: ArcRole }) {
  const { run, error } = useAction(setArcRoleAction);
  return (
    <span className="inline-flex items-center gap-2">
      <Select
        aria-label="Couple"
        value={value}
        onChange={(e) => run(outlineId, e.target.value as ArcRole)}
        className="h-8 w-auto text-sm"
      >
        {Object.values(ArcRole).map((r) => (
          <option key={r} value={r}>
            {ARC_ROLE_LABELS[r]}
          </option>
        ))}
      </Select>
      <FormError message={error} />
    </span>
  );
}
