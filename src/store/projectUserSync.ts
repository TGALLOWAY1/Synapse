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
import { adoptLegacyProjectsForUser, getActiveProjectUser, setActiveProjectUser } from './userScope';

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
  };
}

/**
 * Point the project store at `userId`'s namespace, adopting any pre-existing
 * anonymous projects on first sign-in. No-ops when the user is unchanged so a
 * repeated session refresh never clobbers in-memory work.
 */
export function applyProjectUser(userId: string | null): void {
  if (userId === getActiveProjectUser()) return;

  if (userId) {
    // Non-destructive: copies legacy anonymous projects into this account's
    // namespace the first time any account signs in on this browser.
    adoptLegacyProjectsForUser(userId);
  }

  setActiveProjectUser(userId);

  // Clear current in-memory state, then rehydrate from the new namespace.
  // rehydrate() merges persisted data over current state, so wiping first is
  // what guarantees isolation when the new namespace is empty.
  useProjectStore.setState(emptyPersistedState());
  void useProjectStore.persist.rehydrate();
}
