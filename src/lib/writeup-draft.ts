// Local draft persistence for in-progress write-ups.
//
// Field managers may start a write-up on-site (poor signal), close the app, and
// finish later. Structure (units/work/materials/notes) + photo blobs are saved
// to IndexedDB so nothing is lost to a crash, an accidental close, or the OS
// killing a backgrounded tab. Photos are uploaded only at Submit.
//
// All calls are best-effort: if IndexedDB is unavailable, they no-op so the
// write-up flow still works (just without draft recovery).

import { WriteUpLineItem, SpecChange, WriteUpMaterialItem } from "./types";

const DB_NAME = "rba-writeups";
const DB_VERSION = 1;
const DRAFT_STORE = "drafts";
const PHOTO_STORE = "photos";

/** A photo reference in a draft; the blob is stored separately in PHOTO_STORE. */
export interface DraftPhoto {
  id: string;
  name: string;
}

/** One unit block in a draft. Work-to-complete is shared (on the draft). */
export interface DraftBlock {
  id: string;
  isNewProduct: boolean;
  unitLabel: string;
  unitType: string;
  /** Spec entries stored as before/after changes; rehydrated on resume. */
  specChanges: SpecChange[];
  materialItems: WriteUpMaterialItem[];
  notes: string;
  photos: DraftPhoto[];
}

export interface WriteUpDraft {
  orderNumber: string;
  updatedAt: string;
  /** Work-to-complete shared across all blocks. */
  sharedWork: WriteUpLineItem[];
  blocks: DraftBlock[];
}

function openDB(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === "undefined") return resolve(null);
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(DRAFT_STORE))
          db.createObjectStore(DRAFT_STORE, { keyPath: "orderNumber" });
        if (!db.objectStoreNames.contains(PHOTO_STORE))
          db.createObjectStore(PHOTO_STORE, { keyPath: "id" });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function tx<T>(
  db: IDBDatabase,
  store: string,
  mode: IDBTransactionMode,
  run: (s: IDBObjectStore) => IDBRequest
): Promise<T | null> {
  return new Promise((resolve) => {
    try {
      const t = db.transaction(store, mode);
      const req = run(t.objectStore(store));
      req.onsuccess = () => resolve(req.result as T);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

// ─── Photo blobs ─────────────────────────────────────────────────────────────

export async function putDraftPhoto(id: string, blob: Blob): Promise<void> {
  const db = await openDB();
  if (!db) return;
  await tx(db, PHOTO_STORE, "readwrite", (s) => s.put({ id, blob }));
  db.close();
}

export async function getDraftPhoto(id: string): Promise<Blob | null> {
  const db = await openDB();
  if (!db) return null;
  const rec = await tx<{ id: string; blob: Blob }>(db, PHOTO_STORE, "readonly", (s) => s.get(id));
  db.close();
  return rec?.blob || null;
}

export async function deleteDraftPhoto(id: string): Promise<void> {
  const db = await openDB();
  if (!db) return;
  await tx(db, PHOTO_STORE, "readwrite", (s) => s.delete(id));
  db.close();
}

// ─── Draft record ─────────────────────────────────────────────────────────────

export async function saveDraft(draft: WriteUpDraft): Promise<void> {
  const db = await openDB();
  if (!db) return;
  await tx(db, DRAFT_STORE, "readwrite", (s) => s.put(draft));
  db.close();
}

export async function loadDraft(orderNumber: string): Promise<WriteUpDraft | null> {
  const db = await openDB();
  if (!db) return null;
  const draft = await tx<WriteUpDraft>(db, DRAFT_STORE, "readonly", (s) => s.get(orderNumber));
  db.close();
  return draft || null;
}

/** Delete a draft and every photo blob it referenced. */
export async function clearDraft(orderNumber: string): Promise<void> {
  const draft = await loadDraft(orderNumber);
  if (draft) {
    const ids = (draft.blocks || []).flatMap((b) => b.photos.map((p) => p.id));
    for (const id of ids) await deleteDraftPhoto(id);
  }
  const db = await openDB();
  if (!db) return;
  await tx(db, DRAFT_STORE, "readwrite", (s) => s.delete(orderNumber));
  db.close();
}
