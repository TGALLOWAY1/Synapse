// Orchestrates switching the project store between users.
//
// When the authenticated user changes (login, logout, session refresh), the
// in-memory project state must be cleared and re-hydrated from that user's
// namespaced localStorage key — otherwise one account's projects would leak
// into another's namespace on the next write.
//
// Imports both the store and userScope, so it must NOT be imported by either
// of them (that would create a cycle). It is driven from authStore.

import { useProjectStore } from './projectStore';
import {
  getActiveProjectUser,
  setActiveProjectUser,
  importLegacyProjectsForUser,
  mergeNamespaceInto,
} from './userScope';
import { projectsDebug } from '../lib/projectsDebug';

// Re-export the offer/decline helpers so UI imports a single store-facing
// module rather than reaching into userScope directly.
export { getLegacyImportOffer, declineLegacyImport } from './userScope';

// Fresh, empty values for every persisted collection. Used to wipe in-memory
// state before rehydrating from a different user's namespace so nothing from
// the previous account survives the switch.
function emptyPersistedState() {
  return {
    projects: {},
    spineVersions: {},
    historyEvents: {},
    branches: {},
    artifacts: {},
    artifactVersions: {},
    feedbackItems: {},
    tasks: {},
    workflowRuns: {},
    reviewRuns: {},
    specialistRuns: {},
    reviewFindings: {},
    reviewIssues: {},
    planningRecords: {},
  };
}

/**
 * Point the project store at `userId`'s namespace. No-ops when the user is
 * unchanged so a repeated session refresh never clobbers in-memory work.
 *
 * Pre-existing anonymous projects are NO LONGER silently adopted here — that
 * silently handed one user's pre-sign-in projects to whichever account signed
 * in first. Adoption is now an explicit, opt-in action (see
 * `getLegacyImportOffer` / `importLegacyProjects`).
 */
/**
 * Re-issue a persist write of the current in-memory persisted slices. Used
 * right after a rehydrate to supersede the debounced "empty wipe" write queued
 * by `setState(emptyPersistedState())` (see applyProjectUser).
 */
function repersistCurrentState(): void {
  const s = useProjectStore.getState();
  useProjectStore.setState({
    projects: s.projects,
    spineVersions: s.spineVersions,
    historyEvents: s.historyEvents,
    branches: s.branches,
    artifacts: s.artifacts,
    artifactVersions: s.artifactVersions,
    feedbackItems: s.feedbackItems,
    tasks: s.tasks,
    workflowRuns: s.workflowRuns,
    reviewRuns: s.reviewRuns,
    specialistRuns: s.specialistRuns,
    reviewFindings: s.reviewFindings,
    reviewIssues: s.reviewIssues,
    planningRecords: s.planningRecords,
  });
}

/**
 * Recover projects that live under accounts the server has merged into this one
 * (account linking — see R3). Merges each absorbed userId's namespace into the
 * canonical one (additive; idempotent). Returns true if anything was merged.
 */
function recoverMergedNamespaces(userId: string | null, mergedUserIds: string[]): boolean {
  if (!userId || mergedUserIds.length === 0) return false;
  let changed = false;
  for (const mergedId of mergedUserIds) {
    try {
      if (mergeNamespaceInto(userId, mergedId)) {
        changed = true;
        projectsDebug('recovered merged-account namespace', { from: mergedId, into: userId });
      }
    } catch {
      // Non-fatal — never let namespace recovery break sign-in.
    }
  }
  return changed;
}

export function applyProjectUser(userId: string | null, mergedUserIds: string[] = []): void {
  // Recover absorbed-account projects first, regardless of whether the active
  // namespace is changing — a link can add mergedUserIds without changing the
  // signed-in userId.
  const recovered = recoverMergedNamespaces(userId, mergedUserIds);

  const previous = getActiveProjectUser();
  if (userId === previous) {
    // Same user already active. If we just recovered merged projects into the
    // namespace, rehydrate so they appear without a manual refresh.
    if (recovered) {
      const r = useProjectStore.persist.rehydrate() as { then?: (cb: () => void) => void } | undefined;
      if (r && typeof r.then === 'function') r.then(() => repersistCurrentState());
      else repersistCurrentState();
    }
    return;
  }

  setActiveProjectUser(userId);

  // Clear current in-memory state, then rehydrate from the new namespace.
  // rehydrate() merges persisted data over current state, so wiping first is
  // what guarantees isolation when the new namespace is empty.
  //
  // IMPORTANT — data-loss guard: `setState(emptyPersistedState())` queues a
  // *debounced* persist write of the EMPTY state to the new namespace. Zustand's
  // rehydrate() loads the stored data into memory using the raw setter and does
  // NOT itself persist, so without the re-persist below the queued empty write
  // would flush ~500ms later and clobber this namespace's stored projects
  // whenever the user switched in without immediately mutating the store. We
  // re-persist the freshly-rehydrated state so the correct data is the last
  // queued write. (rehydrate() resolves synchronously for our sync storage.)
  useProjectStore.setState(emptyPersistedState());

  const finish = () => {
    repersistCurrentState();
    const count = Object.keys(useProjectStore.getState().projects).length;
    projectsDebug('namespace switched', { from: previous, to: userId, projectsLoaded: count });
  };

  const result = useProjectStore.persist.rehydrate() as { then?: (cb: () => void) => void } | undefined;
  if (result && typeof result.then === 'function') {
    result.then(finish);
  } else {
    finish();
  }
}

/**
 * Explicit, user-initiated import of pre-sign-in anonymous projects into the
 * active user's namespace. Rehydrates the store on success so the imported
 * projects appear immediately. Returns true if anything was imported.
 */
export function importLegacyProjects(userId: string): boolean {
  const imported = importLegacyProjectsForUser(userId);
  if (imported) void useProjectStore.persist.rehydrate();
  return imported;
}
