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
import { SortableList } from "@/components/ui/sortable-list";
import { Textarea } from "@/components/ui/textarea";
import { useAction } from "@/hooks/use-action";
import { cn } from "@/lib/utils";

import {
  addBeatAction,
  assignSceneAction,
  deleteBeatAction,
  moveBeatAction,
  unassignSceneAction,
  updateBeatAction,
} from "../actions";

type PlacedScene = { id: string; title: string; chapterTitle: string; percent: number | null };
type Beat = {
  id: string;
  title: string;
  description: string | null;
  targetPercent: number | null;
  scenes: PlacedScene[];
};
type BookScene = { id: string; title: string; chapterTitle: string };

/**
 * The beats of one structure, in order, each placed in the book's real
 * scenes. Drag to reorder beats; a beat may sit in several scenes, and a
 * scene may carry beats of other structures too.
 */
export function BeatBoard({
  outlineId,
  bookId,
  beats,
  bookScenes,
}: {
  outlineId: string;
  bookId: string;
  beats: Beat[];
  bookScenes: BookScene[];
}) {
  const move = useAction(moveBeatAction);
  const [editing, setEditing] = useState<Beat | "new" | null>(null);

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
      <FormError message={move.error} />
      {beats.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-6 py-10 text-center text-sm text-muted-foreground">
          No beats yet. Add the beats of your structure, then place each in the scenes where it
          happens.
        </p>
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
              bookId={bookId}
              bookScenes={bookScenes}
              onEdit={() => setEditing(beat)}
            />
          )}
        />
      )}
      <BeatDialog outlineId={outlineId} beat={editing} onClose={() => setEditing(null)} />
    </section>
  );
}

function BeatCard({
  beat,
  handle,
  bookId,
  bookScenes,
  onEdit,
}: {
  beat: Beat;
  handle: React.ReactNode;
  bookId: string;
  bookScenes: BookScene[];
  onEdit: () => void;
}) {
  const assign = useAction(assignSceneAction);
  const unassign = useAction(unassignSceneAction);
  const remove = useAction(deleteBeatAction);
  const available = bookScenes.filter((s) => !beat.scenes.some((p) => p.id === s.id));
  const placed = beat.scenes.length > 0;

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
                className="flex items-center gap-1 rounded-full border border-border py-0.5 pr-1 pl-3 text-sm"
              >
                <Link href={`/books/${bookId}/scenes/${s.id}`} className="hover:underline">
                  <span className="text-muted-foreground">{s.chapterTitle} · </span>
                  {s.title}
                </Link>
                {s.percent !== null && (
                  <span className="text-xs text-muted-foreground">at {s.percent}%</span>
                )}
                <button
                  type="button"
                  aria-label={`Remove ${s.title} from ${beat.title}`}
                  onClick={() => unassign.run(beat.id, s.id)}
                  className="rounded-full p-1 text-muted-foreground hover:bg-muted"
                >
                  <X className="size-3" aria-hidden />
                </button>
              </li>
            ))}
            {available.length > 0 && (
              <li>
                <select
                  aria-label={`Place ${beat.title} in a scene`}
                  value=""
                  onChange={(e) => e.target.value && assign.run(beat.id, e.target.value)}
                  className="h-7 rounded-full border border-dashed border-border bg-transparent px-2 text-xs text-muted-foreground"
                >
                  <option value="">+ Place in scene…</option>
                  {available.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.chapterTitle} › {s.title}
                    </option>
                  ))}
                </select>
              </li>
            )}
          </ul>
          <FormError message={assign.error ?? unassign.error ?? remove.error} />
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
            <DropdownMenuItem destructive onSelect={() => remove.run(beat.id)}>
              <Trash2 />
              Remove beat
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </article>
  );
}

function BeatDialog({
  outlineId,
  beat,
  onClose,
}: {
  outlineId: string;
  beat: Beat | "new" | null;
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
              };
              const result = existing
                ? await update.run(existing.id, input)
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
            <Field label="Target position (% of the book)" htmlFor="beat-target">
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
