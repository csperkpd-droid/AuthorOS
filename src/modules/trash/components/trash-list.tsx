"use client";

import { ArchiveRestore, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/field";
import type { StoryNodeKind } from "@/generated/prisma/enums";
import { useAction } from "@/hooks/use-action";
import { ImpactDialog } from "@/modules/impact/ui";
import { NODE_KIND_LABELS } from "@/modules/story-graph/ui";
import { formatDateTime } from "@/lib/format";

import {
  deleteForeverAction,
  emptyTrashAction,
  previewDeleteForeverAction,
  previewEmptyTrashAction,
  restoreAction,
} from "../actions";

const kindLabel = (kind: StoryNodeKind) => NODE_KIND_LABELS[kind].one;

type Item = {
  id: string;
  kind: StoryNodeKind;
  title: string;
  context: string | null;
  deletedAt: Date;
};

export function TrashList({ items }: { items: Item[] }) {
  const restore = useAction(restoreAction);

  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border px-6 py-12 text-center">
        <p className="font-display text-2xl font-semibold">The Trash is empty</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Deleted work waits here until you restore it or delete it forever.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <ImpactDialog
          trigger={
            <Button variant="outline" size="sm">
              <Trash2 />
              Empty Trash
            </Button>
          }
          title="Empty the Trash?"
          loadReport={previewEmptyTrashAction}
          onConfirm={emptyTrashAction}
          confirmLabel="Delete forever"
        />
      </div>
      <FormError message={restore.error} />
      <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
        {items.map((item) => (
          <li key={item.id} className="flex flex-wrap items-center gap-3 p-4">
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2">
                <Badge>{kindLabel(item.kind)}</Badge>
                <span className="font-medium">{item.title}</span>
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {item.context && <>{item.context} · </>}Deleted {formatDateTime(item.deletedAt)}
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={restore.pending}
                onClick={() => restore.run(item.kind, item.id)}
              >
                <ArchiveRestore />
                Restore
              </Button>
              <ImpactDialog
                trigger={
                  <Button size="sm" variant="ghost" aria-label={`Delete ${item.title} forever`}>
                    Delete forever
                  </Button>
                }
                title={`Delete “${item.title}” forever?`}
                loadReport={previewDeleteForeverAction.bind(null, item.kind, item.id)}
                onConfirm={deleteForeverAction.bind(null, item.kind, item.id)}
                confirmLabel="Delete forever"
              />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
