"use client";

import { History, Save } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { FormError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { formatDateTime, formatWords } from "@/lib/format";
import { cn } from "@/lib/utils";

import {
  getRevisionAction,
  listRevisionsAction,
  restoreRevisionAction,
  saveVersionAction,
} from "../actions";
import { REVISION_SOURCE_LABELS } from "../labels";

type Revision = {
  id: string;
  createdAt: Date;
  wordCount: number;
  source: string;
  label: string | null;
  excerpt: string;
};

/** Version history for a scene: browse, preview, save a named version, restore. */
export function RevisionsDialog({ nodeId, noun = "scene" }: { nodeId: string; noun?: string }) {
  const [open, setOpen] = useState(false);
  const [revisions, setRevisions] = useState<Revision[] | null>(null);
  const [selected, setSelected] = useState<{ id: string; text: string } | null>(null);
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function load() {
    const result = await listRevisionsAction(nodeId);
    if (result.ok) setRevisions(result.data);
    else setError(result.error);
  }

  async function preview(id: string) {
    const result = await getRevisionAction(id);
    if (result.ok) setSelected({ id, text: result.data.contentText });
    else setError(result.error);
  }

  async function saveNamedVersion() {
    setBusy(true);
    setError(null);
    const result = await saveVersionAction(nodeId, label);
    setBusy(false);
    if (!result.ok) return setError(result.error);
    setLabel("");
    setNotice("Version saved.");
    await load();
  }

  async function restore(id: string) {
    setBusy(true);
    setError(null);
    const result = await restoreRevisionAction(id);
    setBusy(false);
    if (!result.ok) return setError(result.error);
    setOpen(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        setError(null);
        setNotice(null);
        setSelected(null);
        if (o) void load();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <History />
          History
        </Button>
      </DialogTrigger>
      <DialogContent
        title={`${noun[0].toUpperCase()}${noun.slice(1)} history`}
        description="Earlier versions are kept automatically while you write. Restoring keeps a copy of the current text."
        className="max-w-2xl"
      >
        <div className="space-y-4">
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void saveNamedVersion();
            }}
          >
            <Input
              aria-label="Version name"
              placeholder="Name this version (optional)"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
            <Button type="submit" variant="outline" disabled={busy} className="shrink-0">
              <Save />
              Save version
            </Button>
          </form>
          {notice && (
            <p role="status" className="text-sm text-muted-foreground">
              {notice}
            </p>
          )}
          <FormError message={error} />

          {revisions === null ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : revisions.length === 0 ? (
            <p className="text-sm text-muted-foreground">No earlier versions yet.</p>
          ) : (
            <ul className="max-h-[50vh] divide-y divide-border overflow-y-auto rounded-md border border-border">
              {revisions.map((r) => (
                <li key={r.id} className={cn("p-3", selected?.id === r.id && "bg-muted/60")}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">
                        {r.label ?? formatDateTime(r.createdAt)}
                      </p>
                      <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        {r.label && <span>{formatDateTime(r.createdAt)}</span>}
                        <Badge>{REVISION_SOURCE_LABELS[r.source] ?? r.source}</Badge>
                        {formatWords(r.wordCount)}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" variant="ghost" onClick={() => preview(r.id)}>
                        Preview
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => restore(r.id)}
                      >
                        Restore
                      </Button>
                    </div>
                  </div>
                  {selected?.id === r.id ? (
                    <div className="mt-3 max-h-64 overflow-y-auto rounded bg-surface p-3 font-manuscript text-sm whitespace-pre-wrap">
                      {selected.text || <em className="text-muted-foreground">Empty</em>}
                    </div>
                  ) : (
                    r.excerpt && (
                      <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{r.excerpt}</p>
                    )
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
