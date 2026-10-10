"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { FormError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useAction } from "@/hooks/use-action";

import { createTropeAction, updateTropeAction } from "../actions";

/** A trope's name and description. Stale forms are refused; the description keeps history. */
export function TropeForm({
  trope,
  canEdit,
}: {
  trope: { id: string; name: string; description: string | null; updatedAt: string };
  canEdit: boolean;
}) {
  const save = useAction(updateTropeAction);
  const [saved, setSaved] = useState(false);
  // When the stored trope changes from elsewhere (restoring an earlier
  // version), show its description; after the author's own save the field
  // already matches. Only while the field still shows the last stored or
  // saved text: a refresh that arrives after the author started typing again
  // never replaces their words.
  const description = useRef<HTMLTextAreaElement>(null);
  const shown = useRef(trope.description ?? "");
  useEffect(() => {
    const field = description.current;
    const stored = trope.description ?? "";
    if (field && field.value === shown.current) field.value = stored;
    shown.current = stored;
  }, [trope.description, trope.updatedAt]);
  return (
    <form
      className="max-w-prose space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setSaved(false);
        const data = new FormData(e.currentTarget);
        const result = await save.run(trope.id, data);
        if (result.ok) {
          shown.current = String(data.get("description") ?? "");
          setSaved(true);
        }
      }}
    >
      <input type="hidden" name="updatedAt" value={trope.updatedAt} />
      <label className="block space-y-1 text-sm">
        <span className="font-medium">Name</span>
        <Input name="name" defaultValue={trope.name} required maxLength={200} disabled={!canEdit} />
      </label>
      <label className="block space-y-1 text-sm">
        <span className="font-medium">What it means in your books</span>
        <Textarea
          ref={description}
          name="description"
          defaultValue={trope.description ?? ""}
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

/** "New trope": an existing name opens the existing trope instead of a copy. */
export function NewTropeDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const create = useAction(createTropeAction);
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        create.setError(null);
        if (o) setName("");
      }}
    >
      <DialogTrigger asChild>
        <Button>New trope</Button>
      </DialogTrigger>
      <DialogContent title="New trope" description="A trope you can add to books, series and more.">
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            const result = await create.run(name);
            if (result.ok) router.push(`/tropes/${result.data.id}`);
          }}
        >
          <label className="block space-y-1 text-sm">
            <span className="font-medium">Name</span>
            <Input
              value={name}
              maxLength={200}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Enemies to lovers"
              autoFocus
            />
          </label>
          <FormError message={create.error} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={create.pending}>
              Create trope
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
