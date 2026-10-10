"use client";

import { FileText, NotebookPen } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/field";
import { cn } from "@/lib/utils";

import {
  deleteCommentAction,
  listCommentsForReviewAction,
  restoreCommentAction,
  setCommentResolvedAction,
} from "../actions";
import type { ReviewItem, ReviewState } from "../service";

type Item = Omit<ReviewItem, "createdAt" | "updatedAt"> & {
  createdAt: Date | string;
  updatedAt: Date | string;
};

const VIEWS: { state: ReviewState; slug: string; label: string; empty: string }[] = [
  {
    state: "NEEDS_REVIEW",
    slug: "needs-review",
    label: "Needs review",
    empty:
      "No comments need review. When text a comment points to changes, the comment shows up here.",
  },
  { state: "OPEN", slug: "open", label: "Open", empty: "No open comments." },
  { state: "RESOLVED", slug: "resolved", label: "Resolved", empty: "No resolved comments." },
];

const STATE_LABELS: Record<ReviewState, string> = {
  OPEN: "Open",
  NEEDS_REVIEW: "Needs review",
  RESOLVED: "Resolved",
};

type DocumentGroup = { id: string; title: string; context: string | null; items: Item[] };
type Group = { key: string; title: string; kind: "BOOK" | "NOTES"; documents: DocumentGroup[] };

/**
 * Books (by title), each with its scenes, then notes. Within a scene or
 * note, the list's order (newest first).
 */
function groupItems(items: Item[]): Group[] {
  const groups = new Map<string, Group>();
  for (const item of items) {
    const key = item.book ? `book:${item.book.id}` : "notes";
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        title: item.book ? item.book.title : "Notes",
        kind: item.book ? "BOOK" : "NOTES",
        documents: [],
      };
      groups.set(key, group);
    }
    let doc = group.documents.find((d) => d.id === item.document.id);
    if (!doc) {
      doc = {
        id: item.document.id,
        title: item.document.title,
        context: item.document.context,
        items: [],
      };
      group.documents.push(doc);
    }
    doc.items.push(item);
  }
  return [...groups.values()].sort(
    (a, b) =>
      Number(a.kind === "NOTES") - Number(b.kind === "NOTES") || a.title.localeCompare(b.title),
  );
}

/** The link that opens a comment in its scene or note, and comes back to this view. */
function textHref(item: Item, view: string) {
  const params = new URLSearchParams({ comment: item.id, from: view });
  return `${item.document.href}?${params}`;
}

/**
 * Review (M17): the workspace's comments in one state, grouped by book (then
 * scene) with notes on their own. Resolve, reopen and delete (with Undo)
 * happen here through the same server actions as in the editor; attaching a
 * comment to new text happens only in the editor ("Open in text").
 */
export function ReviewList({
  state,
  counts,
  initial,
  initialCursor,
}: {
  state: ReviewState;
  counts: Record<ReviewState, number>;
  initial: Item[];
  initialCursor: string | null;
}) {
  const [items, setItems] = useState<Item[]>(initial);
  const [cursor, setCursor] = useState(initialCursor);
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleted, setDeleted] = useState<{ item: Item; index: number; token: string } | null>(null);
  const view = VIEWS.find((v) => v.state === state)!;
  const groups = useMemo(() => groupItems(items), [items]);

  async function loadMore() {
    if (!cursor) return;
    setLoading(true);
    setError(null);
    try {
      const result = await listCommentsForReviewAction(state, cursor);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setItems((current) => {
        const seen = new Set(current.map((i) => i.id));
        return [...current, ...result.data.items.filter((i) => !seen.has(i.id))];
      });
      setCursor(result.data.nextCursor);
    } catch {
      setError("The next comments couldn’t be loaded. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  /** Runs an action on one comment; on success it leaves this view. */
  async function act(item: Item, run: () => Promise<{ ok: boolean; error?: string }>) {
    setPending(item.id);
    setError(null);
    try {
      const result = await run();
      if (!result.ok) {
        setError(result.error ?? "That didn’t work. Try again.");
        return false;
      }
      setItems((current) => current.filter((i) => i.id !== item.id));
      return true;
    } catch {
      setError("That didn’t work. Check your connection and try again.");
      return false;
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="space-y-4">
      <nav aria-label="Review views" className="flex flex-wrap gap-2">
        {VIEWS.map((v) => (
          <Link
            key={v.state}
            href={`/review?view=${v.slug}`}
            aria-current={v.state === state ? "page" : undefined}
            className={cn(
              "flex items-center gap-2 rounded-full border border-border px-3 py-1 text-sm hover:bg-surface-hover",
              v.state === state && "border-primary/50 bg-secondary font-medium text-primary",
            )}
          >
            {v.label}
            <span className="text-xs text-muted-foreground">
              {counts[v.state]}
              <span className="sr-only"> comments</span>
            </span>
          </Link>
        ))}
      </nav>

      <FormError message={error} />

      {deleted && (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-muted p-3 text-sm"
        >
          <span>Comment deleted.</span>
          <Button
            size="sm"
            variant="outline"
            disabled={pending === deleted.item.id}
            onClick={async () => {
              setPending(deleted.item.id);
              setError(null);
              try {
                const result = await restoreCommentAction(deleted.item.id, deleted.token);
                if (!result.ok) {
                  setError(result.error);
                  return;
                }
                setItems((current) => {
                  if (current.some((i) => i.id === deleted.item.id)) return current;
                  const next = [...current];
                  next.splice(Math.min(deleted.index, next.length), 0, deleted.item);
                  return next;
                });
                setDeleted(null);
              } catch {
                setError("That didn’t work. Check your connection and try again.");
              } finally {
                setPending(null);
              }
            }}
          >
            Undo
          </Button>
        </div>
      )}

      {items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground">
          {view.empty}
        </p>
      ) : (
        <div className="space-y-6">
          {groups.map((group) => (
            <section
              key={group.key}
              aria-label={group.kind === "NOTES" ? "Notes" : `Book: ${group.title}`}
              className="space-y-2"
            >
              <h2 className="flex items-center gap-2 text-base font-semibold">
                {group.kind === "NOTES" ? (
                  <NotebookPen className="size-4 text-muted-foreground" aria-hidden />
                ) : (
                  <FileText className="size-4 text-muted-foreground" aria-hidden />
                )}
                <span className="min-w-0 break-words">{group.title}</span>
              </h2>
              {group.documents.map((doc) => (
                <div key={doc.id} className="space-y-2">
                  <h3 className="text-sm font-medium break-words">
                    {doc.title}
                    {group.kind === "BOOK" && doc.context && (
                      <span className="ml-2 text-xs font-normal text-muted-foreground">
                        {doc.context.startsWith(`${group.title} › `)
                          ? doc.context.slice(group.title.length + 3)
                          : doc.context}
                      </span>
                    )}
                  </h3>
                  <ul
                    aria-label={`Comments on ${doc.title}`}
                    className="space-y-2 border-l border-border pl-3"
                  >
                    {doc.items.map((item) => (
                      <ReviewEntry
                        key={item.id}
                        item={item}
                        href={textHref(item, view.slug)}
                        busy={pending === item.id}
                        onResolve={(resolved) =>
                          act(item, () => setCommentResolvedAction(item.id, resolved))
                        }
                        onDelete={async () => {
                          const index = items.findIndex((i) => i.id === item.id);
                          let token = "";
                          const ok = await act(item, async () => {
                            const result = await deleteCommentAction(item.id);
                            if (result.ok) token = new Date(result.data.deletedAt).toISOString();
                            return result;
                          });
                          if (ok) setDeleted({ item, index, token });
                        }}
                      />
                    ))}
                  </ul>
                </div>
              ))}
            </section>
          ))}
        </div>
      )}

      {cursor && (
        <div className="flex justify-center">
          <Button variant="outline" onClick={() => void loadMore()} disabled={loading}>
            {loading ? "Loading…" : "Show more"}
          </Button>
        </div>
      )}
    </div>
  );
}

function ReviewEntry({
  item,
  href,
  busy,
  onResolve,
  onDelete,
}: {
  item: Item;
  href: string;
  busy: boolean;
  onResolve: (resolved: boolean) => Promise<boolean>;
  onDelete: () => Promise<void>;
}) {
  const review = item.state === "NEEDS_REVIEW";
  return (
    <li
      aria-label={`Comment on “${item.quote.slice(0, 60)}”`}
      data-state={item.state}
      className={cn(
        "space-y-2 rounded-lg border bg-surface p-3 text-sm",
        review ? "border-warning/60" : "border-border",
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Badge
          className={cn(
            review && "bg-warning-bg text-warning",
            item.state === "RESOLVED" && "bg-success-bg text-success",
          )}
        >
          {STATE_LABELS[item.state]}
        </Badge>
      </div>
      <blockquote className="line-clamp-3 border-l-2 border-info pl-2 break-words text-muted-foreground italic">
        {item.quote}
      </blockquote>
      {review && (
        <p className="text-xs text-muted-foreground">
          The text this comment was on changed. Open it in the text to attach it to the right
          passage.
        </p>
      )}
      <p className="break-words whitespace-pre-wrap">{item.body}</p>
      <div className="flex flex-wrap gap-1">
        <Link
          href={href}
          className="inline-flex h-8 items-center rounded-md border border-border px-3 text-sm font-medium hover:bg-surface-hover"
        >
          Open in text
        </Link>
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() => void onResolve(item.state !== "RESOLVED")}
        >
          {item.state === "RESOLVED" ? "Reopen" : "Resolve"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="text-destructive"
          disabled={busy}
          onClick={() => void onDelete()}
        >
          Delete
        </Button>
      </div>
    </li>
  );
}
