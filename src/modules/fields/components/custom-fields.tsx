"use client";

import { Plus, X } from "lucide-react";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { FieldType, StoryNodeKind } from "@/generated/prisma/enums";
import { useAction } from "@/hooks/use-action";
import { ImpactDialog } from "@/modules/impact/ui";

import {
  createFieldAction,
  deleteFieldAction,
  previewDeleteFieldAction,
  setFieldValueAction,
} from "../actions";

type Definition = { id: string; label: string; type: FieldType; scope: string };
type ScopeOption = { value: string; label: string };

/**
 * The author's own fields for this kind of object (e.g. "Love language" on
 * characters). Values save when you leave a field; a new field appears on
 * every object of the kind, or only on this pen name's.
 */
export function CustomFields({
  nodeId,
  nodeKind,
  scopeOptions,
  definitions,
  values,
}: {
  nodeId: string;
  nodeKind: StoryNodeKind;
  /** Where a new field may apply; the first is the default (the pen name). */
  scopeOptions: ScopeOption[];
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
                <Label htmlFor={id} title={d.scope}>
                  {d.label}
                </Label>
                <span className="flex items-center gap-1">
                  {saved === d.id && (
                    <span role="status" className="text-xs text-muted-foreground">
                      Saved
                    </span>
                  )}
                  <ImpactDialog
                    trigger={
                      <button
                        type="button"
                        aria-label={`Remove the ${d.label} field`}
                        className="rounded p-0.5 text-muted-foreground hover:bg-muted"
                      >
                        <X className="size-3.5" aria-hidden />
                      </button>
                    }
                    title={`Delete the “${d.label}” field?`}
                    loadReport={previewDeleteFieldAction.bind(null, d.id)}
                    onConfirm={deleteFieldAction.bind(null, d.id)}
                    confirmLabel="Delete field"
                  />
                </span>
              </div>
              {d.type === "LONG_TEXT" ? <Textarea rows={3} {...common} /> : <Input {...common} />}
            </div>
          );
        })}
      </div>
      {adding && (
        <NewFieldForm
          nodeKind={nodeKind}
          scopeOptions={scopeOptions}
          onDone={() => setAdding(false)}
        />
      )}
      <FormError message={save.error} />
    </section>
  );
}

function NewFieldForm({
  nodeKind,
  scopeOptions,
  onDone,
}: {
  nodeKind: StoryNodeKind;
  scopeOptions: ScopeOption[];
  onDone: () => void;
}) {
  const create = useAction(createFieldAction);
  return (
    <form
      aria-label="New field"
      className="flex flex-wrap items-end gap-3 rounded-lg border border-dashed border-border p-3"
      action={async (formData) => {
        const [scope, scopeId] = String(formData.get("scope") ?? "all").split(":");
        const result = await create.run({
          nodeKind,
          label: String(formData.get("label") ?? ""),
          type: formData.get("type") === "LONG_TEXT" ? "LONG_TEXT" : "TEXT",
          penNameId: scope === "pen" ? scopeId : null,
          seriesId: scope === "series" ? scopeId : null,
          bookId: scope === "book" ? scopeId : null,
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
      <div className="space-y-1.5">
        <Label htmlFor="new-field-scope">Applies to</Label>
        <Select id="new-field-scope" name="scope" defaultValue={scopeOptions[0]?.value}>
          {scopeOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      </div>
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
