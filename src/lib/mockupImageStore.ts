// IndexedDB wrapper for mockup AI images. Lives outside Zustand/localStorage
// because gpt-image-2 returns 1–3 MB base64 PNGs which would blow past the
// ~5 MB origin quota for localStorage. Records are looked up by the composite
// key `${versionId}:${screenId}:${quality}` so each quality (low / medium /
// high) is stored as a distinct record — regenerating at a higher quality
// preserves earlier renders so the user can still compare the original draft.
// `buildScreenScopeKey()` returns the version-screen prefix used by callers
// that need to enumerate every quality variant for one screen.
//
// Falls back to an in-memory Map if IndexedDB is unavailable (e.g. private
// browsing in some browsers). The session keeps working; images are lost on
// reload. We log a single warning so the regression is visible in DevTools.
//
// The open/upgrade/fallback skeleton is shared with
// `mockupVariantImageStore.ts` and `screenInventoryImageStore.ts` via
// `idbRecordStore.ts` — see that module for the shared mechanics.

import type { MockupImageQuality, MockupImageRecord } from '../types';
import { createRecordStore } from './idbRecordStore';

const store = createRecordStore<MockupImageRecord>({
    dbName: 'synapse-mockup-images',
    dbVersion: 1,
    storeName: 'images',
    keyPath: 'key',
    indexField: 'versionId',
    logLabel: 'mockup-image-store',
    lossNote: 'Images will be lost on reload.',
});

export const buildImageKey = (
    versionId: string,
    screenId: string,
    quality: MockupImageQuality,
): string => `${versionId}:${screenId}:${quality}`;

/** Prefix matching every quality variant for one (version, screen) pair. */
export const buildScreenScopeKey = (versionId: string, screenId: string): string =>
    `${versionId}:${screenId}:`;

export const putImage = (record: MockupImageRecord): Promise<void> => store.put(record);

export const getImage = (key: string): Promise<MockupImageRecord | undefined> => store.get(key);

export const listImagesForVersion = (versionId: string): Promise<MockupImageRecord[]> =>
    store.listByIndex(versionId);

export const deleteImagesForVersion = (versionId: string): Promise<void> =>
    store.deleteByIndex(versionId);
