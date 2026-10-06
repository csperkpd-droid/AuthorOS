"use client";

import { Search } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Field, FormError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import type { StoryNodeKind } from "@/generated/prisma/enums";
import { NODE_KIND_LABELS, NODE_KINDS } from "@/modules/story-graph/ui";
import { cn } from "@/lib/utils";

import { connectAction, searchNodesAction } from "../actions";
import { connectionOptionsFor, getKind, type ConnectionKind } from "../registry";

type Found = { id: string; kind: StoryNodeKind; title: string; context: string | null };

/**
 * Connect this story object to any other. The available kinds come from the
 * registry, so new kinds and object types appear here automatically.
 */
export function AddConnectionDialog({
  nodeId,
  nodeKind,
  onlyKinds,
  trigger,
  title = "Add connection",
}: {
  nodeId: string;
  nodeKind: StoryNodeKind;
  /** Limit the offered connection kinds (e.g. only "about"). */
  onlyKinds?: ConnectionKind[];
  trigger: ReactNode;
  title?: string;
}) {
  const options = useMemo(
    () =>
      connectionOptionsFor(nodeKind, NODE_KINDS).filter(
        (o) => !onlyKinds || onlyKinds.includes(o.kind),
      ),
    [nodeKind, onlyKinds],
  );
  const [open, setOpen] = useState(false);
  const [optionIndex, setOptionIndex] = useState(0);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Found[]>([]);
  const [selected, setSelected] = useState<Found | null>(null);
  const [label, setLabel] = useState("");
  const [attribute, setAttribute] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const option = options[optionIndex];
  const def = option ? getKind(option.kind) : null;
  const otherKindsKey = option?.otherKinds.join(",");

  // Search as the author types (debounced).
  useEffect(() => {
    if (!open || !option) return;
    const handle = setTimeout(async () => {
      const result = await searchNodesAction(query, option.otherKinds, nodeId);
      if (result.ok) setResults(result.data.filter((r) => r.id !== nodeId));
    }, 200);
    return () => clearTimeout(handle);
    // otherKindsKey stands in for option.otherKinds (a new array each render).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, query, otherKindsKey, nodeId]);

  function reset() {
    setQuery("");
    setResults([]);
    setSelected(null);
    setLabel("");
    setAttribute("");
    setError(null);
  }

  async function submit() {
    if (!option || !selected) return;
    setPending(true);
    setError(null);
    const [sourceId, targetId] = option.asSource ? [nodeId, selected.id] : [selected.id, nodeId];
    const result = await connectAction({
      sourceId,
      targetId,
      kind: option.kind,
      label,
      attribute: attribute || undefined,
    });
    setPending(false);
    if (!result.ok) return setError(result.error);
    setOpen(false);
    reset();
  }

  if (options.length === 0) return null;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent title={title} description={def?.hint}>
        <div className="space-y-4">
          {options.length > 1 && (
            <Field label="Connection" htmlFor="connection-kind">
              <Select
                id="connection-kind"
                value={optionIndex}
                onChange={(e) => {
                  setOptionIndex(Number(e.target.value));
                  setSelected(null);
                  setAttribute("");
                }}
              >
                {options.map((o, i) => (
                  <option key={`${o.kind}-${o.asSource}`} value={i}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </Field>
          )}

          <div className="space-y-1.5">
            <label htmlFor="connection-search" className="text-sm font-medium">
              Find{" "}
              {option
                ? option.otherKinds
                    .map((k) => NODE_KIND_LABELS[k].one.toLowerCase())
                    .slice(0, 3)
                    .join(", ")
                : ""}
              {option && option.otherKinds.length > 3 ? "…" : ""}
            </label>
            <div className="relative">
              <Search
                className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                id="connection-search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by title or name"
                className="pl-9"
                autoFocus
              />
            </div>
            <ul
              aria-label="Search results"
              className="max-h-56 overflow-y-auto rounded-md border border-border"
            >
              {results.length === 0 ? (
                <li className="px-3 py-2 text-sm text-muted-foreground">Nothing found.</li>
              ) : (
                results.map((r) => (
                  <li key={r.id}>
                    <button
                      type="button"
                      onClick={() => setSelected(r)}
                      aria-pressed={selected?.id === r.id}
                      className={cn(
                        "flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted",
                        selected?.id === r.id && "bg-primary/10",
                      )}
                    >
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {NODE_KIND_LABELS[r.kind].one}
                      </span>
                      <span className="truncate font-medium">{r.title}</span>
                      {r.context && (
                        <span className="truncate text-muted-foreground">· {r.context}</span>
                      )}
                    </button>
                  </li>
                ))
              )}
            </ul>
          </div>

          {def?.attribute && (
            <Field label={def.attribute.label} htmlFor="connection-attribute">
              <Select
                id="connection-attribute"
                value={attribute || def.attribute.defaultValue}
                onChange={(e) => setAttribute(e.target.value)}
              >
                {def.attribute.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </Field>
          )}

          <Field
            label="Label"
            htmlFor="connection-label"
            hint="Optional, in your own words (e.g. “her favourite song”)."
          >
            <Input id="connection-label" value={label} onChange={(e) => setLabel(e.target.value)} />
          </Field>

          <FormError message={error} />
          <div className="flex justify-end">
            <Button onClick={submit} disabled={!selected || pending}>
              {pending
                ? "Connecting…"
                : selected
                  ? `Connect “${selected.title}”`
                  : "Choose something to connect"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
