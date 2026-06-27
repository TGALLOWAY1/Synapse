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
  projectSlicesChanged,
  type BundleSource,
  type ProjectBundle,
} from '../lib/projectBundle';
import {
  fetchProjectList,
  fetchProject,
  saveProject,
  deleteProject as deleteProjectRemote,
} from '../lib/projectsClient';
import { markProjectsMigrated, getMigratedProjectIds } from '../lib/projectMigration';
import { projectsDebug } from '../lib/projectsDebug';
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
  };
}

/** Project ids worth syncing (excludes the read-only public demo). */
function syncableIds(state: ReturnType<typeof useProjectStore.getState>): string[] {
  return Object.keys(state.projects).filter((id) => id !== DEMO_PROJECT_ID);
}

async function pushProjectNow(projectId: string): Promise<void> {
  if (activeUserId === null || projectId === DEMO_PROJECT_ID) return;
  const sync = useProjectSyncStore.getState();
  const state = useProjectStore.getState();
  const bundle = extractProjectBundle(bundleSourceOf(state), projectId);
  if (!bundle) return; // deleted before the debounce fired

  sync.setProjectSync(projectId, { state: 'saving', updatedAt: Date.now() });
  try {
    await saveProject(projectId, bundle);
    if (activeUserId) markProjectsMigrated(activeUserId, [projectId]);
    useProjectSyncStore.getState().setProjectSync(projectId, { state: 'saved', updatedAt: Date.now() });
    projectsDebug('project pushed to server', { projectId });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'sync_failed';
    // A failed save NEVER drops local data — it stays in localStorage. Surface
    // the failure so the UI can show "Sync failed" and retry on the next change.
    useProjectSyncStore.getState().setProjectSync(projectId, {
      state: 'error',
      updatedAt: Date.now(),
      error: message,
    });
    projectsDebug('project push failed', { projectId, message });
  }
}

function schedulePush(projectId: string): void {
  if (activeUserId === null || projectId === DEMO_PROJECT_ID) return;
  useProjectSyncStore.getState().setProjectSync(projectId, { state: 'dirty', updatedAt: Date.now() });
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
 * Initial reconcile on sign-in: pull server projects this device doesn't have,
 * and upload local projects the server doesn't have (migration). Idempotent and
 * non-destructive — additive in both directions.
 */
async function reconcile(userId: string): Promise<void> {
  useProjectSyncStore.getState().setPhase('loading');
  try {
    const summaries = await fetchProjectList();
    const serverIds = new Set(summaries.map((s) => s.id));
    const localIds = new Set(syncableIds(useProjectStore.getState()));

    // Server -> local: fetch full bundles for projects this device is missing.
    const toPull = summaries.filter((s) => !localIds.has(s.id));
    const pulled: ProjectBundle[] = [];
    for (const summary of toPull) {
      try {
        const full = await fetchProject(summary.id);
        if (full?.data) pulled.push(full.data);
      } catch (error) {
        projectsDebug('project pull failed', {
          projectId: summary.id,
          message: error instanceof Error ? error.message : 'error',
        });
      }
    }
    const addedIds = applyBundles(pulled);
    for (const id of addedIds) {
      useProjectSyncStore.getState().setProjectSync(id, { state: 'saved', updatedAt: Date.now() });
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

    knownProjectIds = new Set(syncableIds(useProjectStore.getState()));
    useProjectSyncStore.getState().markPulled(migratedCount);
    projectsDebug('project sync reconciled', {
      userId,
      pulled: addedIds.length,
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
  knownProjectIds = new Set();
  useProjectSyncStore.getState().reset();
}

/** Force an immediate re-pull from the server (e.g. a "retry sync" button). */
export function refreshProjectsFromServer(): void {
  if (activeUserId) void reconcile(activeUserId);
}

// Track browser online/offline so the UI can show an offline state.
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    useProjectSyncStore.getState().setOnline(true);
    refreshProjectsFromServer();
  });
  window.addEventListener('offline', () => useProjectSyncStore.getState().setOnline(false));
}
