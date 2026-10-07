/**
 * Local drafts (M8): the first safety layer for writing. Every change to a
 * rich-text document is stored on this device immediately (IndexedDB),
 * before cloud autosave; the draft is removed once the cloud has exactly
 * that text. So typing survives a lost connection, a crashed tab or a
 * closed laptop, and the editor can say truthfully where the text is:
 * "saved on this device" is never presented as "saved to the cloud".
 *
 * Owned by one account (M9): every draft belongs to the signed-in member
 * (user and workspace) that wrote it, and is only ever read back for that
 * member. Signing out keeps unsynced drafts (never silently destroyed) but
 * another account signing in on the same browser never sees them; the
 * author is warned before signing out with unsynced writing.
 *
 * Browser-only, best effort: where storage is unavailable (private
 * browsing, disabled storage) the editor says so and relies on autosave.
 * This is also the seam for a future offline/local-first mode (a permanent
 * safety layer: DECISIONS 101).
 */

/** Which document, for whom, and how to name and reopen it in a warning. */
export type DraftRef = {
  /** The member it belongs to: `draftOwner(ctx)`. */
  owner: string;
  /** The document, e.g. "scene:<id>". */
  item: string;
  /** What the author calls it ("Scene 3 · Harbour Lights"). */
  label: string;
  /** Where to open it so it syncs. */
  href: string;
};

export type LocalDraft = {
  /** Storage key: `<owner>|<item>` (drafts from before M9: just `<item>`). */
  key: string;
  owner?: string;
  item?: string;
  label?: string;
  href?: string;
  content: unknown;
  /** The cloud version this draft was written on. */
  baseVersion: number;
  /** When it was last written (ms since epoch). */
  writtenAt: number;
};

/** The owner of drafts written by this member: user and workspace. */
export function draftOwner(ctx: { userId: string; workspaceId: string }) {
  return `${ctx.userId}:${ctx.workspaceId}`;
}

const storageKey = (ref: Pick<DraftRef, "owner" | "item">) => `${ref.owner}|${ref.item}`;

/** Compatibility identifier: unsynced writing on authors' devices lives here. Never rename. */
export const DRAFTS_DB_NAME = "authoros-drafts";
const STORE = "drafts";

let opening: Promise<IDBDatabase | null> | null = null;

function open(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  opening ??= new Promise((resolve) => {
    try {
      const request = indexedDB.open(DRAFTS_DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "key" });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return opening;
}

function run<T>(mode: IDBTransactionMode, act: (store: IDBObjectStore) => IDBRequest<T>) {
  return open().then(
    (db) =>
      new Promise<T | null>((resolve) => {
        if (!db) return resolve(null);
        try {
          const tx = db.transaction(STORE, mode);
          const request = act(tx.objectStore(STORE));
          tx.oncomplete = () => resolve(request.result ?? null);
          tx.onerror = () => resolve(null);
          tx.onabort = () => resolve(null);
        } catch {
          resolve(null);
        }
      }),
  );
}

/** Whether this browser can keep drafts (resolves false in private modes without storage). */
export async function localDraftsAvailable(): Promise<boolean> {
  return (await open()) !== null;
}

/** Stores a draft; resolves true once it is durably written on this device. */
export async function saveLocalDraft(
  ref: DraftRef,
  draft: Pick<LocalDraft, "content" | "baseVersion" | "writtenAt">,
): Promise<boolean> {
  const db = await open();
  if (!db) return false;
  const record: LocalDraft = { key: storageKey(ref), ...ref, ...draft };
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(record);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
      tx.onabort = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

/**
 * This member's draft of a document. A draft saved before drafts had owners
 * (key = the item alone) is adopted by the member opening the document: the
 * editor only calls this for a document the server let this member open, so
 * nobody else can claim it.
 */
export async function readLocalDraft(ref: DraftRef): Promise<LocalDraft | null> {
  const owned = await run<LocalDraft>("readonly", (s) => s.get(storageKey(ref)));
  if (owned) return owned;
  const legacy = await run<LocalDraft>("readonly", (s) => s.get(ref.item));
  if (!legacy || legacy.owner) return null;
  const { content, baseVersion, writtenAt } = legacy;
  if (!(await saveLocalDraft(ref, { content, baseVersion, writtenAt }))) return null;
  await run("readwrite", (s) => s.delete(ref.item));
  return { key: storageKey(ref), ...ref, content, baseVersion, writtenAt };
}

export async function deleteLocalDraft(ref: Pick<DraftRef, "owner" | "item">): Promise<void> {
  await run("readwrite", (s) => s.delete(storageKey(ref)));
}

/** This member's drafts that haven't reached the cloud, newest first. */
export async function listLocalDrafts(owner: string): Promise<LocalDraft[]> {
  const all = (await run<LocalDraft[]>("readonly", (s) => s.getAll())) ?? [];
  return all.filter((d) => d.owner === owner).sort((a, b) => b.writtenAt - a.writtenAt);
}
