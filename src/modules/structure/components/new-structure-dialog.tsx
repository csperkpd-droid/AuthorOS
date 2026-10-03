"use client";

import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Field, FormError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { ArcRole, StructureKind } from "@/generated/prisma/enums";
import { useAction } from "@/hooks/use-action";

import { createOutlineAction } from "../actions";
import { ARC_ROLE_LABELS, STRUCTURE_KIND_LABELS } from "../labels";

type Option = { id: string; label: string };
type Template = {
  id: string;
  kind: StructureKind;
  name: string;
  beatCount: number;
  source: string | null;
  builtIn: boolean;
  forSeries: boolean;
};

/**
 * Applies a structure to a book or to a whole series. Romance arcs need a
 * relationship and character arcs a character; defaults let pages pre-fill
 * (e.g. from a relationship's or a series' page). A template's beats are
 * copied into the new structure.
 */
export function NewStructureDialog({
  books,
  series = [],
  relationships,
  characters,
  templates,
  defaults = {},
  trigger,
}: {
  books: Option[];
  series?: Option[];
  relationships: Option[];
  characters: Option[];
  templates: Template[];
  defaults?: {
    bookId?: string;
    seriesId?: string;
    kind?: StructureKind;
    relationshipId?: string;
    characterId?: string;
  };
  trigger: ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<StructureKind>(defaults.kind ?? "PLOT");
  const [target, setTarget] = useState(
    defaults.seriesId
      ? `series:${defaults.seriesId}`
      : `book:${defaults.bookId ?? books[0]?.id ?? series[0]?.id ?? ""}`,
  );
  const { run, pending, error } = useAction(createOutlineAction);
  const anyKind = kind === "SUBPLOT" || kind === "CUSTOM";
  const forKind = templates.filter((t) => t.kind === kind || anyKind);
  const forSeries = target.startsWith("series:");
  // Prefer a series template for a series, a book template for a book.
  const preferred =
    forKind.find((t) => t.forSeries === forSeries && !t.builtIn) ?? forKind.find((t) => t.builtIn);
  const firstTemplate = anyKind ? "" : (preferred?.id ?? "");

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent title="New structure" description={STRUCTURE_KIND_LABELS[kind].hint}>
        <form
          className="space-y-4"
          action={async (formData) => {
            const [scope, id] = target.split(":");
            const result = await run({
              bookId: scope === "book" ? id : null,
              seriesId: scope === "series" ? id : null,
              kind,
              templateId: String(formData.get("templateId") ?? "") || null,
              title: String(formData.get("title") ?? ""),
              relationshipId: String(formData.get("relationshipId") ?? "") || null,
              characterId: String(formData.get("characterId") ?? "") || null,
              arcRole: (String(formData.get("arcRole") ?? "") || null) as ArcRole | null,
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
          <Field
            label="For"
            htmlFor="structure-target"
            hint={
              forSeries
                ? "Spans every book of the series: plan beats per book, place them in any book’s scenes."
                : undefined
            }
          >
            <Select
              id="structure-target"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              required
            >
              {books.length > 0 && (
                <optgroup label="A book">
                  {books.map((b) => (
                    <option key={b.id} value={`book:${b.id}`}>
                      {b.label}
                    </option>
                  ))}
                </optgroup>
              )}
              {series.length > 0 && (
                <optgroup label="A whole series">
                  {series.map((s) => (
                    <option key={s.id} value={`series:${s.id}`}>
                      {s.label} (whole series)
                    </option>
                  ))}
                </optgroup>
              )}
            </Select>
          </Field>
          {kind === "ROMANCE" && (
            <div className="grid gap-4 sm:grid-cols-[1fr_11rem]">
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
              <Field label="Couple" htmlFor="structure-arc-role">
                <Select id="structure-arc-role" name="arcRole" defaultValue="MAIN">
                  {Object.values(ArcRole).map((r) => (
                    <option key={r} value={r}>
                      {ARC_ROLE_LABELS[r]}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
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
              key={`${kind}-${forSeries}`}
              defaultValue={firstTemplate}
            >
              <option value="">No template (add your own beats)</option>
              {forKind.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.beatCount} beats
                  {t.builtIn ? (t.source ? `, ${t.source}` : "") : ", yours"}
                  {t.forSeries ? ", for a series" : ""})
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
            <Button type="submit" disabled={pending || (books.length === 0 && series.length === 0)}>
              {pending ? "Creating…" : "Create structure"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
