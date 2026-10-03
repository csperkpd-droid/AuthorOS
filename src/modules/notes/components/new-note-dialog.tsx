"use client";

import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Field, FormError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useAction } from "@/hooks/use-action";

import { createNoteAction } from "../actions";

/** Creates a note, optionally about a story object, and opens it. */
export function NewNoteDialog({
  about,
  trigger,
}: {
  about?: { id: string; title: string };
  trigger: ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const { run, pending, error } = useAction(createNoteAction);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent title="New note" description={about ? `About “${about.title}”.` : undefined}>
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            const result = await run(title, about?.id);
            if (result.ok) router.push(`/notes/${result.data.id}`);
          }}
        >
          <Field label="Title" htmlFor="new-note-title">
            <Input
              id="new-note-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              autoFocus
            />
          </Field>
          <FormError message={error} />
          <div className="flex justify-end">
            <Button type="submit" disabled={pending}>
              {pending ? "Creating…" : "Create note"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
