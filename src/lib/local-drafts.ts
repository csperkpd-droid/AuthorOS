/**
 * Local drafts (M8): the first safety layer for writing. Every change to a
 * rich-text document is stored on this device immediately (IndexedDB),
 * before cloud autosave; the draft is removed once the cloud has exactly
 * that text. So typing survives a lost connection, a crashed tab or a
 * closed laptop, and the editor can say truthfully where the text is:
 * "saved on this device" is never presented as "saved to the cloud".
 *
 * Browser-only, best effort: where storage is unavailable (private
 * browsing, disabled storage) the editor says so and relies on autosave.
 * This is also the seam for a future offline/local-first mode.
 */

export type LocalDraft = {
  /** e.g. "scene:<id>". */
  key: string;
  content: unknown;
  /** The cloud version this draft was written on. */
  baseVersion: number;
  /** When it was last written (ms since epoch). */
  writtenAt: number;
};

const DB_NAME = "authoros-drafts";
const STORE = "drafts";

let opening: Promise<IDBDatabase | null> | null = null;

function open(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  opening ??= new Promise((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, 1);
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
export async function saveLocalDraft(draft: LocalDraft): Promise<boolean> {
  const db = await open();
  if (!db) return false;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(draft);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
      tx.onabort = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

export async function readLocalDraft(key: string): Promise<LocalDraft | null> {
  return (await run<LocalDraft>("readonly", (s) => s.get(key))) ?? null;
}

export async function deleteLocalDraft(key: string): Promise<void> {
  await run("readwrite", (s) => s.delete(key));
}
