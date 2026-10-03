"use client";

import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import { Placeholder } from "@tiptap/extensions";
import StarterKit from "@tiptap/starter-kit";
import { Bold, Heading2, Italic, Minus, Quote, Redo2, Undo2, type LucideIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { formatWords } from "@/lib/format";
import { countWords, type Doc } from "@/lib/text";
import { cn } from "@/lib/utils";

type SaveState = "saved" | "dirty" | "saving" | "error" | "conflict";

const AUTOSAVE_DELAY_MS = 1000;
const RETRY_DELAY_MS = 5000;

export type SaveResult =
  | { ok: true; data: { version: number; savedAt: Date | string } }
  | { ok: false; error: string; code?: string };

/**
 * Rich text editing with autosave, shared by scenes and notes. Saves shortly
 * after typing stops; never overwrites changes made elsewhere (the server
 * rejects stale versions with a CONFLICT and the editor asks the author to
 * reload instead).
 */
export function RichTextEditor({
  content,
  version,
  wordCount: initialWordCount,
  onSave,
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
  /** Accessible name of the text area, e.g. "Scene text". */
  label: string;
  placeholder?: string;
  /** What is being edited, for messages ("scene", "note"). */
  thing?: string;
}) {
  const versionRef = useRef(version);
  const [state, setState] = useState<SaveState>("saved");
  const stateRef = useRef<SaveState>("saved");
  const [wordCount, setWordCount] = useState(initialWordCount ?? 0);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
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

  const save = useCallback(async () => {
    const editor = editorRef.current;
    if (!editor || stateRef.current === "conflict") return;
    if (timer.current) clearTimeout(timer.current);
    if (inFlight.current) {
      queued.current = true;
      return;
    }
    if (stateRef.current === "saved") return;

    inFlight.current = true;
    update("saving");
    const seq = changeSeq.current;
    try {
      const result = await onSave(editor.getJSON() as Doc, versionRef.current);
      if (result.ok) {
        versionRef.current = result.data.version;
        setSavedAt(new Date(result.data.savedAt));
        update(changeSeq.current === seq ? "saved" : "dirty");
      } else if (result.code === "CONFLICT") {
        update("conflict");
      } else {
        update("error");
        timer.current = setTimeout(() => void saveRef.current(), RETRY_DELAY_MS);
      }
    } catch {
      // Network or server failure: keep the text, try again shortly.
      update("error");
      timer.current = setTimeout(() => void saveRef.current(), RETRY_DELAY_MS);
    } finally {
      inFlight.current = false;
    }
    if (queued.current) {
      queued.current = false;
      void saveRef.current();
    }
  }, [onSave, update]);

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
      if (stateRef.current !== "conflict") update("dirty");
      setWordCount(countWords(editor.getText({ blockSeparator: "\n\n" })));
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void saveRef.current(), AUTOSAVE_DELAY_MS);
    },
    onBlur: () => void saveRef.current(),
  });

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

  // Ctrl/Cmd+S saves now; warn before leaving with unsaved text.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
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
  }, [save]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
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
          <SaveStatus state={state} savedAt={savedAt} />
        </div>
      </div>

      {state === "conflict" && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
        >
          <span>
            This {thing} was changed somewhere else (another tab or device), so your latest edits
            here were not saved. Copy anything you need, then reload.
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
        {state === "error" ? "Saving failed. Retrying." : ""}
      </span>
    </div>
  );
}

function SaveStatus({ state, savedAt }: { state: SaveState; savedAt: Date | null }) {
  const text = {
    saved: savedAt
      ? `Saved ${savedAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
      : "Saved",
    dirty: "Unsaved changes",
    saving: "Saving…",
    error: "Couldn’t save. Retrying…",
    conflict: "Not saved",
  }[state];
  return (
    <span
      role="status"
      data-testid="save-status"
      data-state={state}
      className={cn((state === "error" || state === "conflict") && "font-medium text-destructive")}
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
