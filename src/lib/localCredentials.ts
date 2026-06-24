// Per-user namespacing for the optional "local browser keys" credential
// fallback (GEMINI_API_KEY / OPENAI_API_KEY / GITHUB_TOKEN).
//
// These were historically stored under un-namespaced localStorage keys, so any
// account signing in on the same browser could read the previous user's key.
// We now suffix each key with the active user's id (the same id userScope uses
// to namespace the project store) so one account's local keys are invisible to
// another. Anonymous (signed-out) usage keeps the bare key.
//
// A one-time, per-key migration moves any pre-existing un-namespaced key into
// the active user's namespace and deletes the shared global copy — strictly
// reducing exposure (the shared global is removed) while preserving the user's
// own key.
//
// Leaf module: only touches localStorage + reads the active user from
// userScope (which imports nothing here), so it can be used by the low-level AI
// clients without an import cycle.

import { getActiveProjectUser } from '../store/userScope';

export const GEMINI_API_KEY = 'GEMINI_API_KEY';
export const OPENAI_API_KEY = 'OPENAI_API_KEY';
export const GITHUB_TOKEN = 'GITHUB_TOKEN';

export const LOCAL_CREDENTIAL_BASE_KEYS = [
  GEMINI_API_KEY,
  OPENAI_API_KEY,
  GITHUB_TOKEN,
] as const;

function namespaced(base: string, userId: string | null): string {
  return userId ? `${base}::u:${userId}` : base;
}

function safeGetRaw(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSetRaw(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // localStorage unavailable (private mode, etc.) — non-fatal.
  }
}

function safeRemoveRaw(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

// Move a legacy un-namespaced key into the active user's namespace once, then
// delete the shared global copy. No-op when signed out or already migrated.
function migrateLegacyKey(base: string, userId: string | null): void {
  if (!userId) return;
  const nsKey = namespaced(base, userId);
  if (safeGetRaw(nsKey) !== null) return; // already namespaced for this user
  const legacy = safeGetRaw(base);
  if (legacy === null) return; // nothing to migrate
  safeSetRaw(nsKey, legacy);
  safeRemoveRaw(base); // remove the globally-readable copy
}

/** Read a local credential for the active user (migrating any legacy global). */
export function getLocalCredential(base: string): string | null {
  const userId = getActiveProjectUser();
  migrateLegacyKey(base, userId);
  return safeGetRaw(namespaced(base, userId));
}

/** Write a local credential for the active user. */
export function setLocalCredential(base: string, value: string): void {
  const userId = getActiveProjectUser();
  safeSetRaw(namespaced(base, userId), value);
  // Defensively drop any stale shared global so another account can't read it.
  if (userId) safeRemoveRaw(base);
}

/** Remove a local credential for the active user. */
export function removeLocalCredential(base: string): void {
  const userId = getActiveProjectUser();
  safeRemoveRaw(namespaced(base, userId));
}

/**
 * Clear the active user's local credential keys (called on explicit logout).
 * Also sweeps any legacy un-namespaced copies for good hygiene.
 */
export function clearLocalCredentialsForActiveUser(): void {
  const userId = getActiveProjectUser();
  for (const base of LOCAL_CREDENTIAL_BASE_KEYS) {
    safeRemoveRaw(namespaced(base, userId));
    safeRemoveRaw(base);
  }
}
