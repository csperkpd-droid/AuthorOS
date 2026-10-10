"use client";

import { History, MapPin, Plus, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { FormError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useAction } from "@/hooks/use-action";
import { formatDateTime } from "@/lib/format";
import { searchNodesAction } from "@/modules/connections/ui";

import { listSettingHistoryAction, removeScenePlaceAction, setScenePlaceAction } from "../actions";

export type ScenePlace = { id: string; name: string; href: string };

/**
 * Where a scene is set (Scene Setting): the places the author chose. Taking
 * a place out changes nothing else; nothing here touches the scene's text.
 */
export function SceneSetting({
  sceneId,
  places,
  canEdit = true,
}: {
  sceneId: string;
  places: ScenePlace[];
  canEdit?: boolean;
}) {
  const remove = useAction(removeScenePlaceAction);

  return (
    <section aria-label="Setting" className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <MapPin className="size-4" aria-hidden />
          Set in:
        </span>
        <ul aria-label="Where this scene is set" className="contents">
          {places.map((p) => (
            <li
              key={p.id}
              className="flex items-center gap-1 rounded-full border border-border bg-surface py-0.5 pr-1 pl-3 text-sm"
            >
              <Link href={p.href} className="font-medium hover:underline">
                {p.name}
              </Link>
              {canEdit && (
                <button
                  type="button"
                  aria-label={`Take ${p.name} out of this scene’s setting`}
                  className="rounded-full p-1 text-muted-foreground hover:bg-surface-hover hover:text-foreground"
                  onClick={() => remove.run(sceneId, p.id)}
                >
                  <X className="size-3.5" aria-hidden />
                </button>
              )}
            </li>
          ))}
        </ul>
        {places.length === 0 && <span className="text-sm text-muted-foreground">No place yet</span>}
        {canEdit && <SetInPlace sceneId={sceneId} places={places} />}
        <SettingHistory sceneId={sceneId} />
      </div>
      <FormError message={remove.error} />
    </section>
  );
}

function SetInPlace({ sceneId, places }: { sceneId: string; places: ScenePlace[] }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ id: string; title: string }[]>([]);
  const set = useAction(setScenePlaceAction);
  const existing = places.map((p) => p.id);

  useEffect(() => {
    if (!open) return;
    const handle = setTimeout(async () => {
      const result = await searchNodesAction(query, ["PLACE"], sceneId);
      if (result.ok) setResults(result.data.filter((r) => !existing.includes(r.id)));
    }, 150);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, query, existing.join(), sceneId]);

  const exact = results.some((r) => r.title.toLowerCase() === query.trim().toLowerCase());

  async function choose(input: { placeId?: string; newName?: string }) {
    const result = await set.run(sceneId, input);
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
        set.setError(null);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="rounded-full">
          <Plus />
          Set in a place
        </Button>
      </DialogTrigger>
      <DialogContent
        title="Where is this scene set?"
        description="Choose a place, or type a new one. The scene’s text isn’t changed."
      >
        <div className="space-y-3">
          <Input
            aria-label="Place name"
            placeholder="Search or type a new place"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
          <ul
            aria-label="Places"
            className="max-h-56 overflow-y-auto rounded-md border border-border"
          >
            {results.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  className="w-full px-3 py-2 text-left text-sm hover:bg-surface-hover"
                  onClick={() => choose({ placeId: r.id })}
                >
                  {r.title}
                </button>
              </li>
            ))}
            {query.trim() && !exact && (
              <li>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-primary hover:bg-surface-hover"
                  onClick={() => choose({ newName: query.trim() })}
                >
                  <Plus className="size-4" aria-hidden />
                  Create “{query.trim()}”
                </button>
              </li>
            )}
            {results.length === 0 && !query.trim() && (
              <li className="px-3 py-2 text-sm text-muted-foreground">
                Type a name to find or create a place.
              </li>
            )}
          </ul>
          <FormError message={set.error} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

type Change =
  Awaited<ReturnType<typeof listSettingHistoryAction>> extends infer R
    ? R extends { ok: true; data: (infer E)[] }
      ? E
      : never
    : never;

/** The scene's Story History of places set and taken out. */
function SettingHistory({ sceneId }: { sceneId: string }) {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<Change[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <Dialog
      open={open}
      onOpenChange={async (o) => {
        setOpen(o);
        if (!o) return;
        setEntries(null);
        const result = await listSettingHistoryAction(sceneId);
        if (result.ok) setEntries(result.data);
        else setError(result.error);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="rounded-full" aria-label="Setting changes">
          <History />
          Changes
        </Button>
      </DialogTrigger>
      <DialogContent
        title="Where this scene was set"
        description="Every change to this scene’s setting is kept here."
      >
        <FormError message={error} />
        {entries === null ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">No changes yet.</p>
        ) : (
          <ul
            aria-label="Changes to this scene’s setting"
            className="max-h-[60vh] divide-y divide-border overflow-y-auto rounded-md border border-border"
          >
            {entries.map((c) => (
              <li key={c.id} className="space-y-0.5 p-3 text-sm">
                <p>
                  <span className="font-medium">
                    {c.place ? c.place.name : "A place that isn’t shown"}
                  </span>{" "}
                  · {c.change === "SET" ? "Set here" : "Taken out"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatDateTime(new Date(c.createdAt))}
                </p>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
