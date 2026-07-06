// IndexedDB persistence for LLM traces. Lives outside Zustand/localStorage
// because a single trace carries full prompts + raw responses (tens of KB
// each), which would blow the ~5 MB localStorage quota. Traces are a
// developer-only debugging artifact, so it is fine for this store to consume
// disk while capture is enabled; it is capped and prunable.
//
// Falls back to an in-memory Map when IndexedDB is unavailable (private
// browsing). The session keeps working; traces are lost on reload.

import type { LlmTraceCall } from './traceTypes';

const DB_NAME = 'synapse-llm-traces';
const DB_VERSION = 1;
const STORE_NAME = 'traces';
const CREATED_INDEX = 'createdAt';

// Keep persisted history bounded. Newest traces are kept on prune.
export const TRACE_STORE_CAP = 1000;

let dbPromise: Promise<IDBDatabase> | null = null;
const memoryFallback: Map<string, LlmTraceCall> = new Map();
let memoryFallbackWarned = false;

const noteFallback = (reason: string) => {
    if (!memoryFallbackWarned) {
        memoryFallbackWarned = true;
        console.warn(`[llm-trace-store] IndexedDB unavailable (${reason}); using in-memory fallback. Traces will be lost on reload.`);
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
                const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
                store.createIndex(CREATED_INDEX, 'createdAt', { unique: false });
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error('Failed to open IndexedDB'));
        req.onblocked = () => reject(new Error('IndexedDB open blocked'));
    }).catch((err) => {
        dbPromise = null;
        noteFallback(String((err as Error)?.message ?? err));
        throw err;
    });

    return dbPromise;
};

export const putTrace = async (trace: LlmTraceCall): Promise<void> => {
    try {
        const db = await openDb();
        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            tx.objectStore(STORE_NAME).put(trace);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error ?? new Error('IDB put failed'));
            tx.onabort = () => reject(tx.error ?? new Error('IDB put aborted'));
        });
    } catch {
        memoryFallback.set(trace.id, trace);
    }
};

export const getAllTraces = async (): Promise<LlmTraceCall[]> => {
    try {
        const db = await openDb();
        return await new Promise<LlmTraceCall[]>((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const req = tx.objectStore(STORE_NAME).getAll();
            req.onsuccess = () => resolve((req.result as LlmTraceCall[]) ?? []);
            req.onerror = () => reject(req.error ?? new Error('IDB getAll failed'));
        });
    } catch {
        return Array.from(memoryFallback.values());
    }
};

export const clearTraces = async (): Promise<void> => {
    memoryFallback.clear();
    try {
        const db = await openDb();
        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            tx.objectStore(STORE_NAME).clear();
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error ?? new Error('IDB clear failed'));
        });
    } catch {
        // memory already cleared
    }
};

/** Delete all but the newest `cap` traces (by createdAt). Best-effort. */
export const pruneTraces = async (cap: number = TRACE_STORE_CAP): Promise<void> => {
    try {
        const db = await openDb();
        const all = await getAllTraces();
        if (all.length <= cap) return;
        const toDelete = all
            .sort((a, b) => a.createdAt - b.createdAt)
            .slice(0, all.length - cap)
            .map((t) => t.id);
        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            for (const id of toDelete) store.delete(id);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error ?? new Error('IDB prune failed'));
        });
    } catch {
        // fallback map is naturally bounded by the recorder's in-memory cap
    }
};
