"use client";

import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import { Placeholder } from "@tiptap/extensions";
import StarterKit from "@tiptap/starter-kit";
import { Bold, Heading2, Italic, Minus, Quote, Redo2, Undo2, type LucideIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { formatWords } from "@/lib/format";
import { deleteLocalDraft, readLocalDraft, saveLocalDraft } from "@/lib/local-drafts";
import { countWords, type Doc } from "@/lib/text";
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
  draftKey,
  label,
  placeholder = "Start writing…",
  thing = "text",
}: {
  content: Doc | null;
  version: number;
  /** Omit to hide the live word count. */
  wordCount?: number;
  /** Persists the document if the stored version still equals `baseVersion`. */
  onSave: (doc: Doc, baseVersion: number) => Promise<SaveResult>;
  /** Keeps unsynced device text as a version when the cloud copy changed meanwhile. */
  onKeepDraft: (doc: Doc, writtenAt: string) => Promise<{ ok: boolean }>;
  /** Identifies this document's local draft, e.g. "scene:<id>". */
  draftKey: string;
  /** Accessible name of the text area, e.g. "Scene text". */
  label: string;
  placeholder?: string;
  /** What is being edited, for messages ("scene", "note"). */
  thing?: string;
}) {
  const versionRef = useRef(version);
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

  const update = useCallback((next: SaveState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  /** Layer 1: the latest text on this device. */
  const writeLocal = useCallback(async () => {
    const editor = editorRef.current;
    if (!editor) return;
    const ok = await saveLocalDraft({
      key: draftKey,
      content: editor.getJSON(),
      baseVersion: versionRef.current,
      writtenAt: Date.now(),
    });
    setDevice(ok ? "saved" : "unavailable");
  }, [draftKey]);

  /** Layer 2: the cloud. */
  const save = useCallback(async () => {
    const editor = editorRef.current;
    if (!editor || stateRef.current === "conflict") return;
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
        setSavedAt(new Date(result.data.savedAt));
        if (changeSeq.current === seq) {
          update("saved");
          // The cloud has exactly this text: the device copy is no longer needed.
          if (localTimer.current) clearTimeout(localTimer.current);
          await deleteLocalDraft(draftKey);
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
  }, [onSave, update, draftKey, writeLocal]);

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
      if (stateRef.current !== "conflict" && stateRef.current !== "waiting") update("dirty");
      setWordCount(countWords(editor.getText({ blockSeparator: "\n\n" })));
      if (localTimer.current) clearTimeout(localTimer.current);
      localTimer.current = setTimeout(() => void writeLocal(), LOCAL_DELAY_MS);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void saveRef.current(), AUTOSAVE_DELAY_MS);
    },
    onBlur: () => void saveRef.current(),
  });

  // On open: text from this device that never reached the cloud?
  useEffect(() => {
    if (!editor) return;
    let cancelled = false;
    void (async () => {
      const draft = await readLocalDraft(draftKey);
      if (cancelled || !draft) return;
      const local = JSON.stringify(draft.content);
      if (local === JSON.stringify(editor.getJSON())) {
        await deleteLocalDraft(draftKey);
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
        await deleteLocalDraft(draftKey);
        setRecovered({ kind: "kept", writtenAt: draft.writtenAt });
      } else {
        setRecovered({ kind: "failed", writtenAt: draft.writtenAt, content: draft.content as Doc });
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, draftKey]);

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
      if (stateRef.current !== "saved") e.preventDefault();
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
        </div>
      </div>

      {recovered && (
        <div
          role="status"
          data-testid="draft-recovery"
          className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-muted/50 p-3 text-sm"
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

      {state === "conflict" && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
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
      className={cn(warn && "font-medium text-destructive")}
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
            "flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40",
            pressed && "bg-primary/10 text-primary",
          )}
        >
          <Icon className="size-4" aria-hidden />
        </button>
      ))}
    </div>
  );
}
