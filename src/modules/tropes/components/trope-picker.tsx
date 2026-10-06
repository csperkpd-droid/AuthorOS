"use client";

import { Plus, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { FormError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useAction } from "@/hooks/use-action";

import { addTropeAction, removeTropeAction } from "../actions";
import { TROPE_SUGGESTIONS } from "../suggestions";

type Trope = { id: string; name: string; href: string };

const key = (name: string) => name.trim().toLowerCase();

/**
 * The tropes of a book or series, as chips: add an existing trope, a new
 * one, or a common suggestion (which creates the author's own trope the
 * first time); remove one. A name the workspace already has is reused,
 * ignoring case, never doubled.
 */
export function TropePicker({
  targetId,
  targetTitle,
  tropes,
  allTropes,
  canEdit,
}: {
  targetId: string;
  targetTitle: string;
  /** The tropes this object uses. */
  tropes: Trope[];
  /** Every trope of the workspace, for the picker. */
  allTropes: { id: string; name: string }[];
  canEdit: boolean;
}) {
  const remove = useAction(removeTropeAction);
  return (
    <section aria-label="Tropes" className="space-y-2">
      <ul aria-label={`Tropes of ${targetTitle}`} className="flex flex-wrap items-center gap-2">
        {tropes.map((t) => (
          <li
            key={t.id}
            className="flex items-center gap-1 rounded-full border border-border bg-surface py-0.5 pr-1 pl-3 text-sm"
          >
            <Link href={t.href} className="hover:underline">
              {t.name}
            </Link>
            {canEdit && (
              <button
                type="button"
                aria-label={`Remove trope ${t.name}`}
                onClick={() => remove.run(targetId, t.id)}
                className="rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="size-3" aria-hidden />
              </button>
            )}
          </li>
        ))}
        {tropes.length === 0 && <li className="text-sm text-muted-foreground">No tropes yet.</li>}
        {canEdit && (
          <li>
            <AddTrope
              targetId={targetId}
              targetTitle={targetTitle}
              used={tropes.map((t) => t.id)}
              allTropes={allTropes}
            />
          </li>
        )}
      </ul>
      <FormError message={remove.error} />
    </section>
  );
}

function AddTrope({
  targetId,
  targetTitle,
  used,
  allTropes,
}: {
  targetId: string;
  targetTitle: string;
  used: string[];
  allTropes: { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const add = useAction(addTropeAction);
  const q = key(query);
  const usedNames = new Set(allTropes.filter((t) => used.includes(t.id)).map((t) => key(t.name)));
  const existing = allTropes.filter((t) => !used.includes(t.id) && key(t.name).includes(q));
  const known = new Set(allTropes.map((t) => key(t.name)));
  const suggestions = TROPE_SUGGESTIONS.filter(
    (s) => !known.has(key(s)) && !usedNames.has(key(s)) && key(s).includes(q),
  );
  const exact = q !== "" && (known.has(q) || TROPE_SUGGESTIONS.some((s) => key(s) === q));

  async function choose(input: { tropeId: string } | { name: string }) {
    const result = await add.run(targetId, input);
    if (result.ok) {
      setOpen(false);
      setQuery("");
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        add.setError(null);
        if (o) setQuery("");
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="rounded-full">
          <Plus />
          Add trope
        </Button>
      </DialogTrigger>
      <DialogContent
        title={`Add a trope to “${targetTitle}”`}
        description="Pick one of your tropes, a common one, or type a new one."
      >
        <div className="space-y-3">
          <Input
            aria-label="Trope"
            placeholder="Search or type a new trope"
            value={query}
            maxLength={200}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
          <ul
            aria-label="Tropes to add"
            className="max-h-72 overflow-y-auto rounded-md border border-border"
          >
            {existing.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  className="w-full px-3 py-2 text-left text-sm hover:bg-muted"
                  onClick={() => choose({ tropeId: t.id })}
                >
                  {t.name}
                </button>
              </li>
            ))}
            {suggestions.map((s) => (
              <li key={s}>
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted"
                  onClick={() => choose({ name: s })}
                >
                  {s}
                  <span className="text-xs text-muted-foreground">Common</span>
                </button>
              </li>
            ))}
            {q && !exact && (
              <li>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-primary hover:bg-muted"
                  onClick={() => choose({ name: query.trim() })}
                >
                  <Plus className="size-4" aria-hidden />
                  Create “{query.trim()}”
                </button>
              </li>
            )}
            {existing.length === 0 && suggestions.length === 0 && !q && (
              <li className="px-3 py-2 text-sm text-muted-foreground">
                Type a name to create a trope.
              </li>
            )}
          </ul>
          <FormError message={add.error} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
