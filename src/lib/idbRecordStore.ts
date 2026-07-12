// Shared IndexedDB record-store skeleton extracted from the near-identical
// `src/lib/mockupImageStore.ts`, `src/lib/mockupVariantImageStore.ts`, and
// `src/lib/screenInventoryImageStore.ts`. Each of those modules stores its own
// record type in its own database/object-store (never shared — different DB
// names keep them from colliding) but ran the exact same boilerplate: open +
// upgrade, dbPromise caching, an in-memory Map fallback (with a one-time
// console warning) when IndexedDB is unavailable, and get/put/list-by-index/
// delete-by-index operations built on that skeleton.
//
// `createRecordStore<T>()` is that shared skeleton. It is intentionally
// minimal — only the operations all three modules actually use. Anything
// store-specific (key builders, `slugifyScreenName`, the cursor-based
// `setPreferredScreenImage` conditional update) stays in its own module and
// is built on top of `iterateIndex`/`getMemoryFallback` rather than folded in
// here.

export interface RecordStoreConfig {
    /** IndexedDB database name (must stay byte-identical to keep loading existing user data). */
    dbName: string;
    /** IndexedDB database version. Defaults to 1. */
    dbVersion?: number;
    /** Object store name within the database. */
    storeName: string;
    /** Object store keyPath (all three current stores use `'key'`). */
    keyPath: string;
    /** Index name AND the record field it's built from — all three stores use the same string for both. */
    indexField: string;
    /** Prefix used in the in-memory-fallback console warning, e.g. `'mockup-image-store'`. */
    logLabel: string;
    /** Trailing sentence in the fallback warning, e.g. `'Images will be lost on reload.'` */
    lossNote: string;
}

export interface RecordStore<T extends { key: string }> {
    put(record: T): Promise<void>;
    get(key: string): Promise<T | undefined>;
    listByIndex(indexValue: string): Promise<T[]>;
    deleteByIndex(indexValue: string): Promise<void>;
    /**
     * Low-level escape hatch for bespoke cursor operations (e.g. a
     * conditional multi-record update) that don't fit the generic ops above.
     * Rejects (rather than falling back) on IDB failure — the caller is
     * expected to catch and implement its own in-memory-fallback behavior via
     * `getMemoryFallback()`, since the fallback logic for a bespoke op is
     * necessarily bespoke too.
     */
    iterateIndex(
        mode: IDBTransactionMode,
        indexValue: string,
        visit: (cursor: IDBCursorWithValue) => void,
    ): Promise<void>;
    /** Direct reference to the in-memory fallback map, keyed by `record.key`. */
    getMemoryFallback(): Map<string, T>;
}

export function createRecordStore<T extends { key: string }>(config: RecordStoreConfig): RecordStore<T> {
    const { dbName, dbVersion = 1, storeName, keyPath, indexField, logLabel, lossNote } = config;

    let dbPromise: Promise<IDBDatabase> | null = null;
    const memoryFallback = new Map<string, T>();
    let memoryFallbackWarned = false;

    const noteFallback = (reason: string) => {
        if (!memoryFallbackWarned) {
            memoryFallbackWarned = true;
            console.warn(`[${logLabel}] IndexedDB unavailable (${reason}); using in-memory fallback. ${lossNote}`);
        }
    };

    const matchesIndexValue = (record: T, indexValue: string): boolean =>
        (record as unknown as Record<string, unknown>)[indexField] === indexValue;

    const openDb = (): Promise<IDBDatabase> => {
        if (dbPromise) return dbPromise;
        if (typeof indexedDB === 'undefined') {
            noteFallback('indexedDB undefined');
            return Promise.reject(new Error('IndexedDB unavailable'));
        }

        dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
            const req = indexedDB.open(dbName, dbVersion);
            req.onupgradeneeded = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains(storeName)) {
                    const store = db.createObjectStore(storeName, { keyPath });
                    store.createIndex(indexField, indexField, { unique: false });
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

    const put = async (record: T): Promise<void> => {
        try {
            const db = await openDb();
            await new Promise<void>((resolve, reject) => {
                const tx = db.transaction(storeName, 'readwrite');
                tx.objectStore(storeName).put(record);
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error ?? new Error('IDB put failed'));
                tx.onabort = () => reject(tx.error ?? new Error('IDB put aborted'));
            });
        } catch {
            memoryFallback.set(record.key, record);
        }
    };

    const get = async (key: string): Promise<T | undefined> => {
        try {
            const db = await openDb();
            return await new Promise<T | undefined>((resolve, reject) => {
                const tx = db.transaction(storeName, 'readonly');
                const req = tx.objectStore(storeName).get(key);
                req.onsuccess = () => resolve(req.result as T | undefined);
                req.onerror = () => reject(req.error ?? new Error('IDB get failed'));
            });
        } catch {
            return memoryFallback.get(key);
        }
    };

    const listByIndex = async (indexValue: string): Promise<T[]> => {
        try {
            const db = await openDb();
            return await new Promise<T[]>((resolve, reject) => {
                const tx = db.transaction(storeName, 'readonly');
                const idx = tx.objectStore(storeName).index(indexField);
                const req = idx.getAll(indexValue);
                req.onsuccess = () => resolve((req.result as T[]) ?? []);
                req.onerror = () => reject(req.error ?? new Error('IDB index getAll failed'));
            });
        } catch {
            return Array.from(memoryFallback.values()).filter((r) => matchesIndexValue(r, indexValue));
        }
    };

    const iterateIndex = async (
        mode: IDBTransactionMode,
        indexValue: string,
        visit: (cursor: IDBCursorWithValue) => void,
    ): Promise<void> => {
        const db = await openDb();
        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction(storeName, mode);
            const idx = tx.objectStore(storeName).index(indexField);
            const req = idx.openCursor(IDBKeyRange.only(indexValue));
            req.onsuccess = () => {
                const cursor = req.result;
                if (cursor) {
                    visit(cursor);
                    cursor.continue();
                }
            };
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error ?? new Error('IDB cursor failed'));
            tx.onabort = () => reject(tx.error ?? new Error('IDB cursor aborted'));
        });
    };

    const deleteByIndex = async (indexValue: string): Promise<void> => {
        try {
            await iterateIndex('readwrite', indexValue, (cursor) => cursor.delete());
        } catch {
            for (const [k, r] of memoryFallback.entries()) {
                if (matchesIndexValue(r, indexValue)) memoryFallback.delete(k);
            }
        }
    };

    return {
        put,
        get,
        listByIndex,
        deleteByIndex,
        iterateIndex,
        getMemoryFallback: () => memoryFallback,
    };
}
