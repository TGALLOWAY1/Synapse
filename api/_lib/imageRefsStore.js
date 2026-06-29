// Server-side store for per-user image references. The image BYTES live in
// Vercel Blob (content-addressed under `users/<userId>/mockup-images/<hash>`);
// this collection only holds small *reference* records so the `projects`
// documents (and the /api/projects bundle) stay text-only. One document per
// (userId, projectId, key) where `key` is the IndexedDB composite key the
// client uses to find the image locally.
//
// This is the durability layer for the per-user /api/projects sync path. It is
// SEPARATE from the owner-only snapshot feature (api/snapshots.js) and does not
// touch it.
//
// ACCESS CONTROL (RLS-equivalent), identical to projectsStore.js: MongoDB has
// no row-level security, so every function takes `userId` as its first argument
// and pins `{ userId }` into the filter. No code path reads or writes a ref
// without the owner's id in the filter, so one user's query can never match
// another user's row. `userId` always comes from the verified session at the
// call site (requireUser) — never from a client-supplied value.
//
// CONTENT-ADDRESSING + GC: blobs are addressed by sha256(dataUrl), so identical
// renders dedup to one blob and the hash → blob path is 1:1. Deleting refs is
// therefore refcount-aware: a blob is only orphaned (safe to delete) once NO
// remaining ref for that user points at its hash. The store computes the
// orphaned blob URLs and returns them; the HTTP handler performs the actual
// Blob `del()` so the data layer stays free of Blob-SDK concerns.

import { runMongoAction } from './db.js';

export const IMAGE_REFS_COLLECTION = 'project_images';

// Image keys are client composite keys: `${versionId}:${screenId}:${quality}`
// for mockups, or `${artifactVersionId}:${screenSlug}:${versionNumber}` for
// screen-inventory uploads. Keep this permissive but bounded.
const KEY_RE = /^[\x20-\x7E]{1,512}$/;
const HASH_RE = /^[0-9a-f]{64}$/;
const VALID_KINDS = new Set(['mockup', 'screen_inventory']);

export function isValidImageKey(key) {
  return typeof key === 'string' && KEY_RE.test(key);
}

export function isValidHash(hash) {
  return typeof hash === 'string' && HASH_RE.test(hash);
}

let indexPromise = null;

/**
 * Create the image-ref indexes once per warm serverless instance. Idempotent —
 * createIndex is a no-op when an identical index already exists. Never throws
 * out to a request.
 */
export async function ensureImageRefIndexes() {
  if (!indexPromise) {
    indexPromise = runMongoAction('createIndexes', {
      collection: IMAGE_REFS_COLLECTION,
      indexes: [
        { key: { userId: 1, projectId: 1, key: 1 }, unique: true, name: 'user_project_key_unique' },
        { key: { userId: 1, projectId: 1 }, name: 'user_project' },
        { key: { userId: 1, hash: 1 }, name: 'user_hash' },
      ],
    }).catch((error) => {
      indexPromise = null;
      console.error('[imageRefsStore] ensureImageRefIndexes failed', error?.name || 'error');
    });
  }
  return indexPromise;
}

// Only ever persist the fields we control. `meta` is the opaque, dataUrl-less
// image record the client reconstructs from (so this store stays generic across
// mockup and screen-inventory images); everything else is indexed / validated.
function sanitizeRef(ref) {
  const kind = VALID_KINDS.has(ref?.kind) ? ref.kind : 'mockup';
  const out = {
    key: String(ref.key),
    hash: String(ref.hash),
    blobUrl: String(ref.blobUrl),
    byteSize: Number.isFinite(ref?.byteSize) ? Math.max(0, Math.floor(ref.byteSize)) : 0,
    kind,
    meta: ref?.meta && typeof ref.meta === 'object' ? ref.meta : {},
  };
  // Surface the mockup routing fields at the top level for queryability when
  // present (screen-inventory refs simply omit them).
  if (typeof ref?.versionId === 'string') out.versionId = ref.versionId;
  if (typeof ref?.screenId === 'string') out.screenId = ref.screenId;
  if (typeof ref?.quality === 'string') out.quality = ref.quality;
  return out;
}

/** True when `value` is a structurally valid ref the server will accept. */
export function isValidRef(value) {
  return Boolean(
    value
    && typeof value === 'object'
    && isValidImageKey(value.key)
    && isValidHash(value.hash)
    && typeof value.blobUrl === 'string'
    && value.blobUrl.length > 0
    && value.blobUrl.length <= 2048,
  );
}

/** List a user's image refs for one project. */
export async function listImageRefs(userId, projectId) {
  if (!userId) throw new Error('listImageRefs: userId is required');
  if (typeof projectId !== 'string' || !projectId) return [];
  await ensureImageRefIndexes();
  const result = await runMongoAction('find', {
    collection: IMAGE_REFS_COLLECTION,
    filter: { userId, projectId },
    projection: { _id: 0, userId: 0 },
  });
  return Array.isArray(result?.documents) ? result.documents : [];
}

/**
 * Create-or-update a single image ref, owner-scoped and idempotent on
 * (userId, projectId, key). Re-uploading the same render just refreshes the
 * blobUrl/updatedAt. Returns the saved ref.
 */
export async function upsertImageRef(userId, projectId, ref) {
  if (!userId) throw new Error('upsertImageRef: userId is required');
  if (typeof projectId !== 'string' || !projectId) throw new Error('upsertImageRef: projectId is required');
  if (!isValidRef(ref)) throw new Error('upsertImageRef: invalid ref');
  await ensureImageRefIndexes();

  const now = new Date();
  const clean = sanitizeRef(ref);
  await runMongoAction('updateOne', {
    collection: IMAGE_REFS_COLLECTION,
    filter: { userId, projectId, key: clean.key },
    update: {
      $set: { userId, projectId, ...clean, updatedAt: now },
      $setOnInsert: { createdAt: now },
    },
    upsert: true,
  });
  return { projectId, ...clean, updatedAt: now };
}

/**
 * Decide which of `hashes` are now orphaned (no remaining ref for the user
 * points at them) and therefore safe to delete from Blob. Pure given the
 * remaining-refs lookup, which is injected for testability.
 */
export async function findOrphanedHashes(userId, hashes, lookupRemaining) {
  const orphaned = [];
  for (const hash of new Set(hashes)) {
    if (!isValidHash(hash)) continue;
    const remaining = await lookupRemaining(hash);
    if (remaining === 0) orphaned.push(hash);
  }
  return orphaned;
}

async function countRefsForHash(userId, hash) {
  const result = await runMongoAction('find', {
    collection: IMAGE_REFS_COLLECTION,
    filter: { userId, hash },
    projection: { _id: 0, key: 1 },
  });
  return Array.isArray(result?.documents) ? result.documents.length : 0;
}

/**
 * Delete a set of refs (by key) within one project, then refcount-GC: return
 * the blob URLs whose hash no longer has ANY ref for this user. The handler
 * deletes those blobs from Vercel Blob. Returns
 * `{ deletedCount, orphanedBlobUrls }`.
 */
export async function deleteImageRefs(userId, projectId, keys) {
  if (!userId) throw new Error('deleteImageRefs: userId is required');
  if (typeof projectId !== 'string' || !projectId) return { deletedCount: 0, orphanedBlobUrls: [] };
  const validKeys = (Array.isArray(keys) ? keys : []).filter(isValidImageKey);
  if (validKeys.length === 0) return { deletedCount: 0, orphanedBlobUrls: [] };
  await ensureImageRefIndexes();

  // Snapshot the refs we're about to delete so we know their hashes/urls.
  const existing = await runMongoAction('find', {
    collection: IMAGE_REFS_COLLECTION,
    filter: { userId, projectId, key: { $in: validKeys } },
    projection: { _id: 0, key: 1, hash: 1, blobUrl: 1 },
  });
  const toDelete = Array.isArray(existing?.documents) ? existing.documents : [];
  if (toDelete.length === 0) return { deletedCount: 0, orphanedBlobUrls: [] };

  const del = await runMongoAction('deleteMany', {
    collection: IMAGE_REFS_COLLECTION,
    filter: { userId, projectId, key: { $in: validKeys } },
  });

  const orphanedBlobUrls = await collectOrphanedBlobUrls(userId, toDelete);
  return { deletedCount: del?.deletedCount ?? 0, orphanedBlobUrls };
}

/**
 * Delete every ref for one project (used on project hard-delete) and return the
 * blob URLs orphaned by the deletion.
 */
export async function deleteRefsForProject(userId, projectId) {
  if (!userId) throw new Error('deleteRefsForProject: userId is required');
  if (typeof projectId !== 'string' || !projectId) return { deletedCount: 0, orphanedBlobUrls: [] };
  await ensureImageRefIndexes();

  const existing = await runMongoAction('find', {
    collection: IMAGE_REFS_COLLECTION,
    filter: { userId, projectId },
    projection: { _id: 0, key: 1, hash: 1, blobUrl: 1 },
  });
  const toDelete = Array.isArray(existing?.documents) ? existing.documents : [];
  if (toDelete.length === 0) return { deletedCount: 0, orphanedBlobUrls: [] };

  const del = await runMongoAction('deleteMany', {
    collection: IMAGE_REFS_COLLECTION,
    filter: { userId, projectId },
  });

  const orphanedBlobUrls = await collectOrphanedBlobUrls(userId, toDelete);
  return { deletedCount: del?.deletedCount ?? 0, orphanedBlobUrls };
}

// Shared refcount-GC core: given the refs that were just deleted, return the
// blob URLs whose hash has zero remaining refs for this user. The remaining
// count is queried AFTER deletion, so a hash still referenced by another
// project/version is correctly retained.
async function collectOrphanedBlobUrls(userId, deletedRefs) {
  const hashToUrl = new Map();
  for (const r of deletedRefs) {
    if (isValidHash(r?.hash) && typeof r?.blobUrl === 'string') hashToUrl.set(r.hash, r.blobUrl);
  }
  const orphanedHashes = await findOrphanedHashes(
    userId,
    [...hashToUrl.keys()],
    (hash) => countRefsForHash(userId, hash),
  );
  return orphanedHashes.map((h) => hashToUrl.get(h)).filter(Boolean);
}
