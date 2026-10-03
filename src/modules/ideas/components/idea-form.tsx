"use client";

import { BookPlus } from "lucide-react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Field, FormError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { IdeaStatus } from "@/generated/prisma/enums";
import { useAction } from "@/hooks/use-action";

import { promoteIdeaAction, updateIdeaAction } from "../actions";
import { IDEA_STATUS_LABELS } from "../labels";

/** Edit an idea, or turn it into a book. */
export function IdeaForm({
  idea,
}: {
  idea: { id: string; title: string; body: string | null; status: IdeaStatus };
}) {
  const router = useRouter();
  const update = useAction(updateIdeaAction);
  const promote = useAction(promoteIdeaAction);

  return (
    <div className="space-y-4">
      <form
        className="space-y-4"
        action={async (formData) => {
          await update.run(idea.id, formData);
        }}
      >
        <Field label="Idea" htmlFor="idea-edit-title">
          <Input id="idea-edit-title" name="title" defaultValue={idea.title} required />
        </Field>
        <Field label="Details" htmlFor="idea-edit-body">
          <Textarea id="idea-edit-body" name="body" defaultValue={idea.body ?? ""} rows={6} />
        </Field>
        <Field label="Status" htmlFor="idea-edit-status">
          <Select
            id="idea-edit-status"
            name="status"
            defaultValue={idea.status}
            className="sm:w-48"
          >
            {Object.values(IdeaStatus).map((s) => (
              <option key={s} value={s}>
                {IDEA_STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
        </Field>
        <FormError message={update.error ?? promote.error} />
        <div className="flex flex-wrap justify-between gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={promote.pending}
            onClick={async () => {
              const result = await promote.run(idea.id);
              if (result.ok) router.push(`/books/${result.data.id}`);
            }}
          >
            <BookPlus />
            Turn into a book
          </Button>
          <Button type="submit" disabled={update.pending}>
            {update.pending ? "Saving…" : "Save"}
          </Button>
        </div>
      </form>
    </div>
  );
}
