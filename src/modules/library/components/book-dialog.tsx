"use client";

import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Field, FormError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { BookStatus, HeatLevel } from "@/generated/prisma/enums";
import { useAction } from "@/hooks/use-action";

import { createBookAction, updateBookAction } from "../actions";
import { BOOK_STATUS_LABELS, HEAT_LEVEL_LABELS, TROPE_SUGGESTIONS } from "../labels";

type Option = { id: string; name: string };
type SeriesOption = { id: string; title: string; penName: { id: string; name: string } };

export type EditableBook = {
  id: string;
  title: string;
  subtitle: string | null;
  description: string | null;
  status: BookStatus;
  targetWordCount: number | null;
  tropes: string[];
  heatLevel: HeatLevel | null;
  seriesId: string | null;
  penName: { id: string; name: string };
};

/**
 * Create a book (no `book`) or edit one. Books in a series take the series'
 * pen name, so the pen-name picker only applies to standalone books.
 */
export function BookDialog({
  book,
  penNames,
  seriesOptions,
  defaultPenNameId,
  defaultSeriesId,
  trigger,
}: {
  book?: EditableBook;
  penNames: Option[];
  seriesOptions: SeriesOption[];
  defaultPenNameId?: string;
  defaultSeriesId?: string;
  trigger: ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [seriesId, setSeriesId] = useState(book?.seriesId ?? defaultSeriesId ?? "");
  const create = useAction(createBookAction);
  const update = useAction(updateBookAction);
  const pending = create.pending || update.pending;
  const error = create.error ?? update.error;
  const series = seriesOptions.find((s) => s.id === seriesId);
  // An archived pen name still shows for the book that uses it.
  const penOptions =
    book && !penNames.some((p) => p.id === book.penName.id)
      ? [...penNames, book.penName]
      : penNames;
  const id = book?.id ?? "new";

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) {
          create.setError(null);
          update.setError(null);
        }
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent title={book ? "Book details" : "New book"}>
        <form
          className="space-y-4"
          action={async (formData) => {
            if (book) {
              if ((await update.run(book.id, formData)).ok) setOpen(false);
              return;
            }
            const result = await create.run(formData);
            if (result.ok) router.push(`/books/${result.data.id}`);
          }}
        >
          <Field label="Title" htmlFor={`${id}-title`}>
            <Input id={`${id}-title`} name="title" defaultValue={book?.title} required autoFocus />
          </Field>
          <Field label="Subtitle" htmlFor={`${id}-subtitle`}>
            <Input id={`${id}-subtitle`} name="subtitle" defaultValue={book?.subtitle ?? ""} />
          </Field>

          <Field label="Series" htmlFor={`${id}-series`}>
            <Select
              id={`${id}-series`}
              name="seriesId"
              value={seriesId}
              onChange={(e) => setSeriesId(e.target.value)}
            >
              <option value="">Standalone (no series)</option>
              {seriesOptions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                </option>
              ))}
            </Select>
          </Field>

          {series ? (
            <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
              Published as <strong className="text-foreground">{series.penName.name}</strong>, the
              series’ pen name.
            </p>
          ) : (
            <Field label="Pen name" htmlFor={`${id}-pen`}>
              <Select
                id={`${id}-pen`}
                name="penNameId"
                defaultValue={book?.penName.id ?? defaultPenNameId}
              >
                {penOptions.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}

          {book && (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Status" htmlFor={`${id}-status`}>
                  <Select id={`${id}-status`} name="status" defaultValue={book.status}>
                    {Object.values(BookStatus).map((s) => (
                      <option key={s} value={s}>
                        {BOOK_STATUS_LABELS[s]}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Target word count" htmlFor={`${id}-target`}>
                  <Input
                    id={`${id}-target`}
                    name="targetWordCount"
                    type="number"
                    min={0}
                    step={1000}
                    inputMode="numeric"
                    defaultValue={book.targetWordCount ?? ""}
                  />
                </Field>
              </div>
              <Field label="Description" htmlFor={`${id}-description`}>
                <Textarea
                  id={`${id}-description`}
                  name="description"
                  defaultValue={book.description ?? ""}
                  rows={4}
                />
              </Field>
              <div className="grid gap-4 sm:grid-cols-[1fr_12rem]">
                <Field
                  label="Tropes"
                  htmlFor={`${id}-tropes`}
                  hint="Separated by commas, e.g. enemies to lovers, slow burn."
                >
                  <TropesInput id={`${id}-tropes`} initial={book.tropes} />
                </Field>
                <Field label="Heat level" htmlFor={`${id}-heat`}>
                  <Select id={`${id}-heat`} name="heatLevel" defaultValue={book.heatLevel ?? ""}>
                    <option value="">Not set</option>
                    {Object.values(HeatLevel).map((h) => (
                      <option key={h} value={h}>
                        {HEAT_LEVEL_LABELS[h]}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
            </>
          )}

          <FormError message={error} />
          <div className="flex justify-end">
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : book ? "Save" : "Create book"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Comma-separated tropes, with common ones a tap away. */
function TropesInput({ id, initial }: { id: string; initial: string[] }) {
  const [value, setValue] = useState(initial.join(", "));
  const current = value
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
  const suggestions = TROPE_SUGGESTIONS.filter((t) => !current.includes(t.toLowerCase()));
  return (
    <>
      <Input id={id} name="tropes" value={value} onChange={(e) => setValue(e.target.value)} />
      {suggestions.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {suggestions.slice(0, 6).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setValue((v) => (v.trim() ? `${v.replace(/,\s*$/, "")}, ${t}` : t))}
              className="rounded-full border border-dashed border-border px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted"
            >
              + {t}
            </button>
          ))}
        </div>
      )}
    </>
  );
}
