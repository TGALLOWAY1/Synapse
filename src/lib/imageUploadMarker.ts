// Per-user markers for which mockup-image keys have already been uploaded to
// Blob, so the push path can skip them without a network round-trip. Mirrors
// projectMigration.ts exactly (per-user localStorage namespacing, defensive
// try/catch). The server upsert is idempotent on (userId, projectId, key), so
// these markers are an optimization — never a correctness dependency.
//
// Leaf module (localStorage only).

const UPLOADED_PREFIX = 'synapse-mockup-images-uploaded::u:';

function keyFor(userId: string): string {
  return `${UPLOADED_PREFIX}${userId}`;
}

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // localStorage unavailable / full — non-fatal for upload tracking.
  }
}

/** Set of image keys this user has already uploaded to Blob. */
export function getUploadedImageKeys(userId: string): Set<string> {
  if (!userId) return new Set();
  const raw = safeGet(keyFor(userId));
  if (!raw) return new Set();
  try {
    const parsed = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

/** Record that `keys` have been uploaded for `userId`. */
export function markImagesUploaded(userId: string, keys: string[]): void {
  if (!userId || keys.length === 0) return;
  const current = getUploadedImageKeys(userId);
  let changed = false;
  for (const key of keys) {
    if (!current.has(key)) {
      current.add(key);
      changed = true;
    }
  }
  if (changed) safeSet(keyFor(userId), JSON.stringify([...current]));
}

/** Forget `keys` for `userId` (e.g. after a remote delete, so a re-add re-uploads). */
export function unmarkImagesUploaded(userId: string, keys: string[]): void {
  if (!userId || keys.length === 0) return;
  const current = getUploadedImageKeys(userId);
  let changed = false;
  for (const key of keys) {
    if (current.delete(key)) changed = true;
  }
  if (changed) safeSet(keyFor(userId), JSON.stringify([...current]));
}
