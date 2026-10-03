"use client";

import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Field, FormError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { StructureKind } from "@/generated/prisma/enums";
import { useAction } from "@/hooks/use-action";

import { createOutlineAction } from "../actions";
import { STRUCTURE_KIND_LABELS } from "../labels";

type Option = { id: string; label: string };
type Template = {
  id: string;
  kind: StructureKind;
  name: string;
  beatCount: number;
  source: string | null;
};

/**
 * Applies a structure to a book. Romance arcs need a relationship and
 * character arcs a character; defaults let pages pre-fill (e.g. from a
 * relationship's page).
 */
export function NewStructureDialog({
  books,
  relationships,
  characters,
  templates,
  defaults = {},
  trigger,
}: {
  books: Option[];
  relationships: Option[];
  characters: Option[];
  templates: Template[];
  defaults?: {
    bookId?: string;
    kind?: StructureKind;
    relationshipId?: string;
    characterId?: string;
  };
  trigger: ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<StructureKind>(defaults.kind ?? "PLOT");
  const { run, pending, error } = useAction(createOutlineAction);
  const forKind = templates.filter(
    (t) => t.kind === kind || kind === "SUBPLOT" || kind === "CUSTOM",
  );
  const firstTemplate = kind === "SUBPLOT" || kind === "CUSTOM" ? "" : (forKind[0]?.id ?? "");

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent title="New structure" description={STRUCTURE_KIND_LABELS[kind].hint}>
        <form
          className="space-y-4"
          action={async (formData) => {
            const result = await run({
              bookId: String(formData.get("bookId") ?? ""),
              kind,
              templateId: String(formData.get("templateId") ?? "") || null,
              title: String(formData.get("title") ?? ""),
              relationshipId: String(formData.get("relationshipId") ?? "") || null,
              characterId: String(formData.get("characterId") ?? "") || null,
            });
            if (result.ok) router.push(`/structure/${result.data.id}`);
          }}
        >
          <Field label="Kind" htmlFor="structure-kind">
            <Select
              id="structure-kind"
              value={kind}
              onChange={(e) => setKind(e.target.value as StructureKind)}
            >
              {Object.values(StructureKind).map((k) => (
                <option key={k} value={k}>
                  {STRUCTURE_KIND_LABELS[k].one}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Book" htmlFor="structure-book">
            <Select
              id="structure-book"
              name="bookId"
              defaultValue={defaults.bookId ?? books[0]?.id}
              required
            >
              {books.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.label}
                </option>
              ))}
            </Select>
          </Field>
          {kind === "ROMANCE" && (
            <Field label="Relationship" htmlFor="structure-relationship">
              <Select
                id="structure-relationship"
                name="relationshipId"
                defaultValue={defaults.relationshipId ?? ""}
                required
              >
                <option value="" disabled>
                  Choose…
                </option>
                {relationships.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          {kind === "CHARACTER_ARC" && (
            <Field label="Character" htmlFor="structure-character">
              <Select
                id="structure-character"
                name="characterId"
                defaultValue={defaults.characterId ?? ""}
                required
              >
                <option value="" disabled>
                  Choose…
                </option>
                {characters.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field label="Template" htmlFor="structure-template">
            <Select
              id="structure-template"
              name="templateId"
              key={kind}
              defaultValue={firstTemplate}
            >
              <option value="">No template (add your own beats)</option>
              {forKind.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.beatCount} beats{t.source ? `, ${t.source}` : ""})
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Name"
            htmlFor="structure-title"
            hint="Optional; defaults to the template’s name."
          >
            <Input id="structure-title" name="title" />
          </Field>
          <FormError message={error} />
          <div className="flex justify-end">
            <Button type="submit" disabled={pending || books.length === 0}>
              {pending ? "Creating…" : "Create structure"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
