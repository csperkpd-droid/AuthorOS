"use client";

import { ArchiveRestore, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FormError } from "@/components/ui/field";
import type { StoryNodeKind } from "@/generated/prisma/enums";
import { useAction } from "@/hooks/use-action";
import { formatDateTime } from "@/lib/format";

import { deleteForeverAction, emptyTrashAction, restoreAction } from "../actions";

const KIND_LABELS: Record<StoryNodeKind, string> = {
  SERIES: "Series",
  BOOK: "Book",
  PART: "Part",
  CHAPTER: "Chapter",
  SCENE: "Scene",
};

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
        <p className="font-serif text-lg">The Trash is empty</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Deleted series, books, parts, chapters and scenes wait here until you restore them or
          delete them forever.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <ConfirmDialog
          trigger={
            <Button variant="outline" size="sm">
              <Trash2 />
              Empty Trash
            </Button>
          }
          title="Empty the Trash?"
          description={`This permanently deletes ${items.length} item${items.length === 1 ? "" : "s"} and everything inside them, including their history. This can’t be undone.`}
          confirmLabel="Delete forever"
          destructive
          onConfirm={() => emptyTrashAction()}
        />
      </div>
      <FormError message={restore.error} />
      <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
        {items.map((item) => (
          <li key={item.id} className="flex flex-wrap items-center gap-3 p-4">
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2">
                <Badge>{KIND_LABELS[item.kind]}</Badge>
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
              <ConfirmDialog
                trigger={
                  <Button size="sm" variant="ghost" className="text-destructive">
                    Delete forever
                  </Button>
                }
                title={`Delete “${item.title}” forever?`}
                description="It will be permanently deleted with everything inside it, including its history. This can’t be undone."
                confirmLabel="Delete forever"
                destructive
                onConfirm={() => deleteForeverAction(item.kind, item.id)}
              />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
