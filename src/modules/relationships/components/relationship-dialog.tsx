"use client";

import { Plus } from "lucide-react";
import { useId, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Field, FormError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAction } from "@/hooks/use-action";

import { createRelationshipAction, updateRelationshipAction } from "../actions";
import { RELATIONSHIP_TYPE_SUGGESTIONS } from "../schemas";

type Character = { id: string; name: string };

/**
 * Create a relationship between two or more characters (optionally starting
 * from `fromCharacter`; "Add another character" makes it a group such as a
 * triangle or a Why Choose romance), or edit one (`relationship`).
 */
export function RelationshipDialog({
  characters,
  fromCharacter,
  relationship,
  trigger,
}: {
  characters: Character[];
  fromCharacter?: Character;
  relationship?: { id: string; type: string; description: string | null; title: string };
  trigger: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const create = useAction(createRelationshipAction);
  const update = useAction(updateRelationshipAction);
  const id = useId();
  const others = characters.filter((c) => c.id !== fromCharacter?.id);
  const [extra, setExtra] = useState(0);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent title={relationship ? relationship.title : "New relationship"}>
        <form
          className="space-y-4"
          action={async (formData) => {
            const result = relationship
              ? await update.run(relationship.id, formData)
              : await create.run(formData);
            if (result.ok) setOpen(false);
          }}
        >
          {!relationship && (
            <div className="grid gap-4 sm:grid-cols-2">
              {fromCharacter ? (
                <input type="hidden" name="characterId" value={fromCharacter.id} />
              ) : (
                <Field label="Character" htmlFor={`${id}-a`}>
                  <Select id={`${id}-a`} name="characterId" required defaultValue="">
                    <option value="" disabled>
                      Choose…
                    </option>
                    {characters.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
              <Field
                label={fromCharacter ? `${fromCharacter.name} and…` : "And"}
                htmlFor={`${id}-b`}
              >
                <Select id={`${id}-b`} name="otherCharacterId" required defaultValue="">
                  <option value="" disabled>
                    Choose…
                  </option>
                  {others.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </Field>
              {Array.from({ length: extra }, (_, i) => (
                <Field key={i} label={`And (${i + 3})`} htmlFor={`${id}-extra-${i}`}>
                  <Select id={`${id}-extra-${i}`} name="moreCharacterIds" required defaultValue="">
                    <option value="" disabled>
                      Choose…
                    </option>
                    {others.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              ))}
              {others.length > extra + 1 && extra < 10 && (
                <div className="sm:col-span-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setExtra((n) => n + 1)}
                  >
                    <Plus />
                    Add another character
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    For a love triangle, a Why Choose romance or a family: one relationship for the
                    whole group. Pairs within it can be relationships of their own.
                  </p>
                </div>
              )}
            </div>
          )}
          <Field
            label="Type"
            htmlFor={`${id}-type`}
            hint="In a word or two: Romance, Sisters, Rivals…"
          >
            <Input
              id={`${id}-type`}
              name="type"
              list={`${id}-types`}
              defaultValue={relationship?.type}
              required
            />
            <datalist id={`${id}-types`}>
              {RELATIONSHIP_TYPE_SUGGESTIONS.map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
          </Field>
          <Field label="Description" htmlFor={`${id}-description`}>
            <Textarea
              id={`${id}-description`}
              name="description"
              rows={4}
              defaultValue={relationship?.description ?? ""}
            />
          </Field>
          <FormError message={create.error ?? update.error} />
          <div className="flex justify-end">
            <Button type="submit" disabled={create.pending || update.pending}>
              {relationship ? "Save" : "Create relationship"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
