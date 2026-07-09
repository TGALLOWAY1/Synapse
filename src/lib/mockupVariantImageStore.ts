// Phase 3B: IndexedDB persistence for per-variant mockup images + coverage
// manifests. Deliberately a SEPARATE object store from the legacy single-image
// mockup store (src/lib/mockupImageStore.ts) so:
//   - generating one variant (e.g. Mobile · Default) never touches another
//     (Desktop · Default), and
//   - the legacy default-variant rendering path is completely unaffected.
//
// Records are keyed by the composite `${versionId}:${screenId}:${variantId}:${quality}`.
// Because a variantId itself contains colons (`mobile:default`, `state:<slug>`),
// callers never PARSE the key — enumeration is done via the `versionId` index
// and structured record fields. Falls back to an in-memory Map when IndexedDB
// is unavailable (private browsing), matching mockupImageStore's behavior.

import type { MockupImageQuality, MockupVariantImageRecord } from '../types';

const DB_NAME = 'synapse-mockup-variant-images';
const DB_VERSION = 1;
const STORE_NAME = 'variant-images';
const VERSION_INDEX = 'versionId';

let dbPromise: Promise<IDBDatabase> | null = null;
const memoryFallback: Map<string, MockupVariantImageRecord> = new Map();
let memoryFallbackWarned = false;

const noteFallback = (reason: string) => {
    if (!memoryFallbackWarned) {
        memoryFallbackWarned = true;
        console.warn(`[mockup-variant-image-store] IndexedDB unavailable (${reason}); using in-memory fallback. Variant images will be lost on reload.`);
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

/** Composite primary key for a variant image record. */
export const buildVariantImageKey = (
    versionId: string,
    screenId: string,
    variantId: string,
    quality: MockupImageQuality,
): string => `${versionId}:${screenId}:${variantId}:${quality}`;

export const putVariantImage = async (record: MockupVariantImageRecord): Promise<void> => {
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

export const getVariantImage = async (key: string): Promise<MockupVariantImageRecord | undefined> => {
    try {
        const db = await openDb();
        return await new Promise<MockupVariantImageRecord | undefined>((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const req = tx.objectStore(STORE_NAME).get(key);
            req.onsuccess = () => resolve(req.result as MockupVariantImageRecord | undefined);
            req.onerror = () => reject(req.error ?? new Error('IDB get failed'));
        });
    } catch {
        return memoryFallback.get(key);
    }
};

export const listVariantImagesForVersion = async (
    versionId: string,
): Promise<MockupVariantImageRecord[]> => {
    try {
        const db = await openDb();
        return await new Promise<MockupVariantImageRecord[]>((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const idx = tx.objectStore(STORE_NAME).index(VERSION_INDEX);
            const req = idx.getAll(versionId);
            req.onsuccess = () => resolve((req.result as MockupVariantImageRecord[]) ?? []);
            req.onerror = () => reject(req.error ?? new Error('IDB index getAll failed'));
        });
    } catch {
        return Array.from(memoryFallback.values()).filter(r => r.versionId === versionId);
    }
};

export const deleteVariantImagesForVersion = async (versionId: string): Promise<void> => {
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
