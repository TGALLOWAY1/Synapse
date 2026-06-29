// The transport unit for cross-device image sync: a small *reference* record
// pointing at the Blob-stored bytes. Mirrors snapshotClient's `imageMetadata`
// (the full image record minus its dataUrl, carried in `meta`) plus the
// content-address (`hash`), the Blob URL (`blobUrl`) and `byteSize`.
//
// Deliberately generic over image kind so the same ref store / Blob path can
// back both mockup images and (later) Screen Inventory upload images — only the
// `meta` shape and the routing fields differ.

import type { MockupImageQuality, MockupImageRecord } from '../types';

export type ImageRefKind = 'mockup' | 'screen_inventory';

export interface ImageRef {
  projectId: string;
  /** The IndexedDB composite key the client uses to find the image locally. */
  key: string;
  /** sha256(dataUrl) — content address; identical renders share one blob. */
  hash: string;
  blobUrl: string;
  byteSize: number;
  kind: ImageRefKind;
  // Mockup routing fields, surfaced at top level for queryability when present.
  versionId?: string;
  screenId?: string;
  quality?: MockupImageQuality;
  /** The dataUrl-less image record, so the client can reconstruct it on pull. */
  meta?: Record<string, unknown>;
  updatedAt?: number | string;
}

/** Build a ref to persist from a mockup image record (dataUrl stripped into Blob). */
export function buildMockupImageRef(
  record: MockupImageRecord,
  hash: string,
  blobUrl: string,
  byteSize: number,
): ImageRef {
  const { dataUrl: _dataUrl, ...meta } = record;
  void _dataUrl;
  return {
    projectId: record.projectId,
    key: record.key,
    hash,
    blobUrl,
    byteSize,
    kind: 'mockup',
    versionId: record.versionId,
    screenId: record.screenId,
    quality: record.quality,
    meta,
  };
}

/**
 * Reconstruct a full MockupImageRecord from a pulled ref + freshly fetched
 * dataUrl. Prefers the rich `meta` (set by the authoritative client persist
 * path) but degrades gracefully to the top-level routing fields if only the
 * server-callback backup ref exists (meta empty).
 */
export function mockupRecordFromRef(ref: ImageRef, dataUrl: string): MockupImageRecord {
  const meta = (ref.meta ?? {}) as Partial<MockupImageRecord>;
  return {
    key: meta.key ?? ref.key,
    projectId: meta.projectId ?? ref.projectId,
    artifactId: meta.artifactId ?? '',
    versionId: meta.versionId ?? ref.versionId ?? '',
    screenId: meta.screenId ?? ref.screenId ?? '',
    dataUrl,
    quality: (meta.quality ?? ref.quality ?? 'low') as MockupImageQuality,
    prompt: meta.prompt ?? '',
    generatedAt: meta.generatedAt ?? 0,
  };
}

/** The versionId a ref is grouped under for lazy hydration (meta wins). */
export function refVersionId(ref: ImageRef): string | undefined {
  const metaVersion = (ref.meta as { versionId?: unknown } | undefined)?.versionId;
  if (typeof metaVersion === 'string' && metaVersion) return metaVersion;
  return ref.versionId;
}
