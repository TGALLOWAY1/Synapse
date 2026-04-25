// IndexedDB wrapper for mockup AI images. Lives outside Zustand/localStorage
// because gpt-image-2 returns 1–3 MB base64 PNGs which would blow past the
// ~5 MB origin quota for localStorage. Records are looked up by the composite
// key `${versionId}:${screenId}`.
//
// Falls back to an in-memory Map if IndexedDB is unavailable (e.g. private
// browsing in some browsers). The session keeps working; images are lost on
// reload. We log a single warning so the regression is visible in DevTools.

import type { MockupImageRecord } from '../types';

const DB_NAME = 'synapse-mockup-images';
const DB_VERSION = 1;
const STORE_NAME = 'images';
const VERSION_INDEX = 'versionId';

let dbPromise: Promise<IDBDatabase> | null = null;
const memoryFallback: Map<string, MockupImageRecord> = new Map();
let memoryFallbackWarned = false;

const noteFallback = (reason: string) => {
    if (!memoryFallbackWarned) {
        memoryFallbackWarned = true;
        console.warn(`[mockup-image-store] IndexedDB unavailable (${reason}); using in-memory fallback. Images will be lost on reload.`);
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
                store.createIndex(VERSION_INDEX, 'versionId', { unique: false });
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

export const buildImageKey = (versionId: string, screenId: string): string =>
    `${versionId}:${screenId}`;

export const putImage = async (record: MockupImageRecord): Promise<void> => {
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

export const getImage = async (key: string): Promise<MockupImageRecord | undefined> => {
    try {
        const db = await openDb();
        return await new Promise<MockupImageRecord | undefined>((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const req = tx.objectStore(STORE_NAME).get(key);
            req.onsuccess = () => resolve(req.result as MockupImageRecord | undefined);
            req.onerror = () => reject(req.error ?? new Error('IDB get failed'));
        });
    } catch {
        return memoryFallback.get(key);
    }
};

export const listImagesForVersion = async (versionId: string): Promise<MockupImageRecord[]> => {
    try {
        const db = await openDb();
        return await new Promise<MockupImageRecord[]>((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const idx = tx.objectStore(STORE_NAME).index(VERSION_INDEX);
            const req = idx.getAll(versionId);
            req.onsuccess = () => resolve((req.result as MockupImageRecord[]) ?? []);
            req.onerror = () => reject(req.error ?? new Error('IDB index getAll failed'));
        });
    } catch {
        return Array.from(memoryFallback.values()).filter(r => r.versionId === versionId);
    }
};

export const deleteImagesForVersion = async (versionId: string): Promise<void> => {
    try {
        const db = await openDb();
        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            const idx = tx.objectStore(STORE_NAME).index(VERSION_INDEX);
            const req = idx.openCursor(IDBKeyRange.only(versionId));
            req.onsuccess = () => {
                const cursor = req.result;
                if (cursor) {
                    cursor.delete();
                    cursor.continue();
                }
            };
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error ?? new Error('IDB delete failed'));
        });
    } catch {
        for (const [k, r] of memoryFallback.entries()) {
            if (r.versionId === versionId) memoryFallback.delete(k);
        }
    }
};
