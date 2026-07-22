// Orchestrates two-way sync between the local Zustand project store and the
// server (`/api/projects`). Local-first: localStorage remains the live cache and
// every existing read path is unchanged; this layer pulls server projects in on
// sign-in (so they appear on a new device) and pushes local changes out
// (debounced) so they're durable and cross-device.
//
// Driven from authStore: startProjectSync(userId) on sign-in, stopProjectSync()
// on sign-out. Imports the store + sync store + client; must NOT be imported by
// any of them (no cycles).

import { useProjectStore } from './projectStore';
import { useProjectSyncStore } from './projectSyncStore';
import {
  extractProjectBundle,
  mergeBundlesIntoSource,
  overwriteBundlesIntoSource,
  projectSlicesChanged,
  pickBundleSource,
  type BundleSource,
  type ProjectBundle,
} from '../lib/projectBundle';
import {
  fetchProjectList,
  fetchProject,
  saveProject,
  deleteProject as deleteProjectRemote,
  RevisionConflictError,
  type ServerProjectSummary,
} from '../lib/projectsClient';
import {
  getProjectSyncMeta,
  setProjectSyncMeta,
  removeProjectSyncMeta,
  isServerNewer,
  type ProjectSyncMeta,
} from '../lib/projectSyncMeta';
import type { ProjectSyncInfo } from './projectSyncStore';
import { projectsDebug } from '../lib/projectsDebug';
import { clearImageRefRegistry } from '../lib/imageRefRegistry';
import {
  setImageSyncUser,
  pushProjectImages,
  pullProjectImageRefs,
} from './projectImageSync';
import { DEMO_PROJECT_ID } from '../data/demoProject';

const PUSH_DEBOUNCE_MS = 1500;

let activeUserId: string | null = null;
let unsubscribe: (() => void) | null = null;
// While true, store changes are NOT pushed — used to silence the echo from
// applying server bundles into the store.
let suspendPush = false;
const pushTimers = new Map<string, ReturnType<typeof setTimeout>>();
let knownProjectIds = new Set<string>();
// Monotonic per-project edit counter, bumped on every scheduled push. Lets an
// in-flight save detect that NEW edits landed after its bundle snapshot, so a
// successful save of the older snapshot doesn't clear the durable dirty flag
// for work it never carried (tab-close before the next debounce would then
// leave the cloud stale while meta claims "synced").
const editSeqs = new Map<string, number>();

function bundleSourceOf(state: ReturnType<typeof useProjectStore.getState>): BundleSource {
  return pickBundleSource(state);
}

/** Project ids worth syncing (excludes the read-only public demo). */
function syncableIds(state: ReturnType<typeof useProjectStore.getState>): string[] {
  return Object.keys(state.projects).filter((id) => id !== DEMO_PROJECT_ID);
}

/**
 * Whether a project has already reached the cloud at least once, derived from the
 * durable sync meta (a recorded successful save or an observed server revision).
 * Replaces the old projectMigration marker set — the server upsert is idempotent
 * on the project UUID, so this only feeds the "N uploaded" UI count, never gates
 * a push.
 */
function isProjectUploaded(userId: string, projectId: string): boolean {
  const meta = getProjectSyncMeta(userId, projectId);
  return meta.lastCloudSavedAt != null || meta.lastSeenServerRevision != null;
}

/**
 * Write the durable sync meta (survives reload — the reconcile baseline) and the
 * reactive per-project UI sync info together, so call sites don't hand-write both
 * stores back-to-back. `meta` is a durable patch (setProjectSyncMeta); `ui` is a
 * reactive PARTIAL merged onto the existing info (patchProjectSync). Either may be
 * omitted. This is a call-site dedup only — no semantic change.
 */
function recordSyncState(
  userId: string,
  projectId: string,
  opts: { meta?: Partial<ProjectSyncMeta>; ui?: Partial<ProjectSyncInfo> },
): void {
  if (opts.meta) setProjectSyncMeta(userId, projectId, opts.meta);
  if (opts.ui) useProjectSyncStore.getState().patchProjectSync(projectId, opts.ui);
}

/**
 * Record a successful cloud save in both the durable meta (survives reload — the
 * baseline reconcile compares against) and the in-memory sync store (drives UI).
 */
function recordCloudSaved(
  userId: string,
  projectId: string,
  saved: ServerProjectSummary,
  opts: { editedSinceSnapshot?: boolean } = {},
): void {
  const now = Date.now();
  // Only clear the durable dirty flag when nothing changed since the pushed
  // snapshot — a save that raced a newer local edit must leave the project
  // marked unsynced (the pending debounce push will carry the newer edit; the
  // flag stays honest if the tab closes before it fires).
  const stillDirty = opts.editedSinceSnapshot === true;
  setProjectSyncMeta(userId, projectId, {
    lastSeenServerRevision: typeof saved?.revision === 'number' ? saved.revision : undefined,
    lastSeenServerUpdatedAt: typeof saved?.updatedAt === 'string' ? saved.updatedAt : undefined,
    lastCloudSavedAt: now,
    lastCloudSaveError: null,
    hasUnsyncedChanges: stillDirty,
    conflict: false,
  });
  useProjectSyncStore.getState().setProjectSync(projectId, {
    state: stillDirty ? 'dirty' : 'saved',
    updatedAt: now,
    lastCloudSavedAt: now,
  });
}

/**
 * Mark a project conflicted: the server advanced on another device while this
 * device still has unsynced edits. Local work is preserved untouched — the user
 * must explicitly choose how to resolve (keep local / use cloud / download).
 */
function markConflict(
  userId: string,
  projectId: string,
  detectedAt: 'reconcile' | 'push',
  server: { revision?: number; updatedAt?: string },
): void {
  // lastCloudSavedAt is untouched by the meta patch below, so reading it first
  // yields the same value it would after the write.
  const meta = getProjectSyncMeta(userId, projectId);
  recordSyncState(userId, projectId, {
    meta: { conflict: true, hasUnsyncedChanges: true },
    ui: {
      state: 'conflict',
      updatedAt: Date.now(),
      lastCloudSavedAt: meta.lastCloudSavedAt,
      conflict: {
        detectedAt,
        serverRevision: server.revision,
        serverUpdatedAt: server.updatedAt,
      },
    },
  });
  projectsDebug('project conflict detected', { projectId, detectedAt, server });
}

async function pushProjectNow(projectId: string): Promise<void> {
  if (activeUserId === null || projectId === DEMO_PROJECT_ID) return;
  const userId = activeUserId;
  const sync = useProjectSyncStore.getState();
  const state = useProjectStore.getState();
  const bundle = extractProjectBundle(bundleSourceOf(state), projectId);
  if (!bundle) return; // deleted before the debounce fired

  // Do not auto-push a project that is standing in conflict — that would fight
  // the guard and risk clobbering. Resolution is explicit (see resolveConflict*).
  const meta = getProjectSyncMeta(userId, projectId);
  if (meta.conflict) {
    projectsDebug('push skipped — project in conflict', { projectId });
    return;
  }

  sync.patchProjectSync(projectId, { state: 'saving', updatedAt: Date.now() });
  // Snapshot the edit counter alongside the bundle: edits scheduled after this
  // point are NOT in the bundle being pushed.
  const seqAtSnapshot = editSeqs.get(projectId) ?? 0;
  try {
    // Conditional write: send the revision we last saw so the server rejects the
    // save (409) if it advanced on another device instead of overwriting it. For
    // a legacy row with no revision baseline, fall back to the last-seen
    // updatedAt so the guard still applies instead of pushing unconditionally.
    const expectedRevision =
      typeof meta.lastSeenServerRevision === 'number' ? meta.lastSeenServerRevision : undefined;
    const expectedUpdatedAt =
      expectedRevision === undefined && typeof meta.lastSeenServerUpdatedAt === 'string'
        ? meta.lastSeenServerUpdatedAt
        : undefined;
    const saved = await saveProject(projectId, bundle, { expectedRevision, expectedUpdatedAt });
    recordCloudSaved(userId, projectId, saved, {
      editedSinceSnapshot: (editSeqs.get(projectId) ?? 0) !== seqAtSnapshot,
    });
    projectsDebug('project pushed to server', { projectId, revision: saved?.revision });
    // Image sync runs AFTER (and never blocks) the text save. Fire-and-forget:
    // a Blob failure is non-fatal and retried on the next push.
    if (activeUserId === userId) {
      void pushProjectImages(userId, projectId, bundle.artifactVersions.map((v) => v.id));
    }
  } catch (error) {
    if (error instanceof RevisionConflictError) {
      // The server copy advanced under us and we still have local edits — a real
      // cross-device conflict. Preserve local work; require explicit resolution.
      markConflict(userId, projectId, 'push', { revision: error.currentRevision });
      return;
    }
    const message = error instanceof Error ? error.message : 'sync_failed';
    // A failed save NEVER drops local data — it stays in localStorage. Surface
    // the failure so the UI can show "Sync failed" and retry on the next change.
    recordSyncState(userId, projectId, {
      meta: { lastCloudSaveError: message, hasUnsyncedChanges: true },
      ui: {
        state: 'error',
        updatedAt: Date.now(),
        error: message,
        lastCloudSaveError: message,
      },
    });
    projectsDebug('project push failed', { projectId, message });
  }
}

function schedulePush(projectId: string): void {
  if (activeUserId === null || projectId === DEMO_PROJECT_ID) return;
  editSeqs.set(projectId, (editSeqs.get(projectId) ?? 0) + 1);
  // Durably mark unsynced edits so an offline/interrupted change isn't forgotten
  // across a reload, and so reconcile can tell a dirty project from a clean one.
  recordSyncState(activeUserId, projectId, {
    meta: { hasUnsyncedChanges: true },
    ui: { state: 'dirty', updatedAt: Date.now() },
  });
  const existing = pushTimers.get(projectId);
  if (existing) clearTimeout(existing);
  pushTimers.set(
    projectId,
    setTimeout(() => {
      pushTimers.delete(projectId);
      void pushProjectNow(projectId);
    }, PUSH_DEBOUNCE_MS),
  );
}

async function deleteRemote(projectId: string): Promise<void> {
  if (projectId === DEMO_PROJECT_ID) return;
  try {
    await deleteProjectRemote(projectId);
    useProjectSyncStore.getState().removeProjectSync(projectId);
    if (activeUserId) removeProjectSyncMeta(activeUserId, projectId);
    projectsDebug('project deleted on server', { projectId });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'delete_failed';
    projectsDebug('project remote delete failed', { projectId, message });
  }
}

/**
 * Apply a deletion that happened on ANOTHER device: remove the project's local
 * slices + sync bookkeeping without echoing a remote delete (the server is
 * already tombstoned). Only ever called for a CLEAN local copy — a dirty one is
 * surfaced as a conflict instead, so unsynced local work is never dropped.
 */
function removeLocalProject(projectId: string): void {
  suspendPush = true;
  try {
    useProjectStore.getState().deleteProject(projectId);
  } finally {
    suspendPush = false;
  }
  knownProjectIds.delete(projectId);
  const timer = pushTimers.get(projectId);
  if (timer) {
    clearTimeout(timer);
    pushTimers.delete(projectId);
  }
  useProjectSyncStore.getState().removeProjectSync(projectId);
  if (activeUserId) removeProjectSyncMeta(activeUserId, projectId);
  projectsDebug('remote-deleted project removed locally', { projectId });
}

/** Apply server bundles into the store additively, without echoing a push. */
function applyBundles(bundles: ProjectBundle[]): string[] {
  if (bundles.length === 0) return [];
  const state = useProjectStore.getState();
  const { next, addedIds } = mergeBundlesIntoSource(bundleSourceOf(state), bundles);
  if (addedIds.length === 0) return [];
  suspendPush = true;
  try {
    useProjectStore.setState(next);
  } finally {
    suspendPush = false;
  }
  return addedIds;
}

/**
 * REPLACE existing local slices with the server copy, without echoing a push.
 * Used for a safe server-newer refresh (local clean) or an explicit "use cloud"
 * conflict resolution. Also refreshes the knownProjectIds snapshot so the
 * overwrite isn't mistaken for a local change that needs pushing back.
 */
function applyBundlesOverwrite(bundles: ProjectBundle[]): string[] {
  if (bundles.length === 0) return [];
  const state = useProjectStore.getState();
  const { next, replacedIds } = overwriteBundlesIntoSource(bundleSourceOf(state), bundles);
  if (replacedIds.length === 0) return [];
  suspendPush = true;
  try {
    useProjectStore.setState(next);
  } finally {
    suspendPush = false;
  }
  knownProjectIds = new Set(syncableIds(useProjectStore.getState()));
  return replacedIds;
}

/**
 * Initial reconcile on sign-in: pull server projects this device doesn't have,
 * and upload local projects the server doesn't have (migration). Idempotent and
 * non-destructive — additive in both directions.
 */
/** Record the observed server baseline for a freshly pulled/refreshed project. */
function recordPulledBaseline(userId: string, summary: ServerProjectSummary): void {
  setProjectSyncMeta(userId, summary.id, {
    lastSeenServerRevision: typeof summary.revision === 'number' ? summary.revision : undefined,
    lastSeenServerUpdatedAt: typeof summary.updatedAt === 'string' ? summary.updatedAt : undefined,
    lastCloudSavedAt: Date.now(),
    lastCloudSaveError: null,
    hasUnsyncedChanges: false,
    conflict: false,
  });
  useProjectSyncStore.getState().setProjectSync(summary.id, {
    state: 'saved',
    updatedAt: Date.now(),
    lastCloudSavedAt: Date.now(),
  });
}

async function reconcile(userId: string): Promise<void> {
  useProjectSyncStore.getState().setPhase('loading');
  try {
    // Fetch EVERY row the server knows about — archived and soft-deleted
    // included. The default (live-only) list made absence ambiguous: a project
    // soft-deleted on another device looked identical to one the server never
    // had, so reconcile re-uploaded it and deletions resurrected everywhere.
    const summaries = await fetchProjectList({ includeArchived: true, includeDeleted: true });
    const liveSummaries = summaries.filter((s) => !s.deletedAt);
    const deletedSummaries = summaries.filter((s) => !!s.deletedAt);
    const serverIds = new Set(summaries.map((s) => s.id));
    const localIds = new Set(syncableIds(useProjectStore.getState()));

    // Remote deletions first: tombstoned on the server, still present locally.
    // Clean local copy → apply the deletion here. Dirty local copy → surface a
    // conflict (never silently drop unsynced local work, never silently
    // resurrect — the user chooses via the conflict UI).
    for (const summary of deletedSummaries) {
      if (!localIds.has(summary.id)) continue;
      const meta = getProjectSyncMeta(userId, summary.id);
      if (meta.hasUnsyncedChanges === true) {
        markConflict(userId, summary.id, 'reconcile', {
          revision: summary.revision,
          updatedAt: summary.updatedAt,
        });
        continue;
      }
      removeLocalProject(summary.id);
      localIds.delete(summary.id);
    }

    // Server -> local: fetch full bundles for projects this device is MISSING
    // (additive pull, unchanged) OR that the server has advanced on another
    // device while the local copy is clean (a safe refresh — overwrite local).
    const toAdd: ServerProjectSummary[] = [];
    const toRefresh: ServerProjectSummary[] = [];
    // Both-exist projects with unsynced local edits that the server has NOT
    // advanced past — a failed save or a tab-close after schedulePush can leave
    // these pending across a reload. Re-push them so they don't silently linger
    // as local-only while the banner reads "synced".
    const toRetryPush: string[] = [];
    for (const summary of liveSummaries) {
      if (!localIds.has(summary.id)) {
        toAdd.push(summary);
        continue;
      }
      // Both sides have this project — decide server-newer vs conflict.
      const meta = getProjectSyncMeta(userId, summary.id);
      const serverNewer = isServerNewer(summary, meta);
      const dirty = meta.hasUnsyncedChanges === true;
      if (serverNewer && !dirty) {
        toRefresh.push(summary); // safe: pull the newer server copy over clean local
      } else if (serverNewer && dirty) {
        markConflict(userId, summary.id, 'reconcile', {
          revision: summary.revision,
          updatedAt: summary.updatedAt,
        });
      } else {
        // Not server-newer.
        if (meta.lastSeenServerRevision === undefined && !meta.conflict) {
          // First reconcile post-baseline (e.g. data saved before conflict
          // tracking existed) — record the current server version so future
          // reconciles can detect divergence. Does not touch the unsynced flag.
          setProjectSyncMeta(userId, summary.id, {
            lastSeenServerRevision: typeof summary.revision === 'number' ? summary.revision : undefined,
            lastSeenServerUpdatedAt: typeof summary.updatedAt === 'string' ? summary.updatedAt : undefined,
          });
        }
        if (dirty && !meta.conflict) {
          toRetryPush.push(summary.id); // pending upload survived a reload — retry it
        }
      }
    }

    async function fetchBundle(summary: ServerProjectSummary): Promise<ProjectBundle | null> {
      try {
        const full = await fetchProject(summary.id);
        return full?.data ?? null;
      } catch (error) {
        projectsDebug('project pull failed', {
          projectId: summary.id,
          message: error instanceof Error ? error.message : 'error',
        });
        return null;
      }
    }

    const added: ProjectBundle[] = [];
    for (const summary of toAdd) {
      const bundle = await fetchBundle(summary);
      if (bundle) added.push(bundle);
    }
    applyBundles(added);
    for (const summary of toAdd) {
      if (added.some((b) => b.project.id === summary.id)) recordPulledBaseline(userId, summary);
    }

    const refreshed: ProjectBundle[] = [];
    for (const summary of toRefresh) {
      const bundle = await fetchBundle(summary);
      if (bundle) refreshed.push(bundle);
    }
    if (refreshed.length > 0) {
      // Re-check each project's durable dirty flag at APPLY time, not just at
      // list time: the per-project fetches above take multi-second wall-clock
      // (and the `online`-event reconcile fires while the user is working), so
      // an edit can land in the window after "local clean" was decided. Such a
      // project is a conflict now — overwriting would silently discard the
      // edit and clear its dirty flag.
      const safeToApply: ProjectBundle[] = [];
      for (const bundle of refreshed) {
        const id = bundle.project.id;
        if (getProjectSyncMeta(userId, id).hasUnsyncedChanges === true) {
          const summary = toRefresh.find((s) => s.id === id);
          markConflict(userId, id, 'reconcile', {
            revision: summary?.revision,
            updatedAt: summary?.updatedAt,
          });
          continue;
        }
        safeToApply.push(bundle);
      }
      applyBundlesOverwrite(safeToApply);
      for (const summary of toRefresh) {
        if (safeToApply.some((b) => b.project.id === summary.id)) recordPulledBaseline(userId, summary);
      }
      projectsDebug('server-newer projects refreshed over clean local', {
        count: safeToApply.length,
      });
    }

    // Local -> server: upload local-only projects (migration). A project counts
    // as newly uploaded when its durable sync meta shows no prior cloud save /
    // observed server revision (see isProjectUploaded) — the reload-surviving
    // "has this reached the cloud?" signal that replaced the migration markers.
    // With the full (deleted-inclusive) list above, absence from `serverIds`
    // now means the server either never saw this project OR hard-deleted it.
    // The durable baseline distinguishes them: a recorded server revision /
    // cloud save proves the project reached the cloud, so its absence is a
    // remote hard-delete — apply it locally (when clean) instead of treating
    // the project as a fresh migration and resurrecting it. A dirty copy is
    // re-pushed (deliberate re-create: never drop unsynced local work).
    const toPush: string[] = [];
    for (const id of localIds) {
      if (serverIds.has(id)) continue;
      const meta = getProjectSyncMeta(userId, id);
      const reachedCloud = meta.lastSeenServerRevision != null || meta.lastCloudSavedAt != null;
      if (reachedCloud && meta.hasUnsyncedChanges !== true) {
        removeLocalProject(id);
        continue;
      }
      toPush.push(id);
    }
    let migratedCount = 0;
    for (const id of toPush) {
      const wasUploaded = isProjectUploaded(userId, id);
      await pushProjectNow(id);
      if (!wasUploaded) migratedCount += 1;
    }

    // Retry pending uploads (dirty, both-exist, not server-newer) that a prior
    // failed save / tab-close left unsynced. pushProjectNow is conditional, so a
    // race that advanced the server since fetchProjectList still becomes a
    // conflict rather than an overwrite.
    for (const id of toRetryPush) {
      await pushProjectNow(id);
    }

    knownProjectIds = new Set(syncableIds(useProjectStore.getState()));
    useProjectSyncStore.getState().markPulled(migratedCount);

    // Pull image refs for every syncable project into the registry so the mockup
    // image store can hydrate bytes lazily on view. Refs only (no bytes), and
    // best-effort — never blocks the reconcile.
    for (const id of knownProjectIds) {
      void pullProjectImageRefs(id);
    }

    projectsDebug('project sync reconciled', {
      userId,
      added: added.length,
      refreshed: refreshed.length,
      migrated: migratedCount,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'sync_failed';
    // Pull failed — local data is intact. Show a recoverable error state.
    useProjectSyncStore.getState().setPhase('error', message);
    projectsDebug('project sync reconcile failed', { userId, message });
  }
}

function handleStoreChange(
  state: ReturnType<typeof useProjectStore.getState>,
  prev: ReturnType<typeof useProjectStore.getState>,
): void {
  if (suspendPush || activeUserId === null) return;
  const source = bundleSourceOf(state);
  const prevSource = bundleSourceOf(prev);
  const currentIds = new Set(syncableIds(state));

  // Pushes: new or changed projects.
  for (const id of currentIds) {
    if (!knownProjectIds.has(id) || projectSlicesChanged(source, prevSource, id)) {
      schedulePush(id);
    }
  }
  // Deletes: projects that were present and are now gone.
  for (const id of knownProjectIds) {
    if (!currentIds.has(id)) {
      const timer = pushTimers.get(id);
      if (timer) {
        clearTimeout(timer);
        pushTimers.delete(id);
      }
      void deleteRemote(id);
    }
  }
  knownProjectIds = currentIds;
}

/**
 * Begin syncing for `userId`: reconcile with the server, then subscribe to local
 * store changes to push them. Safe to call repeatedly for the same user.
 */
export function startProjectSync(userId: string | null): void {
  if (!userId) {
    stopProjectSync();
    return;
  }
  if (activeUserId === userId && unsubscribe) return; // already syncing this user
  stopProjectSync();
  activeUserId = userId;
  setImageSyncUser(userId);
  knownProjectIds = new Set(syncableIds(useProjectStore.getState()));

  void reconcile(userId).then(() => {
    // Subscribe only after the initial reconcile so the rehydrate/merge churn
    // doesn't spam pushes; live edits from here on are synced.
    if (activeUserId !== userId) return; // user changed mid-reconcile
    unsubscribe = useProjectStore.subscribe(handleStoreChange);
  });
}

/** Stop syncing (sign-out / namespace switch). Clears timers and UI state. */
export function stopProjectSync(): void {
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
  for (const timer of pushTimers.values()) clearTimeout(timer);
  pushTimers.clear();
  editSeqs.clear();
  activeUserId = null;
  setImageSyncUser(null);
  clearImageRefRegistry();
  knownProjectIds = new Set();
  useProjectSyncStore.getState().reset();
}

/** Force an immediate re-pull from the server (e.g. a "retry sync" button). */
export function refreshProjectsFromServer(): void {
  if (activeUserId) void reconcile(activeUserId);
}

/**
 * Resolve a conflict by ADOPTING THE CLOUD VERSION: overwrite the local copy
 * with the server bundle and re-baseline. The local edits are discarded — the
 * UI should only offer this after the user has (optionally) downloaded a
 * recovery copy of their local work. Returns true on success.
 */
export async function resolveConflictUseCloud(projectId: string): Promise<boolean> {
  const userId = activeUserId;
  if (!userId || projectId === DEMO_PROJECT_ID) return false;
  useProjectSyncStore.getState().patchProjectSync(projectId, { state: 'saving', updatedAt: Date.now() });
  try {
    const full = await fetchProject(projectId);
    if (!full?.data) {
      // Server copy is gone — nothing to adopt. Clear the conflict so the local
      // copy can push normally as a (re-)create.
      recordSyncState(userId, projectId, {
        meta: { conflict: false },
        ui: { state: 'dirty', conflict: undefined },
      });
      return false;
    }
    applyBundlesOverwrite([full.data]);
    recordPulledBaseline(userId, full);
    projectsDebug('conflict resolved — used cloud version', { projectId });
    return true;
  } catch (error) {
    projectsDebug('conflict resolve (use cloud) failed', {
      projectId,
      message: error instanceof Error ? error.message : 'error',
    });
    return false;
  }
}

/**
 * Resolve a conflict by KEEPING THE LOCAL VERSION: overwrite the cloud with the
 * local copy. Adopts the server's current revision as the expected baseline so
 * the conditional push succeeds (an explicit, user-authorized overwrite), then
 * pushes. Returns true if the push landed without re-conflicting.
 */
export async function resolveConflictKeepLocal(projectId: string): Promise<boolean> {
  const userId = activeUserId;
  if (!userId || projectId === DEMO_PROJECT_ID) return false;
  try {
    // Read the server's current revision so our next push expects it and wins.
    const full = await fetchProject(projectId);
    recordSyncState(userId, projectId, {
      meta: {
        lastSeenServerRevision: typeof full?.revision === 'number' ? full.revision : undefined,
        lastSeenServerUpdatedAt: typeof full?.updatedAt === 'string' ? full.updatedAt : undefined,
        conflict: false,
        hasUnsyncedChanges: true,
      },
      ui: {
        state: 'dirty',
        updatedAt: Date.now(),
        conflict: undefined,
      },
    });
    await pushProjectNow(projectId);
    return getProjectSyncMeta(userId, projectId).conflict !== true;
  } catch (error) {
    projectsDebug('conflict resolve (keep local) failed', {
      projectId,
      message: error instanceof Error ? error.message : 'error',
    });
    return false;
  }
}

// Track browser online/offline so the UI can show an offline state.
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    useProjectSyncStore.getState().setOnline(true);
    refreshProjectsFromServer();
  });
  window.addEventListener('offline', () => useProjectSyncStore.getState().setOnline(false));

  // Warn on close/navigation ONLY when cloud durability is genuinely stuck — a
  // standing conflict or a failed cloud save that won't clear on its own. Normal
  // 'dirty' (about to push) and 'saving' states are not blocked, to avoid
  // nagging. Local data is never lost either way (localStorage persists); this
  // guards against a user walking away believing work reached the cloud.
  window.addEventListener('beforeunload', (event) => {
    if (activeUserId === null) return;
    const projects = useProjectSyncStore.getState().projects;
    const stuck = Object.values(projects).some(
      (p) => p.state === 'conflict' || p.state === 'error',
    );
    if (stuck) {
      event.preventDefault();
      // Legacy browsers require returnValue to be set to trigger the prompt.
      event.returnValue = '';
      return '';
    }
  });
}
