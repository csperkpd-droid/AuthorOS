"use client";

import { Lightbulb } from "lucide-react";
import { useRef } from "react";

import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useAction } from "@/hooks/use-action";

import { createIdeaAction } from "../actions";

/** Quick capture: write the idea down before it escapes. */
export function IdeaCapture() {
  const form = useRef<HTMLFormElement>(null);
  const { run, pending, error } = useAction(createIdeaAction);

  return (
    <form
      ref={form}
      className="space-y-2 rounded-xl border border-border bg-surface p-4"
      action={async (formData) => {
        if ((await run(formData)).ok) form.current?.reset();
      }}
    >
      <label htmlFor="idea-title" className="text-sm font-medium">
        New idea
      </label>
      <Input id="idea-title" name="title" placeholder="What if…" required />
      <Textarea aria-label="Idea details" name="body" placeholder="Details (optional)" rows={2} />
      <FormError message={error} />
      <div className="flex justify-end">
        <Button type="submit" size="sm" disabled={pending}>
          <Lightbulb />
          Save idea
        </Button>
      </div>
    </form>
  );
}
