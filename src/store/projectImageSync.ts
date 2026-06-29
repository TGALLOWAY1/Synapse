// Cross-device mockup-image sync orchestrator. Sits alongside projectServerSync
// (text/bundle sync) and is driven by it: text always syncs first and is NEVER
// blocked by image sync — every function here is best-effort and swallows its
// own failures so a Blob hiccup can't revert or stall a project save.
//
// Local-first: IndexedDB stays the source of truth / render cache. This layer
// (1) pushes locally-generated image bytes to Blob + persists their refs, and
// (2) pulls refs into the registry so the mockup image store can hydrate lazily
// on another device. It imports only leaf libs (no Zustand store), so the
// mockup image store can call back into it without a cycle.

import type { MockupImageRecord } from '../types';
import { listImagesForVersion } from '../lib/mockupImageStore';
import { sha256Hex, dataUrlToBlob, buildImageBlobPath, contentTypeFromDataUrl } from '../lib/imageBlobHash';
import { buildMockupImageRef, type ImageRef } from '../lib/imageRef';
import { computeImagesToUpload } from '../lib/imageSyncDiff';
import { getUploadedImageKeys, markImagesUploaded } from '../lib/imageUploadMarker';
import {
  fetchImageRefs,
  putImageRef,
  uploadImageToBlob,
  deleteImageRefsRemote,
} from '../lib/imageRefsClient';
import { setProjectRefs } from '../lib/imageRefRegistry';
import { projectsDebug } from '../lib/projectsDebug';
import { DEMO_PROJECT_ID } from '../data/demoProject';

const UPLOAD_CONCURRENCY = 3;

// The active user, mirrored from projectServerSync so image-generation callbacks
// (which don't go through the bundle push path) can resolve identity. null when
// signed out → all image sync is a no-op.
let activeUserId: string | null = null;

export function setImageSyncUser(userId: string | null): void {
  activeUserId = userId;
}

async function runWithConcurrency<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const idx = cursor++;
      if (idx >= items.length) return;
      await worker(items[idx]);
    }
  });
  await Promise.all(runners);
}

/**
 * Push a project's not-yet-synced mockup images to Blob and persist their refs.
 * `versionIds` are the project's artifact version ids (image keys are scoped by
 * version). Best-effort and idempotent — a failed image is left unmarked and
 * retried on the next push; it never blocks text sync.
 */
export async function pushProjectImages(userId: string, projectId: string, versionIds: string[]): Promise<void> {
  if (!userId || projectId === DEMO_PROJECT_ID || versionIds.length === 0) return;
  try {
    const records: MockupImageRecord[] = [];
    for (const versionId of versionIds) {
      records.push(...(await listImagesForVersion(versionId)));
    }
    if (records.length === 0) return;
    const byKey = new Map(records.map((r) => [r.key, r]));

    // Diff against the server (best-effort) + the per-user uploaded markers.
    let serverKeys = new Set<string>();
    try {
      serverKeys = new Set((await fetchImageRefs(projectId)).map((r) => r.key));
    } catch {
      // Offline / transient: fall back to markers only. Re-upload is idempotent.
    }
    const uploaded = getUploadedImageKeys(userId);
    const toUpload = computeImagesToUpload(byKey.keys(), serverKeys, uploaded);
    if (toUpload.length === 0) return;

    await runWithConcurrency(toUpload, UPLOAD_CONCURRENCY, async (key) => {
      const record = byKey.get(key);
      if (!record) return;
      try {
        const hash = await sha256Hex(record.dataUrl);
        const contentType = contentTypeFromDataUrl(record.dataUrl);
        const path = buildImageBlobPath(userId, hash, contentType);
        const blob = dataUrlToBlob(record.dataUrl);
        const clientPayload = JSON.stringify({
          projectId,
          key: record.key,
          hash,
          kind: 'mockup',
          byteSize: blob.size,
        });
        const { url } = await uploadImageToBlob(path, blob, contentType, clientPayload);
        const ref: ImageRef = buildMockupImageRef(record, hash, url, blob.size);
        ref.projectId = projectId;
        await putImageRef(projectId, ref);
        markImagesUploaded(userId, [record.key]);
        projectsDebug('image pushed to blob', { projectId, key: record.key });
      } catch (error) {
        projectsDebug('image push failed', {
          projectId,
          key,
          message: error instanceof Error ? error.message : 'error',
        });
      }
    });
  } catch (error) {
    projectsDebug('pushProjectImages failed', {
      projectId,
      message: error instanceof Error ? error.message : 'error',
    });
  }
}

/** Pull a project's image refs into the registry for lazy hydration. Best-effort. */
export async function pullProjectImageRefs(projectId: string): Promise<void> {
  if (projectId === DEMO_PROJECT_ID) return;
  try {
    const refs = await fetchImageRefs(projectId);
    setProjectRefs(projectId, refs);
    projectsDebug('image refs pulled', { projectId, count: refs.length });
  } catch (error) {
    projectsDebug('pullProjectImageRefs failed', {
      projectId,
      message: error instanceof Error ? error.message : 'error',
    });
  }
}

/**
 * Called by the mockup image store right after a new image is written to
 * IndexedDB, so a freshly generated render syncs without waiting for an
 * unrelated bundle change to trigger a push. No-op when signed out.
 */
export function notifyMockupImageGenerated(projectId: string, versionId: string): void {
  if (!activeUserId || projectId === DEMO_PROJECT_ID) return;
  void pushProjectImages(activeUserId, projectId, [versionId]);
}

/** Delete specific image refs remotely (refcount-GCs orphan blobs server-side). */
export async function deleteProjectImageRefs(projectId: string, keys: string[]): Promise<void> {
  if (projectId === DEMO_PROJECT_ID || keys.length === 0) return;
  try {
    await deleteImageRefsRemote(projectId, keys);
  } catch (error) {
    projectsDebug('deleteProjectImageRefs failed', {
      projectId,
      message: error instanceof Error ? error.message : 'error',
    });
  }
}
