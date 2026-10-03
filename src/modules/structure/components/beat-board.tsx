"use client";

import { MoreHorizontal, Pencil, Plus, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field, FormError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { SortableList } from "@/components/ui/sortable-list";
import { Textarea } from "@/components/ui/textarea";
import { useAction } from "@/hooks/use-action";
import { ImpactDialog } from "@/modules/impact/ui";
import { cn } from "@/lib/utils";

import {
  addBeatAction,
  assignSceneAction,
  deleteBeatAction,
  previewDeleteBeatAction,
  moveBeatAction,
  unassignSceneAction,
  updateBeatAction,
} from "../actions";

type SceneRef = {
  id: string;
  title: string;
  chapterTitle: string;
  bookId: string;
  bookTitle: string;
  bookNumber: number;
  percent: number;
};
type Beat = {
  id: string;
  title: string;
  description: string | null;
  targetPercent: number | null;
  bookId: string | null;
  scenes: SceneRef[];
  /** When the beat was loaded (stale-edit protection). */
  updatedAt?: Date | string;
};
type BookRef = { id: string; title: string; number: number };

/**
 * The beats of one structure, in order, each placed in real scenes: of the
 * structure's book, or of any book in a series structure. Drag to reorder; a
 * beat may sit in several scenes (and books), and a scene may carry beats of
 * other structures too. Series structures can be viewed one book at a time.
 */
export function BeatBoard({
  outlineId,
  books,
  beats,
  bookScenes,
}: {
  outlineId: string;
  books: BookRef[];
  beats: Beat[];
  bookScenes: SceneRef[];
}) {
  const move = useAction(moveBeatAction);
  const [editing, setEditing] = useState<Beat | "new" | null>(null);
  const series = books.length > 1;
  const [bookFilter, setBookFilter] = useState<string | null>(null);
  const shown = bookFilter
    ? beats.filter((b) => b.bookId === bookFilter || b.scenes.some((s) => s.bookId === bookFilter))
    : beats;

  return (
    <section aria-labelledby="beats-heading" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="beats-heading" className="font-serif text-xl">
          Beats
        </h2>
        <Button variant="outline" size="sm" onClick={() => setEditing("new")}>
          <Plus />
          Add beat
        </Button>
      </div>
      {series && (
        <div role="group" aria-label="Show beats for" className="flex flex-wrap gap-1.5">
          {[
            { id: null, label: "Whole series" },
            ...books.map((b) => ({ id: b.id, label: `Book ${b.number}: ${b.title}` })),
          ].map((option) => (
            <button
              key={option.id ?? "all"}
              type="button"
              aria-pressed={bookFilter === option.id}
              onClick={() => setBookFilter(option.id)}
              className={cn(
                "rounded-full border px-3 py-1 text-sm",
                bookFilter === option.id
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:bg-muted",
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
      <FormError message={move.error} />
      {beats.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-6 py-10 text-center text-sm text-muted-foreground">
          No beats yet. Add the beats of your structure, then place each in the scenes where it
          happens.
        </p>
      ) : shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No beats planned or placed in this book yet.
        </p>
      ) : bookFilter ? (
        // A filtered view is read in order but not reordered (gaps would mislead).
        <ul aria-label="Beats" className="space-y-2">
          {shown.map((beat) => (
            <li key={beat.id}>
              <BeatCard
                beat={beat}
                handle={null}
                books={books}
                bookScenes={bookScenes}
                onEdit={() => setEditing(beat)}
              />
            </li>
          ))}
        </ul>
      ) : (
        <SortableList
          items={beats}
          label="Beats"
          itemLabel={(b) => b.title}
          className="space-y-2"
          onMove={(id, afterId) => move.run(id, afterId)}
          renderItem={(beat, handle) => (
            <BeatCard
              beat={beat}
              handle={handle}
              books={books}
              bookScenes={bookScenes}
              onEdit={() => setEditing(beat)}
            />
          )}
        />
      )}
      <BeatDialog
        outlineId={outlineId}
        beat={editing}
        books={series ? books : []}
        defaultBookId={bookFilter}
        onClose={() => setEditing(null)}
      />
    </section>
  );
}

function sceneLabel(s: SceneRef, series: boolean) {
  return `${series ? `Book ${s.bookNumber} · ` : ""}${s.chapterTitle} › ${s.title}`;
}

function BeatCard({
  beat,
  handle,
  books,
  bookScenes,
  onEdit,
}: {
  beat: Beat;
  handle: React.ReactNode;
  books: BookRef[];
  bookScenes: SceneRef[];
  onEdit: () => void;
}) {
  const assign = useAction(assignSceneAction);
  const unassign = useAction(unassignSceneAction);
  // Removing a beat is reviewed first: its scene placements go (Change Impact).
  const [removing, setRemoving] = useState(false);
  const series = books.length > 1;
  const available = bookScenes.filter((s) => !beat.scenes.some((p) => p.id === s.id));
  const placed = beat.scenes.length > 0;
  const planned = books.find((b) => b.id === beat.bookId);

  return (
    <article
      aria-label={beat.title}
      className={cn(
        "rounded-lg border bg-surface p-3",
        placed ? "border-border" : "border-dashed border-border",
      )}
    >
      <div className="flex items-start gap-2">
        {handle}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-medium">{beat.title}</h3>
            {series && planned && <Badge>Book {planned.number}</Badge>}
            {beat.targetPercent !== null && <Badge>~{beat.targetPercent}%</Badge>}
            {!placed && <Badge className="bg-primary/10 text-primary">Not placed</Badge>}
          </div>
          {beat.description && (
            <p className="mt-0.5 text-sm text-muted-foreground">{beat.description}</p>
          )}

          <ul aria-label={`Scenes for ${beat.title}`} className="mt-2 flex flex-wrap gap-2">
            {beat.scenes.map((s) => (
              <li
                key={s.id}
                className="flex max-w-full items-center gap-1 rounded-full border border-border py-0.5 pr-1 pl-3 text-sm"
              >
                <Link
                  href={`/books/${s.bookId}/scenes/${s.id}`}
                  className="min-w-0 truncate hover:underline"
                >
                  <span className="text-muted-foreground">
                    {series && `Book ${s.bookNumber} · `}
                    {s.chapterTitle} ·{" "}
                  </span>
                  {s.title}
                </Link>
                <span className="shrink-0 text-xs text-muted-foreground">at {s.percent}%</span>
                <button
                  type="button"
                  aria-label={`Remove ${s.title} from ${beat.title}`}
                  onClick={() => unassign.run(beat.id, s.id)}
                  className="shrink-0 rounded-full p-1 text-muted-foreground hover:bg-muted"
                >
                  <X className="size-3" aria-hidden />
                </button>
              </li>
            ))}
            {available.length > 0 && (
              <li className="max-w-full">
                <select
                  aria-label={`Place ${beat.title} in a scene`}
                  value=""
                  onChange={(e) => e.target.value && assign.run(beat.id, e.target.value)}
                  className="h-7 max-w-full rounded-full border border-dashed border-border bg-transparent px-2 text-xs text-muted-foreground"
                >
                  <option value="">+ Place in scene…</option>
                  {series
                    ? books.map((b) => (
                        <optgroup key={b.id} label={`Book ${b.number}: ${b.title}`}>
                          {available
                            .filter((s) => s.bookId === b.id)
                            .map((s) => (
                              <option key={s.id} value={s.id}>
                                {sceneLabel(s, true)}
                              </option>
                            ))}
                        </optgroup>
                      ))
                    : available.map((s) => (
                        <option key={s.id} value={s.id}>
                          {sceneLabel(s, false)}
                        </option>
                      ))}
                </select>
              </li>
            )}
          </ul>
          <FormError message={assign.error ?? unassign.error} />
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="size-7 p-0"
              aria-label={`Actions for ${beat.title}`}
            >
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem onSelect={onEdit}>
              <Pencil />
              Edit beat
            </DropdownMenuItem>
            <DropdownMenuItem destructive onSelect={() => setRemoving(true)}>
              <Trash2 />
              Remove beat
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <ImpactDialog
          open={removing}
          onOpenChange={setRemoving}
          title={`Remove the beat “${beat.title}”?`}
          loadReport={() => previewDeleteBeatAction(beat.id)}
          onConfirm={(token, accepted) => deleteBeatAction(beat.id, token, accepted)}
          confirmLabel="Remove beat"
        />
      </div>
    </article>
  );
}

function BeatDialog({
  outlineId,
  beat,
  books,
  defaultBookId,
  onClose,
}: {
  outlineId: string;
  beat: Beat | "new" | null;
  /** The series' books (empty for a single-book structure). */
  books: BookRef[];
  defaultBookId: string | null;
  onClose: () => void;
}) {
  const add = useAction(addBeatAction);
  const update = useAction(updateBeatAction);
  const existing = beat && beat !== "new" ? beat : null;

  return (
    <Dialog open={beat !== null} onOpenChange={(o) => !o && onClose()}>
      {beat !== null && (
        <DialogContent title={existing ? "Edit beat" : "New beat"}>
          <form
            className="space-y-4"
            action={async (formData) => {
              const input = {
                title: String(formData.get("title") ?? ""),
                description: String(formData.get("description") ?? ""),
                targetPercent: String(formData.get("targetPercent") ?? ""),
                ...(books.length > 0 && { bookId: String(formData.get("bookId") ?? "") }),
              };
              const result = existing
                ? await update.run(
                    existing.id,
                    input,
                    existing.updatedAt ? new Date(existing.updatedAt).toISOString() : undefined,
                  )
                : await add.run(outlineId, input);
              if (result.ok) onClose();
            }}
          >
            <Field label="Beat" htmlFor="beat-title">
              <Input
                id="beat-title"
                name="title"
                defaultValue={existing?.title}
                required
                autoFocus
              />
            </Field>
            <Field label="What happens" htmlFor="beat-description">
              <Textarea
                id="beat-description"
                name="description"
                rows={3}
                defaultValue={existing?.description ?? ""}
              />
            </Field>
            <div className="flex flex-wrap gap-4">
              {books.length > 0 && (
                <Field label="Planned for" htmlFor="beat-book">
                  <Select
                    id="beat-book"
                    name="bookId"
                    defaultValue={existing ? (existing.bookId ?? "") : (defaultBookId ?? "")}
                  >
                    <option value="">Any book</option>
                    {books.map((b) => (
                      <option key={b.id} value={b.id}>
                        Book {b.number}: {b.title}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
              <Field
                label={
                  books.length > 0 ? "Target (% of the book)" : "Target position (% of the book)"
                }
                htmlFor="beat-target"
              >
                <Input
                  id="beat-target"
                  name="targetPercent"
                  type="number"
                  min={0}
                  max={100}
                  inputMode="numeric"
                  defaultValue={existing?.targetPercent ?? ""}
                  className="w-32"
                />
              </Field>
            </div>
            <FormError message={add.error ?? update.error} />
            <div className="flex justify-end">
              <Button type="submit" disabled={add.pending || update.pending}>
                {existing ? "Save" : "Add beat"}
              </Button>
            </div>
          </form>
        </DialogContent>
      )}
    </Dialog>
  );
}
