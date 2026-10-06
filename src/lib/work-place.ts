import type { Node as PMNode } from "@tiptap/pm/model";

/**
 * Work Context (M10): where the author is working, so detours never lose
 * their place. Three distinct behaviours (docs/ARCHITECTURE.md → Work
 * Context):
 *
 * - **Back** is the browser's history. Nothing here.
 * - **Return to Work** goes back to the place being worked on before the
 *   current detour. Kept per browser tab (sessionStorage, owned by one
 *   account): it survives navigation and refresh, not sign-out.
 * - **Continue Writing** resumes the latest manuscript writing place, on any
 *   device (stored on the server, `work-context` module).
 *
 * Positions are version-aware: an anchor records the document version, the
 * cursor position and the text either side of it. Restoring checks that
 * text; if the document changed, the text is looked for; if it can't be
 * found exactly once, no position is invented.
 */

/** A place in a document. */
export type PlaceAnchor = {
  /** The document version it was taken on. */
  version: number;
  /** Cursor position (ProseMirror). */
  pos: number;
  /** Up to 40 characters before and after the cursor. */
  before: string;
  after: string;
  /** Page scroll on the device it was taken on. */
  scrollY: number;
};

/** A document being worked on. */
export type WorkEntry = {
  kind: "scene" | "note";
  id: string;
  href: string;
  anchor?: PlaceAnchor;
};

const CONTEXT = 40;

// ─── Positions ──────────────────────────────────────────────────────────────

/**
 * The document's text with one "\n" between blocks, and for each character
 * the position it sits at (a separator maps to the end of the block before
 * it, so a cursor at the end of a paragraph stays there).
 */
export function flattenDoc(doc: PMNode) {
  let text = "";
  const posAt: number[] = [];
  let prevEnd: number | null = null;
  doc.descendants((node, pos) => {
    if (node.isTextblock) {
      if (prevEnd !== null) {
        text += "\n";
        posAt.push(prevEnd);
      }
      prevEnd = pos + node.nodeSize - 1;
      return true;
    }
    if (node.isText) {
      const t = node.text ?? "";
      for (let i = 0; i < t.length; i++) {
        text += t[i];
        posAt.push(pos + i);
      }
      return false;
    }
    return true;
  });
  return { text, posAt, end: prevEnd ?? 1 };
}

/** Index in the flattened text of the first character at or after `pos`. */
function indexAt(posAt: number[], pos: number) {
  const i = posAt.findIndex((p) => p >= pos);
  return i === -1 ? posAt.length : i;
}

function posFor(flat: ReturnType<typeof flattenDoc>, index: number) {
  return index < flat.posAt.length ? flat.posAt[index] : flat.end;
}

export function captureAnchor(
  doc: PMNode,
  pos: number,
  version: number,
  scrollY: number,
): PlaceAnchor {
  const flat = flattenDoc(doc);
  const i = indexAt(flat.posAt, pos);
  return {
    version,
    pos,
    before: flat.text.slice(Math.max(0, i - CONTEXT), i),
    after: flat.text.slice(i, i + CONTEXT),
    scrollY,
  };
}

function onlyMatch(text: string, needle: string) {
  const first = text.indexOf(needle);
  if (first === -1 || text.indexOf(needle, first + 1) !== -1) return -1;
  return first;
}

/**
 * Where an anchor is now. `exact`: the same text is still around the same
 * position (and, with an unchanged version, the same scroll applies);
 * `moved`: the text on both sides was found exactly once elsewhere; `near`:
 * only one side was found (the author is told it may not be exactly where
 * they were); `null`: it can't be found safely, and no position is invented.
 */
export function resolveAnchor(
  doc: PMNode,
  anchor: PlaceAnchor,
  version: number,
): { pos: number; how: "exact" | "moved" | "near"; sameVersion: boolean } | null {
  const flat = flattenDoc(doc);
  const sameVersion = anchor.version === version;
  const at = indexAt(flat.posAt, anchor.pos);
  const before = flat.text.slice(Math.max(0, at - anchor.before.length), at);
  const after = flat.text.slice(at, at + anchor.after.length);
  if (anchor.pos <= flat.end && before === anchor.before && after === anchor.after) {
    return { pos: anchor.pos, how: "exact", sameVersion };
  }
  const both = anchor.before + anchor.after;
  if (both.length >= 12) {
    const i = onlyMatch(flat.text, both);
    if (i !== -1)
      return { pos: posFor(flat, i + anchor.before.length), how: "moved", sameVersion: false };
  }
  if (anchor.before.length >= 12) {
    const i = onlyMatch(flat.text, anchor.before);
    if (i !== -1)
      return { pos: posFor(flat, i + anchor.before.length), how: "near", sameVersion: false };
  }
  if (anchor.after.length >= 12) {
    const i = onlyMatch(flat.text, anchor.after);
    if (i !== -1) return { pos: posFor(flat, i), how: "near", sameVersion: false };
  }
  return null;
}

// ─── Return to Work: the work stack ─────────────────────────────────────────

/**
 * Opening a document. If it is in the stack, the author returned to it: the
 * detours above it are finished. With nothing in the stack, it becomes the
 * work. Otherwise it is only being looked at (a detour), not yet work.
 */
export function visitWork(stack: WorkEntry[], entry: WorkEntry): WorkEntry[] {
  const i = stack.findIndex((e) => e.id === entry.id);
  if (i !== -1) return stack.slice(0, i + 1);
  return stack.length === 0 ? [entry] : stack;
}

/**
 * Writing in a document. Writing in a scene makes it the work (moving on in
 * the manuscript is not a detour). Writing in a note while away from the
 * work nests it: Return to Work goes back to the note, and from the note to
 * the work before it.
 */
export function editWork(stack: WorkEntry[], entry: WorkEntry): WorkEntry[] {
  const i = stack.findIndex((e) => e.id === entry.id);
  if (i !== -1) return stack.slice(0, i + 1);
  if (entry.kind === "scene" || stack.length === 0) return [entry];
  return [...stack, entry];
}

/** Where Return to Work goes from `path`: the work, or (when on it) the work before it. */
export function returnTarget(stack: WorkEntry[], path: string): WorkEntry | null {
  const top = stack.at(-1);
  if (!top) return null;
  if (path !== top.href) return top;
  return stack.at(-2) ?? null;
}

// ─── Storage (per tab, per account) ─────────────────────────────────────────

const STACK_KEY = (owner: string) => `authoros:work:${owner}`;
const RESTORE_KEY = (owner: string) => `authoros:work-restore:${owner}`;
export const WORK_CHANGED = "authoros:work-changed";

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

export function readWork(owner: string): WorkEntry[] {
  try {
    const raw = storage()?.getItem(STACK_KEY(owner));
    const stack = raw ? (JSON.parse(raw) as WorkEntry[]) : [];
    return Array.isArray(stack) ? stack : [];
  } catch {
    return [];
  }
}

export function writeWork(owner: string, stack: WorkEntry[]) {
  try {
    storage()?.setItem(STACK_KEY(owner), JSON.stringify(stack));
    window.dispatchEvent(new Event(WORK_CHANGED));
  } catch {
    // Storage unavailable: Return to Work just isn't offered.
  }
}

/** For React's useSyncExternalStore: the stack as stored (a stable string). */
export function workSnapshot(owner: string): string {
  try {
    return storage()?.getItem(STACK_KEY(owner)) ?? "[]";
  } catch {
    return "[]";
  }
}

export function subscribeWork(onChange: () => void) {
  window.addEventListener(WORK_CHANGED, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(WORK_CHANGED, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** Records the current place in a document of the stack (no-op if it isn't in it). */
export function updateWorkAnchor(owner: string, id: string, anchor: PlaceAnchor) {
  const stack = readWork(owner);
  if (!stack.some((e) => e.id === id)) return;
  const next = stack.map((e) => (e.id === id ? { ...e, anchor } : e));
  try {
    storage()?.setItem(STACK_KEY(owner), JSON.stringify(next));
  } catch {
    // Storage unavailable.
  }
}

/** Asks the document's editor, when it opens next, to put the author back at `anchor`. */
export function requestRestore(owner: string, id: string, anchor: PlaceAnchor | null) {
  try {
    storage()?.setItem(RESTORE_KEY(owner), JSON.stringify({ id, anchor }));
  } catch {
    // Storage unavailable: the document opens at the start.
  }
}

/** The pending restore for this document, if any (read once). */
export function takeRestore(owner: string, id: string): { anchor: PlaceAnchor | null } | null {
  try {
    const s = storage();
    const raw = s?.getItem(RESTORE_KEY(owner));
    if (!raw) return null;
    const request = JSON.parse(raw) as { id: string; anchor: PlaceAnchor | null };
    if (request.id !== id) return null;
    s?.removeItem(RESTORE_KEY(owner));
    return { anchor: request.anchor };
  } catch {
    return null;
  }
}

/** Forgets all work context in this tab (signing out). */
export function clearWork() {
  try {
    const s = storage();
    if (!s) return;
    for (const key of Object.keys(s)) if (key.startsWith("authoros:work")) s.removeItem(key);
  } catch {
    // Storage unavailable.
  }
}
