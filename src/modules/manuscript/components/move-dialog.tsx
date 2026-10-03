"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, FormError } from "@/components/ui/field";
import { Select } from "@/components/ui/select";

import type { BookLevelItem, ChapterItem } from "../structure";

export type MoveTarget =
  | { kind: "scene"; id: string; title: string; chapterId: string }
  | { kind: "chapter"; id: string; title: string; partId: string | null };

const TOP_LEVEL = "__top";

/**
 * Moves a scene to another chapter, or a chapter into a part or the book's
 * top level. The item goes to the end of its new container.
 */
export function MoveDialog({
  target,
  items,
  onClose,
  onMoveScene,
  onMoveChapter,
}: {
  target: MoveTarget | null;
  items: BookLevelItem[];
  onClose: () => void;
  onMoveScene: (
    id: string,
    chapterId: string,
    afterId: string | null,
  ) => Promise<{ ok: boolean; error?: string }>;
  onMoveChapter: (
    id: string,
    partId: string | null,
    afterId: string | null,
  ) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [destination, setDestination] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chapters: (ChapterItem & { partTitle?: string })[] = items.flatMap((i) =>
    i.kind === "part" ? i.chapters.map((c) => ({ ...c, partTitle: i.title })) : [i],
  );
  const parts = items.filter((i) => i.kind === "part");

  async function submit() {
    if (!target || !destination) return;
    setPending(true);
    setError(null);
    let result: { ok: boolean; error?: string };
    if (target.kind === "scene") {
      const chapter = chapters.find((c) => c.id === destination)!;
      const last = chapter.scenes.filter((s) => s.id !== target.id).at(-1);
      result = await onMoveScene(target.id, destination, last?.id ?? null);
    } else {
      const partId = destination === TOP_LEVEL ? null : destination;
      const siblings =
        partId === null ? items : (parts.find((p) => p.id === partId)?.chapters ?? []);
      const last = siblings.filter((s) => s.id !== target.id).at(-1);
      result = await onMoveChapter(target.id, partId, last?.id ?? null);
    }
    setPending(false);
    if (result.ok) onClose();
    else setError(result.error ?? "Could not move it.");
  }

  return (
    <Dialog
      open={target !== null}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
          setDestination("");
          setError(null);
        }
      }}
    >
      {target && (
        <DialogContent title={`Move “${target.title}”`} description="It will be placed at the end.">
          <div className="space-y-4">
            <Field
              label={target.kind === "scene" ? "Chapter" : "Destination"}
              htmlFor="move-destination"
            >
              <Select
                id="move-destination"
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
              >
                <option value="" disabled>
                  Choose…
                </option>
                {target.kind === "scene"
                  ? chapters.map((c) => (
                      <option key={c.id} value={c.id} disabled={c.id === target.chapterId}>
                        {c.partTitle ? `${c.partTitle} › ${c.title}` : c.title}
                      </option>
                    ))
                  : [
                      <option key={TOP_LEVEL} value={TOP_LEVEL} disabled={target.partId === null}>
                        Book (no part)
                      </option>,
                      ...parts.map((p) => (
                        <option key={p.id} value={p.id} disabled={p.id === target.partId}>
                          {p.title}
                        </option>
                      )),
                    ]}
              </Select>
            </Field>
            <FormError message={error} />
            <div className="flex justify-end">
              <Button onClick={submit} disabled={!destination || pending}>
                {pending ? "Moving…" : "Move"}
              </Button>
            </div>
          </div>
        </DialogContent>
      )}
    </Dialog>
  );
}
