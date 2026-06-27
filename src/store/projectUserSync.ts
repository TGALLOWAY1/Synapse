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
} from './userScope';

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
export function applyProjectUser(userId: string | null): void {
  if (userId === getActiveProjectUser()) return;

  setActiveProjectUser(userId);

  // Clear current in-memory state, then rehydrate from the new namespace.
  // rehydrate() merges persisted data over current state, so wiping first is
  // what guarantees isolation when the new namespace is empty.
  useProjectStore.setState(emptyPersistedState());
  void useProjectStore.persist.rehydrate();
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
