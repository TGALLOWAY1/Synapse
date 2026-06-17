// Per-user namespacing for the client-side project store.
//
// Projects live entirely in localStorage (Zustand `persist`). To isolate one
// account's projects from another's in the same browser, we suffix the storage
// key with the active user's id. This module is the single source of truth for
// "which localStorage key is the project store reading/writing right now".
//
// It is intentionally a LEAF module (only touches localStorage) so it can be
// imported by `storage.ts` without creating an import cycle with the store
// itself. The orchestration that resets + rehydrates the store on a user switch
// lives in `projectUserSync.ts`.

const BASE_NAME = 'synapse-projects-storage';

// One-time adoption marker. When the very first account signs in on a browser
// that already has anonymous/legacy projects under BASE_NAME, those projects
// are copied into that account's namespace and BASE_NAME is recorded as
// "claimed" so a *different* account that later signs in on the same browser
// does not also inherit them.
const CLAIM_KEY = 'synapse-projects-legacy-claimed-by';

let activeUserId: string | null = null;

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
    // localStorage unavailable / full — non-fatal for namespacing.
  }
}

/** localStorage key for a given user (or the legacy/anonymous key when null). */
export function namespaceFor(userId: string | null): string {
  return userId ? `${BASE_NAME}::u:${userId}` : BASE_NAME;
}

/** The storage key the project store should currently read/write. */
export function resolveProjectStorageName(): string {
  return namespaceFor(activeUserId);
}

export function getActiveProjectUser(): string | null {
  return activeUserId;
}

export function setActiveProjectUser(userId: string | null): void {
  activeUserId = userId;
}

/**
 * One-time, non-destructive migration: when an account first signs in on a
 * browser that has pre-existing anonymous projects (and they haven't already
 * been claimed by another account), copy them into this account's namespace.
 * The original legacy data is left untouched.
 *
 * Returns true if data was adopted (the store should rehydrate from the new
 * namespace afterwards).
 */
export function adoptLegacyProjectsForUser(userId: string): boolean {
  if (!userId) return false;
  const nsKey = namespaceFor(userId);
  // Already has its own namespaced data — nothing to adopt.
  if (safeGet(nsKey) !== null) return false;

  const legacy = safeGet(BASE_NAME);
  if (legacy === null) return false;

  const claimedBy = safeGet(CLAIM_KEY);
  if (claimedBy && claimedBy !== userId) return false;

  safeSet(nsKey, legacy);
  safeSet(CLAIM_KEY, userId);
  return true;
}
