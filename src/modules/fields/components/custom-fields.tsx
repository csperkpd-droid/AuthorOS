"use client";

import { Plus, X } from "lucide-react";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FormError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { FieldType, StoryNodeKind } from "@/generated/prisma/enums";
import { useAction } from "@/hooks/use-action";

import { createFieldAction, deleteFieldAction, setFieldValueAction } from "../actions";

type Definition = { id: string; label: string; type: FieldType; penNameId: string | null };

/**
 * The author's own fields for this kind of object (e.g. "Love language" on
 * characters). Values save when you leave a field; a new field appears on
 * every object of the kind, or only on this pen name's.
 */
export function CustomFields({
  nodeId,
  nodeKind,
  penNameId,
  definitions,
  values,
}: {
  nodeId: string;
  nodeKind: StoryNodeKind;
  penNameId: string | null;
  definitions: Definition[];
  values: Record<string, string>;
}) {
  const save = useAction(setFieldValueAction);
  const [saved, setSaved] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const lastSaved = useRef<Record<string, string>>({ ...values });

  async function saveValue(fieldId: string, value: string) {
    if ((lastSaved.current[fieldId] ?? "") === value) return;
    const result = await save.run(nodeId, fieldId, value);
    if (result.ok) {
      lastSaved.current[fieldId] = value;
      setSaved(fieldId);
    }
  }

  return (
    <section aria-labelledby="custom-fields-heading" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="custom-fields-heading" className="font-serif text-xl">
          Your fields
        </h2>
        {!adding && (
          <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
            <Plus />
            Add field
          </Button>
        )}
      </div>
      {definitions.length === 0 && !adding && (
        <p className="text-sm text-muted-foreground">
          Track anything else you need, such as a love language or magic type.
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        {definitions.map((d) => {
          const id = `field-${d.id}`;
          const common = {
            id,
            defaultValue: values[d.id] ?? "",
            onBlur: (e: { target: { value: string } }) => void saveValue(d.id, e.target.value),
          };
          return (
            <div
              key={d.id}
              className={d.type === "LONG_TEXT" ? "space-y-1.5 sm:col-span-2" : "space-y-1.5"}
            >
              <div className="flex items-baseline justify-between gap-2">
                <Label htmlFor={id}>{d.label}</Label>
                <span className="flex items-center gap-1">
                  {saved === d.id && (
                    <span role="status" className="text-xs text-muted-foreground">
                      Saved
                    </span>
                  )}
                  <ConfirmDialog
                    trigger={
                      <button
                        type="button"
                        aria-label={`Remove the ${d.label} field`}
                        className="rounded p-0.5 text-muted-foreground hover:bg-muted"
                      >
                        <X className="size-3.5" aria-hidden />
                      </button>
                    }
                    title={`Remove the “${d.label}” field?`}
                    description="It disappears from every item that has it, with the values filled in."
                    confirmLabel="Remove field"
                    destructive
                    onConfirm={deleteFieldAction.bind(null, d.id)}
                  />
                </span>
              </div>
              {d.type === "LONG_TEXT" ? <Textarea rows={3} {...common} /> : <Input {...common} />}
            </div>
          );
        })}
      </div>
      {adding && (
        <NewFieldForm nodeKind={nodeKind} penNameId={penNameId} onDone={() => setAdding(false)} />
      )}
      <FormError message={save.error} />
    </section>
  );
}

function NewFieldForm({
  nodeKind,
  penNameId,
  onDone,
}: {
  nodeKind: StoryNodeKind;
  penNameId: string | null;
  onDone: () => void;
}) {
  const create = useAction(createFieldAction);
  return (
    <form
      aria-label="New field"
      className="flex flex-wrap items-end gap-3 rounded-lg border border-dashed border-border p-3"
      action={async (formData) => {
        const result = await create.run({
          nodeKind,
          label: String(formData.get("label") ?? ""),
          type: formData.get("type") === "LONG_TEXT" ? "LONG_TEXT" : "TEXT",
          penNameId: formData.get("thisPenName") && penNameId ? penNameId : null,
        });
        if (result.ok) onDone();
      }}
    >
      <div className="min-w-40 flex-1 space-y-1.5">
        <Label htmlFor="new-field-label">Field name</Label>
        <Input
          id="new-field-label"
          name="label"
          required
          autoFocus
          placeholder="e.g. Love language"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="new-field-type">Kind</Label>
        <Select id="new-field-type" name="type" defaultValue="TEXT">
          <option value="TEXT">Short text</option>
          <option value="LONG_TEXT">Long text</option>
        </Select>
      </div>
      {penNameId && (
        <label className="flex h-9 items-center gap-2 text-sm">
          <input type="checkbox" name="thisPenName" />
          Only this pen name
        </label>
      )}
      <div className="flex gap-2">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={create.pending}>
          Add
        </Button>
      </div>
      <div className="w-full">
        <FormError message={create.error} />
      </div>
    </form>
  );
}
