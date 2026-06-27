// Per-user migration markers: which local projects have already been pushed to
// the server at least once. The server upsert is idempotent on the stable
// project UUID, so duplicates are inherently impossible — these markers exist so
// the UI can report migration state and so the sync layer can avoid re-uploading
// unchanged local projects on every sign-in.
//
// Leaf module (localStorage only), mirroring userScope.ts's namespacing.

const MIGRATED_PREFIX = 'synapse-projects-server-migrated::u:';

function keyFor(userId: string): string {
  return `${MIGRATED_PREFIX}${userId}`;
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
    // localStorage unavailable / full — non-fatal for migration tracking.
  }
}

/** Set of project ids this user has already migrated to the server. */
export function getMigratedProjectIds(userId: string): Set<string> {
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

/** Record that `projectIds` have been migrated to the server for `userId`. */
export function markProjectsMigrated(userId: string, projectIds: string[]): void {
  if (!userId || projectIds.length === 0) return;
  const current = getMigratedProjectIds(userId);
  let changed = false;
  for (const id of projectIds) {
    if (!current.has(id)) {
      current.add(id);
      changed = true;
    }
  }
  if (changed) safeSet(keyFor(userId), JSON.stringify([...current]));
}

/** Whether a specific local project has been migrated for `userId`. */
export function isProjectMigrated(userId: string, projectId: string): boolean {
  return getMigratedProjectIds(userId).has(projectId);
}
