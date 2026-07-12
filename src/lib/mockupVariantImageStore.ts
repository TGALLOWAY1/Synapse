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
//
// The open/upgrade/fallback skeleton is shared with `mockupImageStore.ts` and
// `screenInventoryImageStore.ts` via `idbRecordStore.ts` — see that module for
// the shared mechanics.

import type { MockupImageQuality, MockupVariantImageRecord } from '../types';
import { createRecordStore } from './idbRecordStore';

const store = createRecordStore<MockupVariantImageRecord>({
    dbName: 'synapse-mockup-variant-images',
    dbVersion: 1,
    storeName: 'variant-images',
    keyPath: 'key',
    indexField: 'versionId',
    logLabel: 'mockup-variant-image-store',
    lossNote: 'Variant images will be lost on reload.',
});

/** Composite primary key for a variant image record. */
export const buildVariantImageKey = (
    versionId: string,
    screenId: string,
    variantId: string,
    quality: MockupImageQuality,
): string => `${versionId}:${screenId}:${variantId}:${quality}`;

export const putVariantImage = (record: MockupVariantImageRecord): Promise<void> => store.put(record);

export const getVariantImage = (key: string): Promise<MockupVariantImageRecord | undefined> =>
    store.get(key);

export const listVariantImagesForVersion = (
    versionId: string,
): Promise<MockupVariantImageRecord[]> => store.listByIndex(versionId);

export const deleteVariantImagesForVersion = (versionId: string): Promise<void> =>
    store.deleteByIndex(versionId);
