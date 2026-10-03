"use client";

import { History } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { FormError } from "@/components/ui/field";
import { formatDateTime } from "@/lib/format";

import { listFieldHistoryAction, restoreFieldValueAction } from "../actions";
import { REVISION_SOURCE_LABELS } from "../labels";

type Entry = { id: string; field: string; value: string; source: string; createdAt: Date };

const FIELD_NAMES: Record<string, string> = {
  synopsis: "Synopsis",
  summary: "Summary",
  description: "Description",
  body: "Text",
  notes: "Notes",
  bio: "Bio",
};

function fieldName(field: string, labels: Record<string, string>) {
  if (labels[field]) return labels[field];
  if (FIELD_NAMES[field]) return FIELD_NAMES[field];
  if (field.startsWith("beat:")) return "Beat description";
  if (field.startsWith("profile.")) return field.slice(8).replace(/^\w/, (c) => c.toUpperCase());
  return field;
}

/**
 * Earlier values of an object's text fields (synopsis, summary, profile
 * fields, descriptions…), kept automatically on every edit. Restoring keeps
 * the current value too.
 */
export function FieldHistoryDialog({
  nodeId,
  labels = {},
  title = "Earlier versions",
}: {
  nodeId: string;
  /** Display names for fields, e.g. { "profile.goal": "Goal" }. */
  labels?: Record<string, string>;
  title?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const result = await listFieldHistoryAction(nodeId);
    if (result.ok) setEntries(result.data);
    else setError(result.error);
  }

  async function restore(id: string) {
    setBusy(true);
    setError(null);
    const result = await restoreFieldValueAction(id);
    setBusy(false);
    if (!result.ok) return setError(result.error);
    setOpen(false);
    router.refresh();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        setError(null);
        if (o) void load();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          <History />
          {title}
        </Button>
      </DialogTrigger>
      <DialogContent
        title={title}
        description="Earlier values are kept automatically whenever text is changed. Restoring keeps a copy of the current value."
        className="max-w-2xl"
      >
        <FormError message={error} />
        {entries === null ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">No earlier versions yet.</p>
        ) : (
          <ul
            aria-label="Earlier values"
            className="max-h-[60vh] divide-y divide-border overflow-y-auto rounded-md border border-border"
          >
            {entries.map((e) => (
              <li key={e.id} className="space-y-1 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-medium">{fieldName(e.field, labels)}</span>
                    <span className="text-xs text-muted-foreground">
                      {formatDateTime(e.createdAt)}
                    </span>
                    <Badge>{REVISION_SOURCE_LABELS[e.source] ?? e.source}</Badge>
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => restore(e.id)}
                    aria-label={`Restore this ${fieldName(e.field, labels).toLowerCase()}`}
                  >
                    Restore
                  </Button>
                </div>
                <p className="line-clamp-4 text-sm whitespace-pre-line text-muted-foreground">
                  {e.value}
                </p>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
