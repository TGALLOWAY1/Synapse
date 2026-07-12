// Durable, per-user, per-project sync metadata — kept SEPARATE from the
// user-authored project content (the Zustand `projects` slice) so it never
// contaminates a bundle or an export. This is the local record of what we last
// knew about the server copy of each project, and whether local edits are still
// waiting to reach the cloud.
//
// Why a dedicated localStorage map (not the in-memory projectSyncStore): the
// sync store is reset on every reload, but cross-device conflict detection needs
// a baseline that SURVIVES a reload — "the last server revision this device
// observed" and "does this device have unsynced edits". Without a durable
// baseline, a stale client can't tell whether the server advanced underneath it.
//
// Leaf module (localStorage only), mirroring userScope.ts's per-user
// namespacing. Back-compat: a project with no stored meta simply returns {} and
// every field is optional, so legacy/anonymous data behaves exactly as before.

const META_PREFIX = 'synapse-project-sync-meta::u:';

export interface ProjectSyncMeta {
  /** Server `revision` counter this device last observed (pulled or saved). */
  lastSeenServerRevision?: number;
  /** Server `updatedAt` (ISO string) this device last observed. Fallback when
   *  the server row predates the revision counter. */
  lastSeenServerUpdatedAt?: string;
  /** Epoch ms of the last successful push of this project to the cloud. */
  lastCloudSavedAt?: number;
  /** Message from the last failed cloud save, or null once a save succeeds. */
  lastCloudSaveError?: string | null;
  /** True while local edits exist that have not been confirmed saved to the
   *  cloud. Durable across reloads so an offline edit isn't forgotten. */
  hasUnsyncedChanges?: boolean;
  /** True when the server copy advanced beyond `lastSeenServerRevision` while
   *  this device also has unsynced edits — a genuine cross-device conflict. */
  conflict?: boolean;
}

type MetaMap = Record<string, ProjectSyncMeta>;

function keyFor(userId: string): string {
  return `${META_PREFIX}${userId}`;
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
    // localStorage unavailable / full — non-fatal for sync bookkeeping.
  }
}

/** Read the whole per-user meta map (defensive; never throws). */
export function getAllProjectSyncMeta(userId: string): MetaMap {
  if (!userId) return {};
  const raw = safeGet(keyFor(userId));
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as MetaMap) : {};
  } catch {
    return {};
  }
}

/** Read one project's durable sync meta (empty object if none recorded). */
export function getProjectSyncMeta(userId: string, projectId: string): ProjectSyncMeta {
  if (!userId || !projectId) return {};
  const map = getAllProjectSyncMeta(userId);
  return map[projectId] ?? {};
}

/**
 * Shallow-merge a patch into a project's durable sync meta. Passing `undefined`
 * for a field leaves the existing value; pass an explicit value (including
 * `null` for `lastCloudSaveError`) to overwrite. Returns the merged record.
 */
export function setProjectSyncMeta(
  userId: string,
  projectId: string,
  patch: Partial<ProjectSyncMeta>,
): ProjectSyncMeta {
  if (!userId || !projectId) return {};
  const map = getAllProjectSyncMeta(userId);
  const current = map[projectId] ?? {};
  const next: ProjectSyncMeta = { ...current };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    (next as Record<string, unknown>)[k] = v;
  }
  map[projectId] = next;
  safeSet(keyFor(userId), JSON.stringify(map));
  return next;
}

/** Remove a project's durable sync meta (e.g. after a hard delete). */
export function removeProjectSyncMeta(userId: string, projectId: string): void {
  if (!userId || !projectId) return;
  const map = getAllProjectSyncMeta(userId);
  if (!(projectId in map)) return;
  delete map[projectId];
  safeSet(keyFor(userId), JSON.stringify(map));
}

/**
 * Compare a server revision/timestamp against the last-seen baseline. Prefers
 * the monotonic `revision` counter; falls back to `updatedAt` string ordering
 * when a revision isn't available on either side. Returns false when there's no
 * baseline to compare against (we can't claim "newer" without a reference).
 */
export function isServerNewer(
  server: { revision?: number | null; updatedAt?: string | null },
  meta: ProjectSyncMeta,
): boolean {
  const serverRev = typeof server.revision === 'number' ? server.revision : null;
  const seenRev =
    typeof meta.lastSeenServerRevision === 'number' ? meta.lastSeenServerRevision : null;
  if (serverRev !== null && seenRev !== null) {
    return serverRev > seenRev;
  }
  const serverAt = typeof server.updatedAt === 'string' ? server.updatedAt : null;
  const seenAt =
    typeof meta.lastSeenServerUpdatedAt === 'string' ? meta.lastSeenServerUpdatedAt : null;
  if (serverAt !== null && seenAt !== null) {
    return serverAt > seenAt;
  }
  return false;
}
