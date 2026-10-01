// Project delete tombstones — pure helpers.
//
// Deleting a project used to leave no trace, so anything that unions project
// sets could bring it back: the cross-tab merge kept a stale tab's copy (a
// project present on only one side is kept), the stale tab then re-pushed it
// to the server, and a failed remote delete let the next sign-in reconcile
// pull it straight back. A tombstone — project id → deletedAt (epoch ms) —
// records the deletion so those paths can respect it:
// - crossTabMerge drops a project whose tombstone is at least as new as the
//   project's latest activity (activity AFTER the delete wins — new work is
//   never thrown away), and unions both tabs' tombstones;
// - server sync never pulls or pushes a tombstoned id, and retries the remote
//   delete on reconcile when the server still has the copy this device
//   deleted — but a cloud copy changed AFTER the deletion wins and is pulled
//   back (the store's reviveDeletedProject supersedes the tombstone);
// - the legacy-import / merged-account namespace merges never re-add one.
//
// Tombstones are PER USER, not per project: they live in the persisted store
// blob of the user's namespace (`ProjectState.projectTombstones`), next to the
// projects they suppress, so they switch with the namespace and are written
// atomically with the deletion itself. They are deliberately NOT a project
// collection (not in ALL_PROJECT_COLLECTIONS): they never travel in project
// bundles, snapshots, or exports. Bounded: entries older than the retention
// window are pruned on write, with a hard count cap as a backstop.
//
// PURE — no store/storage imports (crossTabMerge and userScope use it too).

export type ProjectTombstones = Record<string, number>;

/** How long a deletion is remembered. */
export const PROJECT_TOMBSTONE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/** Backstop bound on the map size (newest kept). */
export const MAX_PROJECT_TOMBSTONES = 500;

const isTimestamp = (value: unknown): value is number =>
    typeof value === 'number' && Number.isFinite(value);

/** Normalize an untrusted persisted value into a tombstone map. */
export function readProjectTombstones(value: unknown): ProjectTombstones {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const out: ProjectTombstones = {};
    for (const [id, deletedAt] of Object.entries(value as Record<string, unknown>)) {
        if (isTimestamp(deletedAt)) out[id] = deletedAt;
    }
    return out;
}

/**
 * Drop expired tombstones (older than the retention window) and enforce the
 * count cap. Returns the input reference when nothing was dropped, so store
 * updates stay reference-stable.
 */
export function pruneProjectTombstones(tombstones: ProjectTombstones, now: number = Date.now()): ProjectTombstones {
    const cutoff = now - PROJECT_TOMBSTONE_RETENTION_MS;
    let entries = Object.entries(tombstones).filter(([, deletedAt]) => deletedAt >= cutoff);
    if (entries.length > MAX_PROJECT_TOMBSTONES) {
        entries = entries.sort(([, a], [, b]) => b - a).slice(0, MAX_PROJECT_TOMBSTONES);
    }
    if (entries.length === Object.keys(tombstones).length) return tombstones;
    return Object.fromEntries(entries);
}

/** Record that `projectId` was deleted at `deletedAt` (pruning old entries). */
export function addProjectTombstone(
    tombstones: ProjectTombstones,
    projectId: string,
    deletedAt: number = Date.now(),
): ProjectTombstones {
    return pruneProjectTombstones({ ...tombstones, [projectId]: Math.max(deletedAt, tombstones[projectId] ?? 0) }, deletedAt);
}

/** Union two tombstone maps, keeping the newest deletion per id. */
export function mergeProjectTombstones(a: ProjectTombstones, b: ProjectTombstones): ProjectTombstones {
    const out: ProjectTombstones = { ...a };
    for (const [id, deletedAt] of Object.entries(b)) {
        if (!(id in out) || deletedAt > out[id]) out[id] = deletedAt;
    }
    return out;
}

/**
 * Whether a tombstone still suppresses a project whose newest activity is
 * `latestActivity` (see crossTabMerge.latestProjectActivity; 0 when the
 * project is absent). The deletion wins unless the project saw activity
 * strictly after it.
 */
export function isSuppressedByTombstone(deletedAt: number | undefined, latestActivity: number): boolean {
    return deletedAt !== undefined && deletedAt >= latestActivity;
}
