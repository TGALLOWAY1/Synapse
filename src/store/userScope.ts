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

// Import marker. When an account *explicitly* imports the anonymous/legacy
// projects under BASE_NAME, those projects are copied into that account's
// namespace and BASE_NAME is recorded as "claimed" so the offer is never shown
// to any other account afterward (one account ever imports a given anonymous
// dataset). Importing is now opt-in (see getLegacyImportOffer) — there is no
// silent first-signer adoption.
const CLAIM_KEY = 'synapse-projects-legacy-claimed-by';

// Records the user ids that *declined* the import offer, so we don't re-prompt
// them on every sign-in. Declining does NOT claim the data — the legitimate
// owner can still import it later from another sign-in.
const DECLINED_KEY = 'synapse-projects-legacy-declined-by';

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

function readDeclined(): string[] {
  const raw = safeGet(DECLINED_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** Number of anonymous/legacy projects available under BASE_NAME (0 if none). */
export function countLegacyProjects(): number {
  const raw = safeGet(BASE_NAME);
  if (!raw) return 0;
  try {
    const parsed = JSON.parse(raw);
    const projects = parsed?.state?.projects;
    return projects && typeof projects === 'object' ? Object.keys(projects).length : 0;
  } catch {
    return 0;
  }
}

/**
 * Whether `userId` should be offered the "import projects created before you
 * signed in" prompt. Available only when:
 *   - there are anonymous projects under BASE_NAME, and
 *   - this user has no namespaced data of their own yet, and
 *   - no account has already claimed (imported) the anonymous data, and
 *   - this user hasn't already declined the offer.
 *
 * Crucially there is NO silent adoption — a different account can never inherit
 * another user's pre-sign-in projects without an explicit, informed click.
 */
export function getLegacyImportOffer(userId: string | null): { available: boolean; projectCount: number } {
  if (!userId) return { available: false, projectCount: 0 };
  if (safeGet(namespaceFor(userId)) !== null) return { available: false, projectCount: 0 };
  if (safeGet(CLAIM_KEY)) return { available: false, projectCount: 0 };
  if (readDeclined().includes(userId)) return { available: false, projectCount: 0 };
  const projectCount = countLegacyProjects();
  return { available: projectCount > 0, projectCount };
}

/**
 * Explicit, user-initiated import: non-destructively copy the anonymous
 * projects into `userId`'s namespace and claim them so no other account is
 * offered them. The original legacy data under BASE_NAME is left untouched.
 *
 * Returns true if data was imported (the store should rehydrate afterwards).
 */
export function importLegacyProjectsForUser(userId: string): boolean {
  if (!userId) return false;
  const nsKey = namespaceFor(userId);
  // Already has its own namespaced data — nothing to import.
  if (safeGet(nsKey) !== null) return false;

  const legacy = safeGet(BASE_NAME);
  if (legacy === null) return false;

  const claimedBy = safeGet(CLAIM_KEY);
  if (claimedBy && claimedBy !== userId) return false;

  safeSet(nsKey, legacy);
  safeSet(CLAIM_KEY, userId);
  return true;
}

/** Record that `userId` declined the import offer (don't re-prompt them). */
export function declineLegacyImport(userId: string): void {
  if (!userId) return;
  const declined = readDeclined();
  if (!declined.includes(userId)) {
    declined.push(userId);
    safeSet(DECLINED_KEY, JSON.stringify(declined));
  }
}
