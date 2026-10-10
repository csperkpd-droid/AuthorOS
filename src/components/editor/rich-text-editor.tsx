"use client";

import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import { Placeholder } from "@tiptap/extensions";
import StarterKit from "@tiptap/starter-kit";
import { Bold, Heading2, Italic, Minus, Quote, Redo2, Undo2, type LucideIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { formatWords } from "@/lib/format";
import { isSignedOutHere } from "@/lib/auth/signed-out-here";
import {
  deleteLocalDraft,
  readLocalDraft,
  saveLocalDraft,
  type DraftRef,
} from "@/lib/local-drafts";
import { countWords, type Doc } from "@/lib/text";
import {
  captureAnchor,
  editWork,
  readWork,
  resolveAnchor,
  takeRestore,
  updateWorkAnchor,
  visitWork,
  writeWork,
  type PlaceAnchor,
  type WorkEntry,
} from "@/lib/work-place";
import { cn } from "@/lib/utils";

/**
 * Where the latest text is (M8). Cloud: "saved" (the cloud has exactly this
 * text), "dirty" (changed, cloud save pending), "saving", "waiting" (offline
 * or the cloud is unreachable: retrying), "conflict" (changed elsewhere).
 * Device: whether the latest text is stored on this device.
 */
type SaveState = "saved" | "dirty" | "saving" | "waiting" | "conflict";
type DeviceState = "idle" | "saved" | "unavailable";

const AUTOSAVE_DELAY_MS = 1000;
const LOCAL_DELAY_MS = 150;
const RETRY_DELAY_MS = 5000;
const PLACE_DELAY_MS = 300;
const SERVER_PLACE_DELAY_MS = 3000;

/**
 * What a panel beside the text (comments, M16) needs from the editor: the
 * editor itself, the version the cloud has, and whether the text shown is
 * exactly that version (nothing unsaved).
 */
export type EditorApi = { editor: Editor; version: number; saved: boolean };

export type SaveResult =
  | { ok: true; data: { version: number; savedAt: Date | string } }
  | { ok: false; error: string; code?: string };

/** Text written on this device that never reached the cloud, found when the editor opens. */
type Recovered =
  | { kind: "restored"; writtenAt: number }
  | { kind: "kept"; writtenAt: number }
  | { kind: "failed"; writtenAt: number; content: Doc };

/**
 * Rich text editing, shared by scenes and notes, with two safety layers:
 *
 * 1. **This device first.** Every change is stored locally (IndexedDB)
 *    almost immediately, so typing survives a lost connection, a crashed
 *    tab or a closed laptop.
 * 2. **Then the cloud.** Autosave sends the text shortly after typing stops
 *    and retries until it succeeds; the local draft is removed only once
 *    the cloud has exactly that text. Version snapshots (history) are the
 *    third layer, on the server.
 *
 * The status always says where the text is; text only on this device is
 * never shown as saved. When the editor opens and finds unsynced text from
 * this device: if the cloud copy hasn't changed since, the text is restored
 * and synced; if it changed elsewhere, the device's text is kept as a saved
 * version (nothing is overwritten, nothing is dropped).
 */
export function RichTextEditor({
  content,
  version,
  wordCount: initialWordCount,
  onSave,
  onKeepDraft,
  draft,
  label,
  placeholder = "Start writing…",
  thing = "text",
  workPlace,
  aside,
}: {
  content: Doc | null;
  version: number;
  /** Omit to hide the live word count. */
  wordCount?: number;
  /** Persists the document if the stored version still equals `baseVersion`. */
  onSave: (doc: Doc, baseVersion: number) => Promise<SaveResult>;
  /** Keeps unsynced device text as a version when the cloud copy changed meanwhile. */
  onKeepDraft: (doc: Doc, writtenAt: string) => Promise<{ ok: boolean }>;
  /** This document's local draft: whose it is, which document, how to name it. */
  draft: DraftRef;
  /** Accessible name of the text area, e.g. "Scene text". */
  label: string;
  placeholder?: string;
  /** What is being edited, for messages ("scene", "note"). */
  thing?: string;
  /**
   * Work Context (M10): this document as a working place. Its position is
   * kept for Return to Work (this tab) and, with `onPlace`, recorded on the
   * server for Continue Writing; it is restored only when the author comes
   * back through those.
   */
  workPlace?: {
    owner: string;
    entry: Omit<WorkEntry, "anchor">;
    onPlace?: (anchor: PlaceAnchor) => void;
  };
  /** Controls shown beside the save status, e.g. the document's comments (M16). */
  aside?: (api: EditorApi) => ReactNode;
}) {
  // Stable while the same document is open (the prop is a new object each render).
  const { owner, item, label: draftLabel, href } = draft;
  const draftRef = useMemo(
    () => ({ owner, item, label: draftLabel, href }),
    [owner, item, draftLabel, href],
  );
  const versionRef = useRef(version);
  // The cloud's version, as state for `aside` (versionRef stays the source of truth).
  const [cloudVersion, setCloudVersion] = useState(version);
  const placeRef = useRef(workPlace);
  const placeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const serverPlaceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const placeReady = useRef(false);
  const edited = useRef(false);
  // Coming back after the text changed: "near" (not exactly) or "lost" (start).
  const [placeLost, setPlaceLost] = useState<"near" | "lost" | null>(null);
  const [state, setState] = useState<SaveState>("saved");
  const stateRef = useRef<SaveState>("saved");
  const [device, setDevice] = useState<DeviceState>("idle");
  // Only shown while waiting to sync, never in the first render, so no hydration mismatch.
  const [offline, setOffline] = useState(
    () => typeof navigator !== "undefined" && navigator.onLine === false,
  );
  const [recovered, setRecovered] = useState<Recovered | null>(null);
  const [wordCount, setWordCount] = useState(initialWordCount ?? 0);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const localTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef(false);
  const queued = useRef(false);
  // Incremented on every edit; a save is only "clean" if nothing changed while it ran.
  const changeSeq = useRef(0);
  const editorRef = useRef<Editor | null>(null);
  // Retries and queued saves call the latest `save` through this ref.
  const saveRef = useRef<() => Promise<void>>(async () => {});

  // Work Context: remembers where the author is (set up once the editor exists).
  const notePlaceRef = useRef<() => void>(() => {});
  const openPlaceRef = useRef<() => void>(() => {});

  const update = useCallback((next: SaveState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  /** Layer 1: the latest text on this device. */
  const writeLocal = useCallback(async () => {
    const editor = editorRef.current;
    if (!editor) return;
    const ok = await saveLocalDraft(draftRef, {
      content: editor.getJSON(),
      baseVersion: versionRef.current,
      writtenAt: Date.now(),
    });
    setDevice(ok ? "saved" : "unavailable");
  }, [draftRef]);

  /** Layer 2: the cloud. */
  const save = useCallback(async () => {
    const editor = editorRef.current;
    if (!editor || stateRef.current === "conflict") return;
    // Signed out on this device: the text stays here, nothing is sent (M9).
    if (isSignedOutHere()) return;
    if (timer.current) clearTimeout(timer.current);
    if (inFlight.current) {
      queued.current = true;
      return;
    }
    if (stateRef.current === "saved") return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      // Offline: the text is on this device; sync when the connection returns.
      update("waiting");
      return;
    }

    inFlight.current = true;
    update("saving");
    const seq = changeSeq.current;
    try {
      const result = await onSave(editor.getJSON() as Doc, versionRef.current);
      if (result.ok) {
        versionRef.current = result.data.version;
        setCloudVersion(result.data.version);
        setSavedAt(new Date(result.data.savedAt));
        notePlaceRef.current();
        if (changeSeq.current === seq) {
          update("saved");
          // The cloud has exactly this text: the device copy is no longer needed.
          if (localTimer.current) clearTimeout(localTimer.current);
          await deleteLocalDraft(draftRef);
          setDevice("idle");
        } else {
          update("dirty");
          void writeLocal(); // re-key the draft to the new cloud version
        }
      } else if (result.code === "CONFLICT") {
        update("conflict");
      } else {
        update("waiting");
        timer.current = setTimeout(() => void saveRef.current(), RETRY_DELAY_MS);
      }
    } catch {
      // Network or server failure: the text stays on this device; try again shortly.
      update("waiting");
      timer.current = setTimeout(() => void saveRef.current(), RETRY_DELAY_MS);
    } finally {
      inFlight.current = false;
    }
    if (queued.current) {
      queued.current = false;
      void saveRef.current();
    }
  }, [onSave, update, draftRef, writeLocal]);

  useEffect(() => {
    saveRef.current = save;
  }, [save]);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [2, 3] }, link: false }),
      Placeholder.configure({ placeholder }),
    ],
    content: content ?? "",
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: "manuscript",
        "aria-label": label,
        role: "textbox",
        "aria-multiline": "true",
        spellcheck: "true",
      },
    },
    onCreate: ({ editor }) => {
      editorRef.current = editor;
    },
    onUpdate: ({ editor }) => {
      changeSeq.current += 1;
      // Writing here makes this the work (lib/work-place.ts).
      const place = placeRef.current;
      if (place && placeReady.current && !edited.current) {
        edited.current = true;
        writeWork(place.owner, editWork(readWork(place.owner), place.entry));
      }
      if (stateRef.current !== "conflict" && stateRef.current !== "waiting") update("dirty");
      setWordCount(countWords(editor.getText({ blockSeparator: "\n\n" })));
      if (localTimer.current) clearTimeout(localTimer.current);
      localTimer.current = setTimeout(() => void writeLocal(), LOCAL_DELAY_MS);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void saveRef.current(), AUTOSAVE_DELAY_MS);
    },
    onSelectionUpdate: () => notePlaceRef.current(),
    onBlur: () => {
      // Leaving the text (e.g. to sign out): put unsaved text on this device
      // now rather than after the short delay, then save to the cloud.
      if (stateRef.current !== "saved") {
        if (localTimer.current) clearTimeout(localTimer.current);
        void writeLocal();
      }
      void saveRef.current();
    },
  });

  // ─── Work Context (M10) ───────────────────────────────────────────────────
  const capturePlace = useCallback((): PlaceAnchor | null => {
    if (!editor || editor.isDestroyed) return null;
    return captureAnchor(
      editor.state.doc,
      editor.state.selection.from,
      versionRef.current,
      Math.round(window.scrollY),
    );
  }, [editor]);

  /** Records the writing place on the server (never after signing out here). */
  const sendPlace = useCallback(() => {
    if (serverPlaceTimer.current) clearTimeout(serverPlaceTimer.current);
    serverPlaceTimer.current = null;
    const place = placeRef.current;
    const anchor = capturePlace();
    if (!place?.onPlace || !anchor || isSignedOutHere()) return;
    place.onPlace(anchor);
  }, [capturePlace]);

  useEffect(() => {
    notePlaceRef.current = () => {
      const place = placeRef.current;
      if (!place || !placeReady.current) return;
      if (placeTimer.current) clearTimeout(placeTimer.current);
      placeTimer.current = setTimeout(() => {
        const anchor = capturePlace();
        if (anchor) updateWorkAnchor(place.owner, place.entry.id, anchor);
      }, PLACE_DELAY_MS);
      if (place.onPlace) {
        if (serverPlaceTimer.current) clearTimeout(serverPlaceTimer.current);
        serverPlaceTimer.current = setTimeout(sendPlace, SERVER_PLACE_DELAY_MS);
      }
    };

    /**
     * Opening: this document is visited in the work stack, and if the author
     * came back through Return to Work or Continue Writing, their place is
     * restored when it can be found safely (never invented).
     */
    openPlaceRef.current = () => {
      const place = placeRef.current;
      if (!editor || !place) return;
      writeWork(place.owner, visitWork(readWork(place.owner), place.entry));
      placeReady.current = true;
      const restore = takeRestore(place.owner, place.entry.id);
      if (restore?.anchor) {
        const found = resolveAnchor(editor.state.doc, restore.anchor, versionRef.current);
        if (!found) {
          setPlaceLost("lost");
          window.scrollTo(0, 0);
        } else {
          if (found.how === "near") setPlaceLost("near");
          const { scrollY } = restore.anchor;
          editor.commands.setTextSelection(found.pos);
          editor.commands.focus(undefined, { scrollIntoView: false });
          requestAnimationFrame(() =>
            requestAnimationFrame(() => {
              // Same text at the same place on the same version: same scroll.
              if (found.how === "exact" && found.sameVersion && scrollY >= 0)
                window.scrollTo(0, scrollY);
              else editor.commands.scrollIntoView();
            }),
          );
        }
      }
      const anchor = capturePlace();
      if (anchor) updateWorkAnchor(place.owner, place.entry.id, anchor);
      sendPlace();
    };
  }, [editor, capturePlace, sendPlace]);

  // Scrolling moves the place too; leaving keeps the latest one.
  useEffect(() => {
    const onScroll = () => notePlaceRef.current();
    const place = placeRef.current;
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (placeTimer.current) clearTimeout(placeTimer.current);
      if (!place || !placeReady.current) return;
      try {
        const anchor = capturePlace();
        if (anchor) updateWorkAnchor(place.owner, place.entry.id, anchor);
        if (serverPlaceTimer.current) sendPlace();
      } catch {
        // The editor is already gone: the last recorded place stands.
      }
    };
  }, [capturePlace, sendPlace]);

  // On open: text from this device that never reached the cloud?
  useEffect(() => {
    if (!editor) return;
    let cancelled = false;
    const handleDraft = async () => {
      const draft = await readLocalDraft(draftRef);
      if (cancelled || !draft) return;
      const local = JSON.stringify(draft.content);
      if (local === JSON.stringify(editor.getJSON())) {
        await deleteLocalDraft(draftRef);
        return;
      }
      if (draft.baseVersion === versionRef.current) {
        // The cloud hasn't changed since: continue where the author left off.
        editor.commands.setContent(draft.content as Doc, { emitUpdate: false });
        changeSeq.current += 1;
        setWordCount(countWords(editor.getText({ blockSeparator: "\n\n" })));
        setDevice("saved");
        setRecovered({ kind: "restored", writtenAt: draft.writtenAt });
        update("dirty");
        void saveRef.current();
        return;
      }
      // The cloud changed elsewhere since: keep the device's text as a version.
      const kept = await onKeepDraft(draft.content as Doc, new Date(draft.writtenAt).toISOString());
      if (cancelled) return;
      if (kept.ok) {
        await deleteLocalDraft(draftRef);
        setRecovered({ kind: "kept", writtenAt: draft.writtenAt });
      } else {
        setRecovered({ kind: "failed", writtenAt: draft.writtenAt, content: draft.content as Doc });
      }
    };
    // The place is restored after any device text, so it is found in what is shown.
    void handleDraft().then(() => {
      if (!cancelled) openPlaceRef.current();
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, draftRef]);

  // Back online: sync what is waiting on this device.
  useEffect(() => {
    function online() {
      setOffline(false);
      if (stateRef.current === "waiting" || stateRef.current === "dirty") {
        update("dirty");
        void saveRef.current();
      }
    }
    function offlineNow() {
      setOffline(true);
    }
    window.addEventListener("online", online);
    window.addEventListener("offline", offlineNow);
    return () => {
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offlineNow);
    };
  }, [update]);

  // A newer version from the server (e.g. a restored revision): load it if the
  // author has nothing unsaved; otherwise it is a conflict.
  useEffect(() => {
    if (!editor || version <= versionRef.current) return;
    if (stateRef.current === "saved") {
      editor.commands.setContent(content ?? "", { emitUpdate: false });
      versionRef.current = version;
      setCloudVersion(version);
      setWordCount(initialWordCount ?? 0);
    } else {
      update("conflict");
    }
  }, [editor, version, content, initialWordCount, update]);

  // Ctrl/Cmd+S saves now; warn before leaving while the cloud doesn't have the text.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void writeLocal();
        void save();
      }
    }
    function onBeforeUnload(e: BeforeUnloadEvent) {
      // After signing out the text is on this device already: let the page go.
      if (stateRef.current !== "saved" && !isSignedOutHere()) e.preventDefault();
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [save, writeLocal]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      if (localTimer.current) clearTimeout(localTimer.current);
    },
    [],
  );

  return (
    <div className="space-y-3">
      <div className="sticky top-14 z-20 flex flex-wrap items-center justify-between gap-2 border-b border-border bg-background/95 py-2 backdrop-blur lg:top-0">
        {editor ? <Toolbar editor={editor} /> : <div className="h-8" />}
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          {initialWordCount !== undefined && (
            <span data-testid="word-count">{formatWords(wordCount)}</span>
          )}
          <SaveStatus state={state} device={device} offline={offline} savedAt={savedAt} />
          {editor && aside?.({ editor, version: cloudVersion, saved: state === "saved" })}
        </div>
      </div>

      {recovered && (
        <div
          role="status"
          data-testid="draft-recovery"
          className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-muted p-3 text-sm"
        >
          <span>
            {recovered.kind === "restored" &&
              `Restored text from this device (written ${formatTime(recovered.writtenAt)}) that hadn’t reached the cloud yet. Syncing it now.`}
            {recovered.kind === "kept" &&
              `This device had text from ${formatTime(recovered.writtenAt)} that never reached the cloud, but this ${thing} changed elsewhere since. It was kept as a saved version: open Version history to compare or restore it.`}
            {recovered.kind === "failed" &&
              `This device has text from ${formatTime(recovered.writtenAt)} that never reached the cloud, and this ${thing} changed elsewhere since. It is still on this device; reload when you’re online to keep it as a version.`}
          </span>
          <Button size="sm" variant="ghost" onClick={() => setRecovered(null)}>
            Dismiss
          </Button>
        </div>
      )}

      {placeLost && (
        <div
          role="status"
          data-testid="place-notice"
          className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-muted p-3 text-sm"
        >
          <span>
            {placeLost === "lost"
              ? `This ${thing} changed while you were away, so your exact place couldn’t be found. You’re at the start of the ${thing}.`
              : `This ${thing} changed while you were away, so this may not be exactly where you were. You’re at the nearest place that could be found.`}
          </span>
          <Button size="sm" variant="ghost" onClick={() => setPlaceLost(null)}>
            Dismiss
          </Button>
        </div>
      )}

      {state === "conflict" && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive-bg p-3 text-sm text-destructive"
        >
          <span>
            This {thing} was changed somewhere else (another tab or device), so your latest edits
            here were not saved to the cloud.
            {device === "saved"
              ? " They are kept on this device and will be saved as a version when you reload."
              : " Copy anything you need, then reload."}
          </span>
          <Button size="sm" variant="outline" onClick={() => window.location.reload()}>
            Reload {thing}
          </Button>
        </div>
      )}

      <EditorContent
        editor={editor}
        className="min-h-[60vh]"
        onClick={() => editor?.commands.focus()}
      />
      <span className="sr-only" aria-live="polite">
        {state === "waiting"
          ? device === "saved"
            ? "Saved on this device. Waiting to sync to the cloud."
            : "Not saved yet. Retrying."
          : ""}
      </span>
    </div>
  );
}

const formatTime = (ms: number) =>
  new Date(ms).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });

/**
 * The truth about where the text is. "Saved" means the cloud has it; text
 * only on this device says so.
 */
function SaveStatus({
  state,
  device,
  offline,
  savedAt,
}: {
  state: SaveState;
  device: DeviceState;
  offline: boolean;
  savedAt: Date | null;
}) {
  const onDevice = device === "saved";
  const text =
    state === "saved"
      ? savedAt
        ? `Saved to the cloud ${savedAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
        : "Saved"
      : state === "conflict"
        ? "Not saved to the cloud"
        : state === "waiting"
          ? onDevice
            ? offline
              ? "Saved on this device · offline, will sync"
              : "Saved on this device · retrying sync"
            : "Not saved · retrying"
          : onDevice
            ? "Saved on this device · syncing…"
            : state === "saving"
              ? "Saving…"
              : "Unsaved changes";
  const warn = state === "conflict" || (state === "waiting" && !onDevice);
  return (
    <span
      role="status"
      data-testid="save-status"
      data-state={state}
      data-device={device}
      className={cn(warn && "font-medium text-destructive", state === "saved" && "text-success")}
    >
      {text}
    </span>
  );
}

function Toolbar({ editor }: { editor: Editor }) {
  const active = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      heading: e.isActive("heading", { level: 2 }),
      quote: e.isActive("blockquote"),
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
    }),
  });

  const buttons: {
    label: string;
    icon: LucideIcon;
    pressed?: boolean;
    disabled?: boolean;
    run: () => void;
  }[] = [
    {
      label: "Bold",
      icon: Bold,
      pressed: active.bold,
      run: () => editor.chain().focus().toggleBold().run(),
    },
    {
      label: "Italic",
      icon: Italic,
      pressed: active.italic,
      run: () => editor.chain().focus().toggleItalic().run(),
    },
    {
      label: "Heading",
      icon: Heading2,
      pressed: active.heading,
      run: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
    },
    {
      label: "Quote",
      icon: Quote,
      pressed: active.quote,
      run: () => editor.chain().focus().toggleBlockquote().run(),
    },
    {
      label: "Scene break",
      icon: Minus,
      run: () => editor.chain().focus().setHorizontalRule().run(),
    },
    {
      label: "Undo",
      icon: Undo2,
      disabled: !active.canUndo,
      run: () => editor.chain().focus().undo().run(),
    },
    {
      label: "Redo",
      icon: Redo2,
      disabled: !active.canRedo,
      run: () => editor.chain().focus().redo().run(),
    },
  ];

  return (
    <div role="toolbar" aria-label="Formatting" className="flex flex-wrap items-center gap-0.5">
      {buttons.map(({ label, icon: Icon, pressed, disabled, run }) => (
        <button
          key={label}
          type="button"
          aria-label={label}
          title={label}
          aria-pressed={pressed}
          disabled={disabled}
          onClick={run}
          className={cn(
            "flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-surface-hover hover:text-foreground disabled:opacity-40",
            pressed && "bg-secondary text-primary",
          )}
        >
          <Icon className="size-4" aria-hidden />
        </button>
      ))}
    </div>
  );
}
