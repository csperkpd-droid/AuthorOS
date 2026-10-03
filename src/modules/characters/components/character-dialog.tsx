"use client";

import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Field, FormError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { CharacterRole } from "@/generated/prisma/enums";
import { useAction } from "@/hooks/use-action";

import { createCharacterAction, updateCharacterAction } from "../actions";
import { CHARACTER_ROLE_LABELS } from "../profile";

type Character = {
  id: string;
  name: string;
  aliases: string[];
  role: CharacterRole;
  summary: string | null;
  series: { id: string } | null;
};

/** Create a character (no `character`) or edit one. */
export function CharacterDialog({
  character,
  seriesOptions,
  trigger,
}: {
  character?: Character;
  seriesOptions: { id: string; title: string }[];
  trigger: ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const create = useAction(createCharacterAction);
  const update = useAction(updateCharacterAction);
  const id = character?.id ?? "new-character";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent title={character ? "Character details" : "New character"}>
        <form
          className="space-y-4"
          action={async (formData) => {
            if (character) {
              if ((await update.run(character.id, formData)).ok) setOpen(false);
              return;
            }
            const result = await create.run(formData);
            if (result.ok) router.push(`/characters/${result.data.id}`);
          }}
        >
          <Field label="Name" htmlFor={`${id}-name`}>
            <Input
              id={`${id}-name`}
              name="name"
              defaultValue={character?.name}
              required
              autoFocus
            />
          </Field>
          <Field
            label="Also known as"
            htmlFor={`${id}-aliases`}
            hint="Nicknames or titles, separated by commas."
          >
            <Input
              id={`${id}-aliases`}
              name="aliases"
              defaultValue={character?.aliases.join(", ")}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Role" htmlFor={`${id}-role`}>
              <Select id={`${id}-role`} name="role" defaultValue={character?.role ?? "SUPPORTING"}>
                {Object.values(CharacterRole).map((r) => (
                  <option key={r} value={r}>
                    {CHARACTER_ROLE_LABELS[r]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Series" htmlFor={`${id}-series`}>
              <Select
                id={`${id}-series`}
                name="seriesId"
                defaultValue={character?.series?.id ?? ""}
              >
                <option value="">Any (not tied to a series)</option>
                {seriesOptions.map((s) => (
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
              defaultValue={character?.summary ?? ""}
              rows={3}
            />
          </Field>
          <FormError message={create.error ?? update.error} />
          <div className="flex justify-end">
            <Button type="submit" disabled={create.pending || update.pending}>
              {create.pending || update.pending
                ? "Saving…"
                : character
                  ? "Save"
                  : "Create character"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
