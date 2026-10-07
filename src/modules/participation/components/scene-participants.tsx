"use client";

import { Check, Eye, History, MoreHorizontal, Plus, UserPlus } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FormError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useAction } from "@/hooks/use-action";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { searchNodesAction } from "@/modules/connections/ui";

import {
  addToSceneAction,
  listParticipationHistoryAction,
  removeParticipantAction,
  setPointOfViewAction,
  updateParticipantAction,
} from "../actions";
import { describeParticipation, PRESENCE_HINTS, PRESENCE_LABELS } from "../labels";
import { SCENE_PRESENCES, type ScenePresence } from "../schemas";

export type SceneParticipant = {
  characterId: string;
  name: string;
  href: string;
  presence: ScenePresence;
  pov: boolean;
};

/**
 * Who is in a scene (Scene Participation): the point of view first, then
 * present, then mentioned characters. The point of view is shown on its own
 * line so it's clear at a glance; changing it to someone else is an
 * explicit, confirmed step. Nothing here touches the scene's text.
 */
export function SceneParticipants({
  sceneId,
  participants,
  canEdit = true,
}: {
  sceneId: string;
  participants: SceneParticipant[];
  canEdit?: boolean;
}) {
  const update = useAction(updateParticipantAction);
  const remove = useAction(removeParticipantAction);
  const setPov = useAction(setPointOfViewAction);
  const [handOver, setHandOver] = useState<SceneParticipant | null>(null);
  const pov = participants.find((p) => p.pov) ?? null;

  function makePov(p: SceneParticipant) {
    if (pov) setHandOver(p);
    else void setPov.run(sceneId, { characterId: p.characterId, expected: null });
  }

  return (
    <section aria-label="Characters in this scene" className="space-y-2">
      <p className="flex items-center gap-1.5 text-sm" data-testid="scene-pov">
        <Eye className="size-4 text-muted-foreground" aria-hidden />
        {pov ? (
          <>
            <span className="text-muted-foreground">Point of view:</span>
            <span className="font-medium">{pov.name}</span>
          </>
        ) : (
          <span className="text-muted-foreground">No point of view chosen</span>
        )}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <ul aria-label="Who is in this scene" className="contents">
          {participants.map((p) => (
            <li
              key={p.characterId}
              aria-label={`${p.name}: ${describeParticipation(p)}`}
              className={cn(
                "flex items-center gap-1 rounded-full border bg-surface py-0.5 pr-1 pl-3 text-sm",
                p.pov && "border-primary/50 bg-secondary",
                p.presence === "MENTIONED"
                  ? "border-dashed border-border text-muted-foreground"
                  : "border-border",
              )}
            >
              <Link href={p.href} className="font-medium hover:underline">
                {p.name}
              </Link>
              {p.pov && (
                <Badge className="bg-primary/15 px-1.5 text-primary" title="Point of view">
                  POV
                </Badge>
              )}
              <span className="text-xs text-muted-foreground">{PRESENCE_LABELS[p.presence]}</span>
              {canEdit && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      aria-label={`Change ${p.name}’s part in this scene`}
                      className="rounded-full p-1 text-muted-foreground hover:bg-surface-hover hover:text-foreground"
                    >
                      <MoreHorizontal className="size-3.5" aria-hidden />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    {SCENE_PRESENCES.map((presence) => (
                      <DropdownMenuItem
                        key={presence}
                        onSelect={() =>
                          presence !== p.presence &&
                          update.run(sceneId, p.characterId, { presence })
                        }
                      >
                        <Check className={cn(presence !== p.presence && "invisible")} aria-hidden />
                        {PRESENCE_LABELS[presence]}
                        <span className="sr-only">: {PRESENCE_HINTS[presence]}</span>
                      </DropdownMenuItem>
                    ))}
                    <DropdownMenuSeparator />
                    {p.pov ? (
                      <DropdownMenuItem
                        onSelect={() => update.run(sceneId, p.characterId, { pov: false })}
                      >
                        Remove point of view
                      </DropdownMenuItem>
                    ) : (
                      <DropdownMenuItem onSelect={() => makePov(p)}>
                        Make point of view
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      destructive
                      onSelect={() => remove.run(sceneId, p.characterId)}
                    >
                      Remove from this scene
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </li>
          ))}
        </ul>
        {canEdit && <AddToScene sceneId={sceneId} pov={pov} participants={participants} />}
        <ParticipationHistory sceneId={sceneId} />
      </div>
      {participants.length === 0 && (
        <p className="text-sm text-muted-foreground">No characters in this scene yet.</p>
      )}
      <FormError message={update.error ?? remove.error ?? setPov.error} />
      <ChangePov sceneId={sceneId} from={pov} to={handOver} onClose={() => setHandOver(null)} />
    </section>
  );
}

/** The explicit step for giving the point of view to someone else. */
function ChangePov({
  sceneId,
  from,
  to,
  onClose,
}: {
  sceneId: string;
  from: SceneParticipant | null;
  to: SceneParticipant | null;
  onClose: () => void;
}) {
  const change = useAction(setPointOfViewAction);
  return (
    <Dialog
      open={!!to}
      onOpenChange={(o) => {
        if (!o) {
          change.setError(null);
          onClose();
        }
      }}
    >
      {to && (
        <DialogContent
          title={`Change the point of view to ${to.name}?`}
          description={
            from
              ? `This scene is told from ${from.name}’s point of view now. ${from.name} stays in the scene as ${PRESENCE_LABELS[from.presence].toLowerCase()}. The scene’s text isn’t changed.`
              : "The scene’s text isn’t changed."
          }
        >
          <FormError message={change.error} />
          <div className="mt-2 flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              disabled={change.pending}
              onClick={async () => {
                const result = await change.run(sceneId, {
                  characterId: to.characterId,
                  expected: from?.characterId ?? null,
                });
                if (result.ok) onClose();
              }}
            >
              Change point of view
            </Button>
          </div>
        </DialogContent>
      )}
    </Dialog>
  );
}

function AddToScene({
  sceneId,
  pov,
  participants,
}: {
  sceneId: string;
  pov: SceneParticipant | null;
  participants: SceneParticipant[];
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ id: string; title: string }[]>([]);
  const [presence, setPresence] = useState<ScenePresence>("PRESENT");
  const [asPov, setAsPov] = useState(false);
  const add = useAction(addToSceneAction);
  const existing = participants.map((p) => p.characterId);

  useEffect(() => {
    if (!open) return;
    const handle = setTimeout(async () => {
      const result = await searchNodesAction(query, ["CHARACTER"], sceneId);
      if (result.ok) setResults(result.data.filter((r) => !existing.includes(r.id)));
    }, 150);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, query, existing.join(), sceneId]);

  const exact = results.some((r) => r.title.toLowerCase() === query.trim().toLowerCase());

  async function choose(input: { characterId?: string; newName?: string }) {
    const result = await add.run(sceneId, { ...input, presence, pov: asPov });
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
        if (o) {
          setPresence("PRESENT");
          setAsPov(!pov);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="rounded-full">
          <UserPlus />
          Add character
        </Button>
      </DialogTrigger>
      <DialogContent title="Add a character to this scene">
        <div className="space-y-3">
          <Input
            aria-label="Character name"
            placeholder="Search or type a new name"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
          <Select
            aria-label="In this scene"
            value={presence}
            onChange={(e) => setPresence(e.target.value as ScenePresence)}
          >
            {SCENE_PRESENCES.map((p) => (
              <option key={p} value={p}>
                {PRESENCE_LABELS[p]}: {PRESENCE_HINTS[p].toLowerCase()}
              </option>
            ))}
          </Select>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={asPov}
              disabled={!!pov}
              onChange={(e) => setAsPov(e.target.checked)}
            />
            <span>
              Point of view
              {pov && (
                <span className="block text-xs text-muted-foreground">
                  This scene is told from {pov.name}’s point of view. To change it, use “Make point
                  of view” on a character.
                </span>
              )}
            </span>
          </label>
          <ul
            aria-label="Characters"
            className="max-h-56 overflow-y-auto rounded-md border border-border"
          >
            {results.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  className="w-full px-3 py-2 text-left text-sm hover:bg-surface-hover"
                  onClick={() => choose({ characterId: r.id })}
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
                Type a name to find or create a character.
              </li>
            )}
          </ul>
          <FormError message={add.error} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

type Change =
  Awaited<ReturnType<typeof listParticipationHistoryAction>> extends infer R
    ? R extends { ok: true; data: (infer E)[] }
      ? E
      : never
    : never;

function describeChange(c: Change) {
  if (!c.from) return `Added: ${describeParticipation(c.to)}`;
  if (!c.to) return `Removed (was ${describeParticipation(c.from).toLowerCase()})`;
  if (!c.from.pov && c.to.pov) return "Became the point of view";
  if (c.from.pov && !c.to.pov) return "No longer the point of view";
  return `${describeParticipation(c.from)} → ${describeParticipation(c.to)}`;
}

/** The scene's Story History of who was added, removed or changed. */
function ParticipationHistory({ sceneId }: { sceneId: string }) {
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
        const result = await listParticipationHistoryAction(sceneId);
        if (result.ok) setEntries(result.data);
        else setError(result.error);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="rounded-full">
          <History />
          Changes
        </Button>
      </DialogTrigger>
      <DialogContent
        title="Who was in this scene"
        description="Every change to the characters in this scene is kept here."
      >
        <FormError message={error} />
        {entries === null ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">No changes yet.</p>
        ) : (
          <ul
            aria-label="Changes to the characters in this scene"
            className="max-h-[60vh] divide-y divide-border overflow-y-auto rounded-md border border-border"
          >
            {entries.map((c) => (
              <li key={c.id} className="space-y-0.5 p-3 text-sm">
                <p>
                  <span className="font-medium">
                    {c.character ? c.character.name : "A character who isn’t shown"}
                  </span>{" "}
                  · {describeChange(c)}
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
