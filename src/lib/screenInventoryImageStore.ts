// IndexedDB wrapper for user-uploaded screen-inventory images. Lives outside
// Zustand/localStorage because PNG/JPG data URLs would blow past the ~5 MB
// origin quota for localStorage. Records are looked up either by their
// composite primary key `${artifactVersionId}:${screenSlug}:${versionNumber}`
// or via the `artifactVersionId` index for hydration on artifact open.
//
// Mirrors the shape of `src/lib/mockupImageStore.ts` — same fallback story,
// same logging, just a different schema and store name so the two never
// collide.

import type { ScreenInventoryImageRecord } from '../types';

const DB_NAME = 'synapse-screen-inventory-images';
const DB_VERSION = 1;
const STORE_NAME = 'images';
const VERSION_INDEX = 'artifactVersionId';

let dbPromise: Promise<IDBDatabase> | null = null;
const memoryFallback: Map<string, ScreenInventoryImageRecord> = new Map();
let memoryFallbackWarned = false;

const noteFallback = (reason: string) => {
    if (!memoryFallbackWarned) {
        memoryFallbackWarned = true;
        console.warn(`[screen-inventory-image-store] IndexedDB unavailable (${reason}); using in-memory fallback. Uploads will be lost on reload.`);
    }
};

const openDb = (): Promise<IDBDatabase> => {
    if (dbPromise) return dbPromise;
    if (typeof indexedDB === 'undefined') {
        noteFallback('indexedDB undefined');
        return Promise.reject(new Error('IndexedDB unavailable'));
    }

    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                const store = db.createObjectStore(STORE_NAME, { keyPath: 'key' });
                store.createIndex(VERSION_INDEX, 'artifactVersionId', { unique: false });
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error('Failed to open IndexedDB'));
        req.onblocked = () => reject(new Error('IndexedDB open blocked'));
    }).catch((err) => {
        dbPromise = null;
        noteFallback(String(err?.message ?? err));
        throw err;
    });

    return dbPromise;
};

export const slugifyScreenName = (name: string): string =>
    name
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[^\w\s-]/g, '')
        .trim()
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-') || 'screen';

export const buildScreenImageKey = (
    artifactVersionId: string,
    screenSlug: string,
    versionNumber: number,
): string => `${artifactVersionId}:${screenSlug}:${versionNumber}`;

export const putScreenImage = async (record: ScreenInventoryImageRecord): Promise<void> => {
    try {
        const db = await openDb();
        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            tx.objectStore(STORE_NAME).put(record);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error ?? new Error('IDB put failed'));
            tx.onabort = () => reject(tx.error ?? new Error('IDB put aborted'));
        });
    } catch {
        memoryFallback.set(record.key, record);
    }
};

export const listScreenImagesForArtifactVersion = async (
    artifactVersionId: string,
): Promise<ScreenInventoryImageRecord[]> => {
    try {
        const db = await openDb();
        return await new Promise<ScreenInventoryImageRecord[]>((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const idx = tx.objectStore(STORE_NAME).index(VERSION_INDEX);
            const req = idx.getAll(artifactVersionId);
            req.onsuccess = () => resolve((req.result as ScreenInventoryImageRecord[]) ?? []);
            req.onerror = () => reject(req.error ?? new Error('IDB index getAll failed'));
        });
    } catch {
        return Array.from(memoryFallback.values()).filter(r => r.artifactVersionId === artifactVersionId);
    }
};

// Transactional preferred-flip: clears `isPreferred` on every record in the
// `(artifactVersionId, screenSlug)` bucket, then sets it on the target.
// Returns the updated set so callers can reflect it in their reactive cache
// without re-querying.
export const setPreferredScreenImage = async (
    artifactVersionId: string,
    screenSlug: string,
    targetVersionNumber: number,
): Promise<ScreenInventoryImageRecord[]> => {
    try {
        const db = await openDb();
        return await new Promise<ScreenInventoryImageRecord[]>((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            const idx = store.index(VERSION_INDEX);
            const updated: ScreenInventoryImageRecord[] = [];
            const cursorReq = idx.openCursor(IDBKeyRange.only(artifactVersionId));
            cursorReq.onsuccess = () => {
                const cursor = cursorReq.result;
                if (!cursor) return;
                const record = cursor.value as ScreenInventoryImageRecord;
                if (record.screenSlug === screenSlug) {
                    const next = { ...record, isPreferred: record.versionNumber === targetVersionNumber };
                    if (next.isPreferred !== record.isPreferred) {
                        cursor.update(next);
                    }
                    updated.push(next);
                }
                cursor.continue();
            };
            tx.oncomplete = () => resolve(updated);
            tx.onerror = () => reject(tx.error ?? new Error('IDB preferred flip failed'));
            tx.onabort = () => reject(tx.error ?? new Error('IDB preferred flip aborted'));
        });
    } catch {
        const updated: ScreenInventoryImageRecord[] = [];
        for (const [k, r] of memoryFallback.entries()) {
            if (r.artifactVersionId === artifactVersionId && r.screenSlug === screenSlug) {
                const next = { ...r, isPreferred: r.versionNumber === targetVersionNumber };
                memoryFallback.set(k, next);
                updated.push(next);
            }
        }
        return updated;
    }
};
