"use client";

import { Boxes, Pencil, Trash2 } from "lucide-react";
import { useState, type ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Field, FormError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { StructureKind } from "@/generated/prisma/enums";
import { useAction } from "@/hooks/use-action";

import {
  applyKitAction,
  createKitAction,
  deleteKitAction,
  saveStructuresAsKitAction,
  updateKitAction,
} from "../actions";
import { STRUCTURE_KIND_LABELS } from "../labels";

type TemplateOption = {
  id: string;
  name: string;
  kind: StructureKind;
  forSeries: boolean;
  builtIn: boolean;
};
type Kit = {
  id: string;
  name: string;
  description: string | null;
  items: { id: string; template: { id: string; name: string; kind: StructureKind } }[];
};
type Option = { id: string; label: string };

/** Create a kit (no `kit`) or change one: a name and the templates it applies. */
export function KitDialog({
  kit,
  templates,
  trigger,
}: {
  kit?: Kit;
  templates: TemplateOption[];
  trigger: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<string[]>(kit?.items.map((i) => i.template.id) ?? []);
  const create = useAction(createKitAction);
  const update = useAction(updateKitAction);
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        setChosen(kit?.items.map((i) => i.template.id) ?? []);
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent
        title={kit ? "Edit kit" : "New template kit"}
        description="Templates applied together. Applying a kit creates new, independent structures."
      >
        <form
          className="space-y-4"
          action={async (formData) => {
            const input = {
              name: String(formData.get("name") ?? ""),
              description: String(formData.get("description") ?? ""),
              templateIds: chosen,
            };
            const result = kit ? await update.run(kit.id, input) : await create.run(input);
            if (result.ok) setOpen(false);
          }}
        >
          <Field label="Kit name" htmlFor="kit-name">
            <Input
              id="kit-name"
              name="name"
              defaultValue={kit?.name}
              placeholder="e.g. My Romantasy Book Kit"
              required
            />
          </Field>
          <Field label="Description" htmlFor="kit-description">
            <Textarea
              id="kit-description"
              name="description"
              rows={2}
              defaultValue={kit?.description ?? ""}
            />
          </Field>
          <fieldset className="space-y-1">
            <legend className="mb-1 text-sm font-medium">
              Templates, in the order you tick them
            </legend>
            <div className="max-h-64 space-y-0.5 overflow-y-auto rounded-md border border-border p-2">
              {templates.map((t) => {
                const index = chosen.indexOf(t.id);
                return (
                  <label
                    key={t.id}
                    className="flex items-center gap-2 rounded px-1 py-1 text-sm hover:bg-muted"
                  >
                    <input
                      type="checkbox"
                      checked={index >= 0}
                      onChange={(e) =>
                        setChosen((list) =>
                          e.target.checked ? [...list, t.id] : list.filter((x) => x !== t.id),
                        )
                      }
                    />
                    <span className="flex-1">
                      {t.name}
                      <span className="text-muted-foreground">
                        {" "}
                        · {STRUCTURE_KIND_LABELS[t.kind].one}
                        {t.forSeries ? " · for a series" : ""}
                        {t.builtIn ? "" : " · yours"}
                      </span>
                    </span>
                    {index >= 0 && <Badge>{index + 1}</Badge>}
                  </label>
                );
              })}
            </div>
          </fieldset>
          <FormError message={create.error ?? update.error} />
          <div className="flex justify-end">
            <Button
              type="submit"
              disabled={create.pending || update.pending || chosen.length === 0}
            >
              {kit ? "Save kit" : "Create kit"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** The author's kits, each with its templates; edit or delete (templates stay). */
export function KitList({ kits, templates }: { kits: Kit[]; templates: TemplateOption[] }) {
  return (
    <ul
      aria-label="Template kits"
      className="divide-y divide-border rounded-xl border border-border bg-surface"
    >
      {kits.map((k) => (
        <li key={k.id} className="flex flex-wrap items-start gap-3 p-4">
          <div className="min-w-0 flex-1 space-y-1">
            <p className="font-medium">{k.name}</p>
            {k.description && <p className="text-sm text-muted-foreground">{k.description}</p>}
            <ol className="flex flex-wrap gap-1.5 text-xs">
              {k.items.map((i) => (
                <li key={i.id}>
                  <Badge>
                    {i.template.name} · {STRUCTURE_KIND_LABELS[i.template.kind].one}
                  </Badge>
                </li>
              ))}
            </ol>
          </div>
          <div className="flex gap-1">
            <KitDialog
              kit={k}
              templates={templates}
              trigger={
                <Button variant="ghost" size="sm" aria-label={`Edit ${k.name}`}>
                  <Pencil />
                </Button>
              }
            />
            <ConfirmDialog
              trigger={
                <Button variant="ghost" size="sm" aria-label={`Delete ${k.name}`}>
                  <Trash2 />
                </Button>
              }
              title={`Delete the kit “${k.name}”?`}
              description={`The kit is removed. Its ${k.items.length === 1 ? "template stays" : `${k.items.length} templates stay`}, and structures made with it are unchanged.`}
              confirmLabel="Delete kit"
              destructive
              onConfirm={deleteKitAction.bind(null, k.id)}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Saves every structure of a book (or series) as templates gathered in a kit. */
export function SaveKitDialog({
  target,
  defaultName,
}: {
  target: { bookId?: string; seriesId?: string };
  defaultName: string;
}) {
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const { run, pending, error } = useAction(saveStructuresAsKitAction);
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        setSaved(false);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Boxes />
          Save as kit
        </Button>
      </DialogTrigger>
      <DialogContent
        title="Save structures as a kit"
        description="Each structure here becomes a template (beats copied, without scene placements), gathered in one kit."
      >
        {saved ? (
          <div className="space-y-4">
            <p role="status" className="text-sm">
              Kit saved. Apply it to another book with “Apply kit”.
            </p>
            <div className="flex justify-end">
              <Button onClick={() => setOpen(false)}>Done</Button>
            </div>
          </div>
        ) : (
          <form
            className="space-y-4"
            action={async (formData) => {
              if ((await run(target, String(formData.get("name") ?? ""))).ok) setSaved(true);
            }}
          >
            <Field label="Kit name" htmlFor="save-kit-name">
              <Input id="save-kit-name" name="name" defaultValue={defaultName} required autoFocus />
            </Field>
            <FormError message={error} />
            <div className="flex justify-end">
              <Button type="submit" disabled={pending}>
                Save kit
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Applies a kit to a book or series. For each romance template the author
 * picks the relationship(s) it's for, and for each character-arc template
 * the character(s); picking none skips that template.
 */
export function ApplyKitDialog({
  kits,
  target,
  relationships,
  characters,
}: {
  kits: Kit[];
  target: { bookId?: string; seriesId?: string };
  relationships: Option[];
  characters: Option[];
}) {
  const [open, setOpen] = useState(false);
  const [kitId, setKitId] = useState(kits[0]?.id ?? "");
  const [owners, setOwners] = useState<Record<string, string[]>>({});
  const [done, setDone] = useState<{ created: number; skipped: number } | null>(null);
  const { run, pending, error } = useAction(applyKitAction);
  const kit = kits.find((k) => k.id === kitId);

  function toggle(itemId: string, id: string, on: boolean) {
    setOwners((o) => ({
      ...o,
      [itemId]: on ? [...(o[itemId] ?? []), id] : (o[itemId] ?? []).filter((x) => x !== id),
    }));
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        setOwners({});
        setDone(null);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" disabled={kits.length === 0}>
          <Boxes />
          Apply kit
        </Button>
      </DialogTrigger>
      <DialogContent title="Apply a template kit" className="max-w-xl">
        {done ? (
          <div className="space-y-4">
            <p role="status" className="text-sm">
              Created {done.created === 1 ? "1 structure" : `${done.created} structures`}
              {done.skipped
                ? ` (${done.skipped === 1 ? "1 template" : `${done.skipped} templates`} skipped)`
                : ""}
              .
            </p>
            <div className="flex justify-end">
              <Button onClick={() => setOpen(false)}>Done</Button>
            </div>
          </div>
        ) : (
          <form
            className="space-y-4"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!kit) return;
              const result = await run({
                kitId: kit.id,
                bookId: target.bookId ?? null,
                seriesId: target.seriesId ?? null,
                owners: Object.fromEntries(
                  kit.items.map((i) => [
                    i.id,
                    i.template.kind === "ROMANCE"
                      ? { relationshipIds: owners[i.id] ?? [] }
                      : { characterIds: owners[i.id] ?? [] },
                  ]),
                ),
              });
              if (result.ok)
                setDone({
                  created: result.data.created.length,
                  skipped: result.data.skipped.length,
                });
            }}
          >
            <Field label="Kit" htmlFor="apply-kit">
              <Select id="apply-kit" value={kitId} onChange={(e) => setKitId(e.target.value)}>
                {kits.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.name}
                  </option>
                ))}
              </Select>
            </Field>
            {kit && (
              <ol aria-label="What the kit creates" className="space-y-3">
                {kit.items.map((item) => {
                  const kind = item.template.kind;
                  const choices =
                    kind === "ROMANCE"
                      ? relationships
                      : kind === "CHARACTER_ARC"
                        ? characters
                        : null;
                  return (
                    <li key={item.id} className="space-y-1 rounded-lg border border-border p-3">
                      <p className="text-sm font-medium">
                        {item.template.name}{" "}
                        <span className="font-normal text-muted-foreground">
                          · {STRUCTURE_KIND_LABELS[kind].one}
                        </span>
                      </p>
                      {choices ? (
                        <fieldset>
                          <legend className="text-xs text-muted-foreground">
                            {kind === "ROMANCE"
                              ? "For which relationship(s)? One romance arc each; none skips it."
                              : "For which character(s)? One arc each; none skips it."}
                          </legend>
                          {choices.length === 0 ? (
                            <p className="text-xs text-muted-foreground">None available yet.</p>
                          ) : (
                            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
                              {choices.map((c) => (
                                <label key={c.id} className="flex items-center gap-1.5 text-sm">
                                  <input
                                    type="checkbox"
                                    checked={(owners[item.id] ?? []).includes(c.id)}
                                    onChange={(e) => toggle(item.id, c.id, e.target.checked)}
                                  />
                                  {c.label}
                                </label>
                              ))}
                            </div>
                          )}
                        </fieldset>
                      ) : (
                        <p className="text-xs text-muted-foreground">Creates one new structure.</p>
                      )}
                    </li>
                  );
                })}
              </ol>
            )}
            <FormError message={error} />
            <div className="flex justify-end">
              <Button type="submit" disabled={pending || !kit}>
                {pending ? "Applying…" : "Apply kit"}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
