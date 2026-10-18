// IndexedDB wrapper for mockup AI images. Lives outside Zustand/localStorage
// because image models return 1–3 MB base64 PNGs which would blow past the
// ~5 MB origin quota for localStorage. Records are looked up by the composite
// key `${versionId}:${screenId}:${quality}` (+ `:gemini` for Nano Banana
// renders) so each quality (low / medium / high) and each image provider is
// stored as a distinct record — regenerating at a higher quality, or with the
// other model, preserves earlier renders so the user can still compare them.
// OpenAI keys keep the original three-segment shape, so records, sync refs and
// snapshots written before the second provider existed stay valid as-is.
// `buildScreenScopeKey()` returns the version-screen prefix used by callers
// that need to enumerate every render for one screen.
//
// Falls back to an in-memory Map if IndexedDB is unavailable (e.g. private
// browsing in some browsers). The session keeps working; images are lost on
// reload. We log a single warning so the regression is visible in DevTools.
//
// The open/upgrade/fallback skeleton is shared with
// `mockupVariantImageStore.ts` and `screenInventoryImageStore.ts` via
// `idbRecordStore.ts` — see that module for the shared mechanics.

import type { MockupImageProvider, MockupImageQuality, MockupImageRecord } from '../types';
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

const GEMINI_KEY_SUFFIX = ':gemini';

export const buildImageKey = (
    versionId: string,
    screenId: string,
    quality: MockupImageQuality,
    provider: MockupImageProvider = 'openai',
): string => `${versionId}:${screenId}:${quality}${provider === 'gemini' ? GEMINI_KEY_SUFFIX : ''}`;

/** The provider slot a key belongs to. Unambiguous: an OpenAI key always ends
 * in a quality segment, never in `gemini`. */
export const imageKeyProvider = (key: string): MockupImageProvider =>
    key.endsWith(GEMINI_KEY_SUFFIX) ? 'gemini' : 'openai';

const QUALITY_RANK: Record<MockupImageQuality, number> = { low: 0, medium: 1, high: 2 };

/**
 * The render to show for one screen: the user's selection while it still
 * exists, else the highest quality (the newest on a tie — e.g. a GPT Image 2
 * and a Nano Banana draft). Shared by the screen image, its page thumbnail and
 * its footer so all three show the same render.
 */
export const pickDisplayedMockupImage = (
    records: MockupImageRecord[],
    selectedKey?: string,
): MockupImageRecord | undefined => {
    if (selectedKey) {
        const selected = records.find((r) => r.key === selectedKey);
        if (selected) return selected;
    }
    let best: MockupImageRecord | undefined;
    for (const r of records) {
        if (!best) { best = r; continue; }
        const rank = QUALITY_RANK[r.quality] - QUALITY_RANK[best.quality];
        if (rank > 0 || (rank === 0 && r.generatedAt > best.generatedAt)) best = r;
    }
    return best;
};

/** Prefix matching every render (all qualities, both providers) for one (version, screen) pair. */
export const buildScreenScopeKey = (versionId: string, screenId: string): string =>
    `${versionId}:${screenId}:`;

export const putImage = (record: MockupImageRecord): Promise<void> => store.put(record);

export const getImage = (key: string): Promise<MockupImageRecord | undefined> => store.get(key);

export const listImagesForVersion = (versionId: string): Promise<MockupImageRecord[]> =>
    store.listByIndex(versionId);

export const deleteImagesForVersion = (versionId: string): Promise<void> =>
    store.deleteByIndex(versionId);
