"use client";

import type { Editor } from "@tiptap/react";
import { Plugin, PluginKey, type EditorState } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { MessageSquare, MessageSquarePlus, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { ANCHOR_CONTEXT, MAX_QUOTE } from "@/lib/anchors";
import { cn } from "@/lib/utils";
import { flattenDoc } from "@/lib/work-place";

import {
  addCommentAction,
  deleteCommentAction,
  listCommentsAction,
  restoreCommentAction,
  setCommentResolvedAction,
  updateCommentAnchorAction,
  updateCommentBodyAction,
} from "../actions";
import type { CommentView } from "../service";

type Comment = Omit<CommentView, "createdAt" | "updatedAt"> & {
  createdAt: Date | string;
  updatedAt: Date | string;
};

/** A passage selected in the text, as the server will check it. */
type Selected = {
  version: number;
  start: number;
  end: number;
  quote: string;
  prefix: string;
  suffix: string;
};

const STATE_LABELS = { OPEN: "Open", NEEDS_REVIEW: "Needs review", RESOLVED: "Resolved" } as const;

const highlights = new PluginKey<DecorationSet>("comment-highlights");

/**
 * Highlights for anchored passages: decorations drawn by the editor, never
 * part of the document. They follow typing (mapped through each change) and
 * are recomputed from the server's anchors once the text is saved.
 */
function highlightPlugin(onClick: (id: string) => void) {
  return new Plugin<DecorationSet>({
    key: highlights,
    state: {
      init: () => DecorationSet.empty,
      apply: (tr, set) => {
        const next = tr.getMeta(highlights) as DecorationSet | undefined;
        return next ?? set.map(tr.mapping, tr.doc);
      },
    },
    props: {
      decorations: (state: EditorState) => highlights.getState(state),
      handleClick: (_view, _pos, event) => {
        const el = (event.target as HTMLElement | null)?.closest?.("[data-comment-id]");
        const id = el?.getAttribute("data-comment-id");
        if (id) onClick(id);
        return false;
      },
    },
  });
}

/** The selected passage in plain-text offsets (the editor's flattening), or null. */
function selectedPassage(editor: Editor, version: number): Selected | null {
  const { from, to, empty } = editor.state.selection;
  if (empty) return null;
  const flat = flattenDoc(editor.state.doc);
  const start = flat.posAt.findIndex((p) => p >= from);
  if (start === -1) return null;
  let end = start;
  while (end < flat.posAt.length && flat.posAt[end] < to) end++;
  const quote = flat.text.slice(start, end);
  if (!quote.trim()) return null;
  return {
    version,
    start,
    end,
    quote,
    prefix: flat.text.slice(Math.max(0, start - ANCHOR_CONTEXT), start),
    suffix: flat.text.slice(end, end + ANCHOR_CONTEXT),
  };
}

/** Editor positions of an anchored passage, when the text shown still has it there. */
function passageRange(flat: ReturnType<typeof flattenDoc>, c: Comment) {
  if (c.anchorLost) return null;
  if (flat.text.slice(c.start, c.end) !== c.quote) return null;
  return { from: flat.posAt[c.start], to: flat.posAt[c.end - 1] + 1 };
}

/**
 * The comments of a scene or note (M16): a margin panel on wide screens, a
 * sheet on phones. Comments are kept outside the text; adding, resolving or
 * deleting one never changes the document. A comment whose passage changed
 * needs review: it keeps its original quote until the author attaches it
 * to a passage they choose.
 */
export function DocumentComments({
  nodeId,
  initial,
  editor,
  version,
  saved,
  canComment,
  thing,
  focusId = null,
}: {
  nodeId: string;
  initial: Comment[];
  editor: Editor;
  version: number;
  saved: boolean;
  canComment: boolean;
  /** "scene" or "note", for messages. */
  thing: string;
  /**
   * A comment to show on opening (Review's "Open in text", M17): the panel
   * opens on it and its passage is selected; a comment that needs review
   * shows its original quote. Ignored when it isn't one of this text's.
   */
  focusId?: string | null;
}) {
  const [comments, setComments] = useState<Comment[]>(initial);
  const focused = focusId ? initial.find((c) => c.id === focusId) : undefined;
  const [open, setOpen] = useState(Boolean(focused));
  const [active, setActive] = useState<string | null>(focused?.id ?? null);
  const focusPending = useRef(Boolean(focused));
  const [composing, setComposing] = useState<Selected | null>(null);
  const [showResolved, setShowResolved] = useState(focused?.state === "RESOLVED");
  const [deleted, setDeleted] = useState<{ comment: Comment; token: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const loaded = useRef(version);

  const reload = useCallback(async () => {
    const result = await listCommentsAction(nodeId);
    if (result.ok) setComments(result.data);
  }, [nodeId]);

  // After each save or restore the server has re-found every passage: reload.
  useEffect(() => {
    if (version === loaded.current) return;
    loaded.current = version;
    void reload();
  }, [version, reload]);

  // The highlight plugin lives as long as this panel.
  useEffect(() => {
    if (editor.isDestroyed) return;
    editor.registerPlugin(
      highlightPlugin((id) => {
        setActive(id);
        setOpen(true);
      }),
    );
    return () => {
      if (!editor.isDestroyed) editor.unregisterPlugin(highlights);
    };
  }, [editor]);

  // Redraw the highlights from the anchors when the text shown is the saved text.
  useEffect(() => {
    if (editor.isDestroyed || !saved) return;
    const flat = flattenDoc(editor.state.doc);
    const decorations = comments.flatMap((c) => {
      if (c.state === "RESOLVED" && !showResolved) return [];
      const range = passageRange(flat, c);
      return range
        ? [
            Decoration.inline(range.from, range.to, {
              class: cn("comment-highlight", c.id === active && "comment-highlight-active"),
              "data-comment-id": c.id,
            }),
          ]
        : [];
    });
    const set = DecorationSet.create(editor.state.doc, decorations);
    editor.view.dispatch(editor.state.tr.setMeta(highlights, set).setMeta("addToHistory", false));
  }, [editor, comments, saved, active, showResolved]);

  // Wide screens: the panel takes the right edge, so the page makes room for
  // it instead of covering the text (body.comments-open in globals.css).
  useEffect(() => {
    if (!open) return;
    document.body.classList.add("comments-open");
    return () => document.body.classList.remove("comments-open");
  }, [open]);

  // Opened on a comment: once the saved text is shown, select its passage
  // (when it is still anchored) and bring the comment into view.
  useEffect(() => {
    if (!focusPending.current || !open || !saved || editor.isDestroyed) return;
    const c = comments.find((x) => x.id === active);
    if (!c) return;
    focusPending.current = false;
    const range = passageRange(flattenDoc(editor.state.doc), c);
    if (range) editor.chain().setTextSelection(range).scrollIntoView().run();
    requestAnimationFrame(() =>
      document.getElementById(`comment-${c.id}`)?.scrollIntoView({ block: "nearest" }),
    );
  }, [editor, comments, active, open, saved]);

  const visible = comments.filter((c) => showResolved || c.state !== "RESOLVED");
  const resolvedCount = comments.filter((c) => c.state === "RESOLVED").length;
  const review = comments.filter((c) => c.state === "NEEDS_REVIEW").length;
  const openCount = comments.length - resolvedCount;

  /** The current selection as a passage the server will accept, or an explanation. */
  function takeSelection(): Selected | null {
    setError(null);
    if (!saved) {
      setError(`Saving your latest text first. Try again once the ${thing} says it’s saved.`);
      return null;
    }
    const passage = selectedPassage(editor, version);
    if (!passage) {
      setError("Select the passage in the text first.");
      return null;
    }
    if (passage.quote.length > MAX_QUOTE) {
      setError("Select a shorter passage (up to 2,000 characters).");
      return null;
    }
    return passage;
  }

  async function run<T>(
    action: () => Promise<{ ok: true; data: T } | { ok: false; error: string }>,
  ) {
    setPending(true);
    setError(null);
    try {
      const result = await action();
      if (!result.ok) {
        setError(result.error);
        return null;
      }
      return result;
    } finally {
      setPending(false);
    }
  }

  function startComment() {
    const passage = takeSelection();
    if (!passage) {
      setOpen(true);
      return;
    }
    setComposing(passage);
    setOpen(true);
  }

  function show(c: Comment) {
    setActive(c.id);
    const range = passageRange(flattenDoc(editor.state.doc), c);
    if (!range) return;
    editor.chain().setTextSelection(range).scrollIntoView().run();
  }

  return (
    <>
      <div className="flex items-center gap-1">
        {canComment && (
          <Button
            variant="ghost"
            size="sm"
            onMouseDown={(e) => e.preventDefault() /* keep the text selected */}
            onClick={startComment}
            aria-label="Comment on selected text"
            title="Comment on selected text"
          >
            <MessageSquarePlus />
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls={`comments-${nodeId}`}
          aria-label={`Comments: ${openCount} open${review ? `, ${review} need review` : ""}`}
        >
          <MessageSquare />
          <span aria-hidden>{openCount}</span>
          {review > 0 && (
            <Badge className="bg-warning-bg text-warning" aria-hidden>
              {review}
            </Badge>
          )}
        </Button>
      </div>

      {open &&
        createPortal(
          <aside
            id={`comments-${nodeId}`}
            aria-label="Comments"
            className="fixed inset-x-0 bottom-0 z-40 flex max-h-[70dvh] flex-col rounded-t-xl border-t border-border bg-surface-elevated text-sm text-foreground shadow-lg lg:inset-x-auto lg:top-0 lg:right-0 lg:h-dvh lg:max-h-none lg:w-96 lg:rounded-none lg:border-t-0 lg:border-l"
          >
            <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
              <h2 className="text-base font-semibold">Comments</h2>
              <Button
                variant="ghost"
                size="sm"
                aria-label="Close comments"
                onClick={() => setOpen(false)}
              >
                <X />
              </Button>
            </div>

            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain p-4">
              <p className="text-xs text-muted-foreground">
                Comments are kept beside the text, never in it.
              </p>
              <FormError message={error} />

              {composing && (
                <NewComment
                  passage={composing}
                  pending={pending}
                  onCancel={() => setComposing(null)}
                  onSave={async (body) => {
                    const result = await run(() =>
                      addCommentAction(nodeId, { ...composing, body }),
                    );
                    if (!result) return;
                    setComposing(null);
                    setActive(result.data.id);
                    await reload();
                  }}
                />
              )}

              {deleted && (
                <div
                  role="status"
                  className="flex items-center justify-between gap-2 rounded-md border border-border bg-muted p-3"
                >
                  <span>Comment deleted.</span>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={async () => {
                      const result = await run(() =>
                        restoreCommentAction(deleted.comment.id, deleted.token),
                      );
                      if (!result) return;
                      setDeleted(null);
                      await reload();
                    }}
                  >
                    Undo
                  </Button>
                </div>
              )}

              {visible.length === 0 && !composing ? (
                <p className="text-muted-foreground">
                  {canComment
                    ? `No comments yet. Select a passage in the ${thing}, then choose “Comment on selected text”.`
                    : "No comments yet."}
                </p>
              ) : (
                <ul aria-label="Comments on this text" className="space-y-3">
                  {visible.map((c) => (
                    <CommentItem
                      key={c.id}
                      comment={c}
                      active={c.id === active}
                      canComment={canComment}
                      pending={pending}
                      onShow={() => show(c)}
                      onEdit={async (body) => {
                        const result = await run(() => updateCommentBodyAction(c.id, body, c.body));
                        if (result) await reload();
                        return Boolean(result);
                      }}
                      onResolve={async (resolved) => {
                        if (await run(() => setCommentResolvedAction(c.id, resolved)))
                          await reload();
                      }}
                      onAttach={async () => {
                        const passage = takeSelection();
                        if (!passage) return;
                        if (await run(() => updateCommentAnchorAction(c.id, passage))) {
                          setActive(c.id);
                          await reload();
                        }
                      }}
                      onDelete={async () => {
                        const result = await run(() => deleteCommentAction(c.id));
                        if (!result) return;
                        setDeleted({
                          comment: c,
                          token: new Date(result.data.deletedAt).toISOString(),
                        });
                        await reload();
                      }}
                    />
                  ))}
                </ul>
              )}

              {resolvedCount > 0 && (
                <Button variant="ghost" size="sm" onClick={() => setShowResolved((v) => !v)}>
                  {showResolved ? "Hide resolved" : `Show resolved (${resolvedCount})`}
                </Button>
              )}
            </div>
          </aside>,
          document.body,
        )}
    </>
  );
}

function NewComment({
  passage,
  pending,
  onSave,
  onCancel,
}: {
  passage: Selected;
  pending: boolean;
  onSave: (body: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [body, setBody] = useState("");
  return (
    <form
      aria-label="New comment"
      className="space-y-2 rounded-md border border-border p-3"
      onSubmit={(e) => {
        e.preventDefault();
        void onSave(body);
      }}
    >
      <blockquote className="line-clamp-3 border-l-2 border-info pl-2 text-muted-foreground italic">
        {passage.quote}
      </blockquote>
      <Textarea
        aria-label="Comment"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={3}
        autoFocus
        required
      />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={pending || !body.trim()}>
          Add comment
        </Button>
      </div>
    </form>
  );
}

function CommentItem({
  comment: c,
  active,
  canComment,
  pending,
  onShow,
  onEdit,
  onResolve,
  onAttach,
  onDelete,
}: {
  comment: Comment;
  active: boolean;
  canComment: boolean;
  pending: boolean;
  onShow: () => void;
  onEdit: (body: string) => Promise<boolean>;
  onResolve: (resolved: boolean) => Promise<void>;
  onAttach: () => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(c.body);
  const review = c.state === "NEEDS_REVIEW";
  const label = useMemo(() => `Comment on “${c.quote.slice(0, 60)}”`, [c.quote]);

  return (
    <li
      id={`comment-${c.id}`}
      aria-label={label}
      aria-current={active ? "true" : undefined}
      data-state={c.state}
      className={cn(
        "space-y-2 rounded-md border p-3",
        active ? "border-primary/60" : "border-border",
        review && "border-warning/60 bg-warning-bg/40",
        c.state === "RESOLVED" && "opacity-75",
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Badge
          className={cn(
            review && "bg-warning-bg text-warning",
            c.state === "RESOLVED" && "bg-success-bg text-success",
          )}
        >
          {STATE_LABELS[c.state]}
        </Badge>
      </div>
      <button
        type="button"
        onClick={onShow}
        disabled={c.anchorLost}
        className="block w-full text-left"
        aria-label={c.anchorLost ? "Original passage" : "Show the passage in the text"}
      >
        <blockquote className="line-clamp-3 border-l-2 border-info pl-2 text-muted-foreground italic">
          {c.quote}
        </blockquote>
      </button>
      {review && (
        <p className="text-xs text-muted-foreground">
          The text this comment was on changed, so it isn’t attached to anything now. Its original
          passage is shown above. Select the passage it belongs to, then choose “Attach to
          selection”.
        </p>
      )}
      {editing ? (
        <form
          className="space-y-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await onEdit(body)) setEditing(false);
          }}
        >
          <Textarea
            aria-label="Edit comment"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={3}
          />
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setBody(c.body);
                setEditing(false);
              }}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={pending || !body.trim()}>
              Save
            </Button>
          </div>
        </form>
      ) : (
        <p className="break-words whitespace-pre-wrap">{c.body}</p>
      )}
      {canComment && !editing && (
        <div className="flex flex-wrap gap-1">
          {review && (
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => void onAttach()}
            >
              Attach to selection
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() => void onResolve(c.state !== "RESOLVED")}
          >
            {c.state === "RESOLVED" ? "Reopen" : "Resolve"}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
            Edit
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive"
            disabled={pending}
            onClick={() => void onDelete()}
          >
            Delete
          </Button>
        </div>
      )}
    </li>
  );
}
