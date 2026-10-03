"use client";

import { Pencil, Trash2 } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, FormError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { StructureKind } from "@/generated/prisma/enums";
import { useAction } from "@/hooks/use-action";

import { deleteTemplateAction, renameTemplateAction } from "../actions";
import { STRUCTURE_KIND_LABELS } from "../labels";

type Template = {
  id: string;
  kind: StructureKind;
  name: string;
  description: string | null;
  source: string | null;
  builtIn: boolean;
  forSeries: boolean;
  beatCount: number;
};

/** Built-in and saved templates; the author's own can be renamed or deleted. */
export function TemplateList({ templates }: { templates: Template[] }) {
  const [editing, setEditing] = useState<Template | null>(null);
  return (
    <>
      <ul
        aria-label="Templates"
        className="divide-y divide-border rounded-xl border border-border bg-surface"
      >
        {templates.map((t) => (
          <li key={t.id} className="flex flex-wrap items-center gap-3 p-4">
            <div className="min-w-0 flex-1">
              <p className="font-medium">{t.name}</p>
              <p className="text-xs text-muted-foreground">
                {STRUCTURE_KIND_LABELS[t.kind].one} · {t.beatCount} beats
                {t.source && ` · ${t.source}`}
                {t.forSeries && " · for a series"}
              </p>
              {t.description && (
                <p className="mt-1 text-sm text-muted-foreground">{t.description}</p>
              )}
            </div>
            {t.builtIn ? (
              <Badge>Built in</Badge>
            ) : (
              <div className="flex gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Rename ${t.name}`}
                  onClick={() => setEditing(t)}
                >
                  <Pencil />
                </Button>
                <ConfirmDialog
                  trigger={
                    <Button variant="ghost" size="sm" aria-label={`Delete ${t.name}`}>
                      <Trash2 />
                    </Button>
                  }
                  title={`Delete the template “${t.name}”?`}
                  description="Structures made from it keep their beats; they were copies."
                  confirmLabel="Delete template"
                  destructive
                  onConfirm={deleteTemplateAction.bind(null, t.id)}
                />
              </div>
            )}
          </li>
        ))}
      </ul>
      <RenameDialog template={editing} onClose={() => setEditing(null)} />
    </>
  );
}

function RenameDialog({ template, onClose }: { template: Template | null; onClose: () => void }) {
  const { run, pending, error } = useAction(renameTemplateAction);
  return (
    <Dialog open={template !== null} onOpenChange={(o) => !o && onClose()}>
      {template && (
        <DialogContent title="Rename template">
          <form
            className="space-y-4"
            action={async (formData) => {
              const result = await run(template.id, {
                name: String(formData.get("name") ?? ""),
                description: String(formData.get("description") ?? ""),
              });
              if (result.ok) onClose();
            }}
          >
            <Field label="Template name" htmlFor="rename-template-name">
              <Input id="rename-template-name" name="name" defaultValue={template.name} required />
            </Field>
            <Field label="Description" htmlFor="rename-template-description">
              <Textarea
                id="rename-template-description"
                name="description"
                rows={2}
                defaultValue={template.description ?? ""}
              />
            </Field>
            <FormError message={error} />
            <div className="flex justify-end">
              <Button type="submit" disabled={pending}>
                Save
              </Button>
            </div>
          </form>
        </DialogContent>
      )}
    </Dialog>
  );
}
