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
import { markProjectsMigrated, getMigratedProjectIds } from '../lib/projectMigration';
import {
  getProjectSyncMeta,
  setProjectSyncMeta,
  removeProjectSyncMeta,
  isServerNewer,
} from '../lib/projectSyncMeta';
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

function bundleSourceOf(state: ReturnType<typeof useProjectStore.getState>): BundleSource {
  return {
    projects: state.projects,
    spineVersions: state.spineVersions,
    historyEvents: state.historyEvents,
    branches: state.branches,
    artifacts: state.artifacts,
    artifactVersions: state.artifactVersions,
    feedbackItems: state.feedbackItems,
    tasks: state.tasks,
    workflowRuns: state.workflowRuns,
    reviewRuns: state.reviewRuns,
    specialistRuns: state.specialistRuns,
    reviewFindings: state.reviewFindings,
    reviewIssues: state.reviewIssues,
    planningRecords: state.planningRecords,
    readinessReviews: state.readinessReviews,
    readinessCommitmentEvents: state.readinessCommitmentEvents,
    downstreamUpdatePlans: state.downstreamUpdatePlans,
    downstreamUpdatePlanEvents: state.downstreamUpdatePlanEvents,
    downstreamArtifactUpdateProposals: state.downstreamArtifactUpdateProposals,
    downstreamArtifactUpdateReviewEvents: state.downstreamArtifactUpdateReviewEvents,
    downstreamArtifactUpdateApplications: state.downstreamArtifactUpdateApplications,
    downstreamArtifactUpdateVerifications: state.downstreamArtifactUpdateVerifications,
    downstreamArtifactUpdateVerificationEvents: state.downstreamArtifactUpdateVerificationEvents,
  };
}

/** Project ids worth syncing (excludes the read-only public demo). */
function syncableIds(state: ReturnType<typeof useProjectStore.getState>): string[] {
  return Object.keys(state.projects).filter((id) => id !== DEMO_PROJECT_ID);
}

/**
 * Record a successful cloud save in both the durable meta (survives reload — the
 * baseline reconcile compares against) and the in-memory sync store (drives UI).
 */
function recordCloudSaved(userId: string, projectId: string, saved: ServerProjectSummary): void {
  const now = Date.now();
  setProjectSyncMeta(userId, projectId, {
    lastSeenServerRevision: typeof saved?.revision === 'number' ? saved.revision : undefined,
    lastSeenServerUpdatedAt: typeof saved?.updatedAt === 'string' ? saved.updatedAt : undefined,
    lastCloudSavedAt: now,
    lastCloudSaveError: null,
    hasUnsyncedChanges: false,
    conflict: false,
  });
  useProjectSyncStore.getState().setProjectSync(projectId, {
    state: 'saved',
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
  setProjectSyncMeta(userId, projectId, { conflict: true, hasUnsyncedChanges: true });
  const meta = getProjectSyncMeta(userId, projectId);
  useProjectSyncStore.getState().patchProjectSync(projectId, {
    state: 'conflict',
    updatedAt: Date.now(),
    lastCloudSavedAt: meta.lastCloudSavedAt,
    conflict: {
      detectedAt,
      serverRevision: server.revision,
      serverUpdatedAt: server.updatedAt,
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
    if (activeUserId === userId) markProjectsMigrated(userId, [projectId]);
    recordCloudSaved(userId, projectId, saved);
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
    setProjectSyncMeta(userId, projectId, { lastCloudSaveError: message, hasUnsyncedChanges: true });
    useProjectSyncStore.getState().patchProjectSync(projectId, {
      state: 'error',
      updatedAt: Date.now(),
      error: message,
      lastCloudSaveError: message,
    });
    projectsDebug('project push failed', { projectId, message });
  }
}

function schedulePush(projectId: string): void {
  if (activeUserId === null || projectId === DEMO_PROJECT_ID) return;
  // Durably mark unsynced edits so an offline/interrupted change isn't forgotten
  // across a reload, and so reconcile can tell a dirty project from a clean one.
  setProjectSyncMeta(activeUserId, projectId, { hasUnsyncedChanges: true });
  useProjectSyncStore.getState().patchProjectSync(projectId, { state: 'dirty', updatedAt: Date.now() });
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
    const summaries = await fetchProjectList();
    const serverIds = new Set(summaries.map((s) => s.id));
    const localIds = new Set(syncableIds(useProjectStore.getState()));

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
    for (const summary of summaries) {
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
      applyBundlesOverwrite(refreshed);
      for (const summary of toRefresh) {
        if (refreshed.some((b) => b.project.id === summary.id)) recordPulledBaseline(userId, summary);
      }
      projectsDebug('server-newer projects refreshed over clean local', {
        count: refreshed.length,
      });
    }

    // Local -> server: upload local-only projects (migration).
    const migrated = getMigratedProjectIds(userId);
    const toPush = [...localIds].filter((id) => !serverIds.has(id));
    let migratedCount = 0;
    for (const id of toPush) {
      const wasMigrated = migrated.has(id);
      await pushProjectNow(id);
      if (!wasMigrated) migratedCount += 1;
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
      setProjectSyncMeta(userId, projectId, { conflict: false });
      useProjectSyncStore.getState().patchProjectSync(projectId, { state: 'dirty', conflict: undefined });
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
    setProjectSyncMeta(userId, projectId, {
      lastSeenServerRevision: typeof full?.revision === 'number' ? full.revision : undefined,
      lastSeenServerUpdatedAt: typeof full?.updatedAt === 'string' ? full.updatedAt : undefined,
      conflict: false,
      hasUnsyncedChanges: true,
    });
    useProjectSyncStore.getState().patchProjectSync(projectId, {
      state: 'dirty',
      updatedAt: Date.now(),
      conflict: undefined,
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
