// Pure push/pull/GC decision logic for cross-device image sync. No store,
// network, or Blob access — unit-testable in isolation.

/**
 * Which local image keys need uploading: those present locally but NOT already
 * on the server. The server refs are the single source of truth — the caller
 * defers the round entirely if it can't fetch them, so this never uploads blind.
 * The server upsert is idempotent on (userId, projectId, key), so a redundant
 * re-upload is harmless and never produces a duplicate.
 */
export function computeImagesToUpload(
  localKeys: Iterable<string>,
  serverKeys: ReadonlySet<string>,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const key of localKeys) {
    if (seen.has(key)) continue;
    seen.add(key);
    if (!serverKeys.has(key)) out.push(key);
  }
  return out;
}

/**
 * Refcount-GC decision (pure): given the refs being deleted and ALL refs that
 * remain, return the content hashes that no longer have any reference and are
 * therefore safe to delete from Blob. Because images are content-addressed, a
 * hash still referenced by another version/project is correctly retained.
 */
export function computeOrphanedHashes(
  deleted: ReadonlyArray<{ hash: string }>,
  remaining: ReadonlyArray<{ hash: string }>,
): string[] {
  const remainingHashes = new Set(remaining.map((r) => r.hash));
  const orphaned = new Set<string>();
  for (const d of deleted) {
    if (!remainingHashes.has(d.hash)) orphaned.add(d.hash);
  }
  return [...orphaned];
}
