// IndexedDB wrapper for user-uploaded screen-inventory images. Lives outside
// Zustand/localStorage because PNG/JPG data URLs would blow past the ~5 MB
// origin quota for localStorage. Records are looked up either by their
// composite primary key `${artifactVersionId}:${screenSlug}:${versionNumber}`
// or via the `artifactVersionId` index for hydration on artifact open.
//
// Mirrors the shape of `src/lib/mockupImageStore.ts` — same fallback story,
// same logging, just a different schema and store name so the two never
// collide. The open/upgrade/fallback skeleton itself is shared with
// `mockupImageStore.ts` and `mockupVariantImageStore.ts` via
// `idbRecordStore.ts`; `setPreferredScreenImage` below is the one operation
// that isn't shared (a conditional multi-record update), built on top of the
// factory's `iterateIndex`/`getMemoryFallback` escape hatch.

import type { ScreenInventoryImageRecord } from '../types';
import { createRecordStore } from './idbRecordStore';

const store = createRecordStore<ScreenInventoryImageRecord>({
    dbName: 'synapse-screen-inventory-images',
    dbVersion: 1,
    storeName: 'images',
    keyPath: 'key',
    indexField: 'artifactVersionId',
    logLabel: 'screen-inventory-image-store',
    lossNote: 'Uploads will be lost on reload.',
});

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

export const putScreenImage = (record: ScreenInventoryImageRecord): Promise<void> => store.put(record);

export const listScreenImagesForArtifactVersion = (
    artifactVersionId: string,
): Promise<ScreenInventoryImageRecord[]> => store.listByIndex(artifactVersionId);

// Delete every record for one artifact version. Mirrors
// `mockupImageStore.deleteImagesForVersion`; used by the snapshot restore path
// to clear a version's stale screen-inventory images before repopulating them.
export const deleteScreenImagesForArtifactVersion = (
    artifactVersionId: string,
): Promise<void> => store.deleteByIndex(artifactVersionId);

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
        const updated: ScreenInventoryImageRecord[] = [];
        await store.iterateIndex('readwrite', artifactVersionId, (cursor) => {
            const record = cursor.value as ScreenInventoryImageRecord;
            if (record.screenSlug === screenSlug) {
                const next = { ...record, isPreferred: record.versionNumber === targetVersionNumber };
                if (next.isPreferred !== record.isPreferred) {
                    cursor.update(next);
                }
                updated.push(next);
            }
        });
        return updated;
    } catch {
        const updated: ScreenInventoryImageRecord[] = [];
        const fallback = store.getMemoryFallback();
        for (const [k, r] of fallback.entries()) {
            if (r.artifactVersionId === artifactVersionId && r.screenSlug === screenSlug) {
                const next = { ...r, isPreferred: r.versionNumber === targetVersionNumber };
                fallback.set(k, next);
                updated.push(next);
            }
        }
        return updated;
    }
};
