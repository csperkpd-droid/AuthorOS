"use client";

import { Plus, UserPlus, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { FormError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useAction } from "@/hooks/use-action";
import { SCENE_ROLES } from "@/modules/connections/ui";
import {
  disconnectAction,
  searchNodesAction,
  updateConnectionAction,
} from "@/modules/connections/ui";
import { cn } from "@/lib/utils";

import { addCharacterToSceneAction } from "../actions";

type CastMember = { connectionId: string; characterId: string; name: string; role: string };

const ROLE_ORDER: Record<string, number> = { POV: 0, PRESENT: 1, MENTIONED: 2 };

/** Who is in a scene, with their role. Lives at the top of the scene editor. */
export function SceneCast({ sceneId, cast }: { sceneId: string; cast: CastMember[] }) {
  const update = useAction(updateConnectionAction);
  const remove = useAction(disconnectAction);
  const sorted = [...cast].sort((a, b) => (ROLE_ORDER[a.role] ?? 9) - (ROLE_ORDER[b.role] ?? 9));

  return (
    <section aria-label="Characters in this scene" className="flex flex-wrap items-center gap-2">
      {sorted.map((m) => (
        <div
          key={m.connectionId}
          className={cn(
            "flex items-center gap-1 rounded-full border border-border bg-surface py-0.5 pr-1 pl-3 text-sm",
            m.role === "POV" && "border-primary/50 bg-primary/10",
          )}
        >
          <Link href={`/characters/${m.characterId}`} className="font-medium hover:underline">
            {m.name}
          </Link>
          <select
            aria-label={`Role of ${m.name}`}
            value={m.role}
            onChange={(e) => update.run(m.connectionId, { attribute: e.target.value })}
            className="rounded-full bg-transparent px-1 text-xs text-muted-foreground"
          >
            {SCENE_ROLES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.value === "POV" ? "POV" : r.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            aria-label={`Remove ${m.name} from this scene`}
            onClick={() => remove.run(m.connectionId)}
            className="rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="size-3" aria-hidden />
          </button>
        </div>
      ))}
      <AddToScene
        sceneId={sceneId}
        hasPov={cast.some((m) => m.role === "POV")}
        existing={cast.map((m) => m.characterId)}
      />
      <FormError message={update.error ?? remove.error} />
    </section>
  );
}

function AddToScene({
  sceneId,
  hasPov,
  existing,
}: {
  sceneId: string;
  hasPov: boolean;
  existing: string[];
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ id: string; title: string }[]>([]);
  const [role, setRole] = useState(hasPov ? "PRESENT" : "POV");
  const add = useAction(addCharacterToSceneAction);

  useEffect(() => {
    if (!open) return;
    const handle = setTimeout(async () => {
      const result = await searchNodesAction(query, ["CHARACTER"]);
      if (result.ok) setResults(result.data.filter((r) => !existing.includes(r.id)));
    }, 150);
    return () => clearTimeout(handle);
  }, [open, query, existing]);

  const exact = results.some((r) => r.title.toLowerCase() === query.trim().toLowerCase());

  async function choose(input: { characterId?: string; newName?: string }) {
    const result = await add.run(sceneId, { ...input, role });
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
        if (o) setRole(hasPov ? "PRESENT" : "POV");
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
            aria-label="Role in this scene"
            value={role}
            onChange={(e) => setRole(e.target.value)}
          >
            {SCENE_ROLES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </Select>
          <ul
            aria-label="Characters"
            className="max-h-56 overflow-y-auto rounded-md border border-border"
          >
            {results.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  className="w-full px-3 py-2 text-left text-sm hover:bg-muted"
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
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-primary hover:bg-muted"
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
