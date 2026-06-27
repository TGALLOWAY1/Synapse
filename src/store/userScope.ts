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

// Persisted Zustand collections that are keyed by project id (or, for
// `projects`, by project id). A legacy-import merges these additively so a
// user can recover pre-namespacing projects without overwriting any project
// they already own (existing ids always win). Keep in sync with
// `emptyPersistedState()` in projectUserSync.ts.
const MERGEABLE_COLLECTIONS = [
  'projects',
  'spineVersions',
  'historyEvents',
  'branches',
  'artifacts',
  'artifactVersions',
  'feedbackItems',
  'tasks',
  'workflowRuns',
] as const;

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

/** Parse a persisted Zustand blob's project-id map for a given collection. */
function readProjectsMap(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    const projects = parsed?.state?.projects;
    return projects && typeof projects === 'object' ? (projects as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Number of anonymous/legacy projects available under BASE_NAME (0 if none). */
export function countLegacyProjects(): number {
  return Object.keys(readProjectsMap(safeGet(BASE_NAME))).length;
}

/**
 * Number of legacy (base-key) projects that are NOT already present in
 * `userId`'s namespace — i.e. the count a merge-import would actually add. This
 * is what we surface in the offer so a user who already has some of their
 * projects isn't told there are more to import when there aren't.
 */
function countImportableForUser(userId: string): number {
  const legacyProjects = readProjectsMap(safeGet(BASE_NAME));
  const legacyIds = Object.keys(legacyProjects);
  if (legacyIds.length === 0) return 0;
  const ownProjects = readProjectsMap(safeGet(namespaceFor(userId)));
  return legacyIds.filter((id) => !(id in ownProjects)).length;
}

/**
 * Whether `userId` should be offered the "import/recover projects created
 * before you signed in" prompt. Available when:
 *   - there are base-key projects this user does NOT already have, and
 *   - no OTHER account has already claimed the base-key data, and
 *   - this user hasn't already imported (claimed) or declined the offer.
 *
 * Unlike the original implementation this NO LONGER bails just because the user
 * has some namespaced data of their own — that one-shot rule permanently
 * stranded pre-namespacing projects the moment a user created a single new
 * project. The import is additive (see importLegacyProjectsForUser), so it is
 * safe to keep offering recovery until the data is claimed or declined.
 *
 * There is still NO silent adoption — a different account can never inherit
 * another user's pre-sign-in projects without an explicit, informed click.
 */
export function getLegacyImportOffer(userId: string | null): { available: boolean; projectCount: number } {
  if (!userId) return { available: false, projectCount: 0 };
  const claimedBy = safeGet(CLAIM_KEY);
  // Claimed by this same user already ⇒ they've imported; claimed by another ⇒
  // not theirs to take. Either way, don't offer.
  if (claimedBy) return { available: false, projectCount: 0 };
  if (readDeclined().includes(userId)) return { available: false, projectCount: 0 };
  const projectCount = countImportableForUser(userId);
  return { available: projectCount > 0, projectCount };
}

/**
 * Explicit, user-initiated import: non-destructively MERGE the base-key
 * projects into `userId`'s namespace and claim them so no other account is
 * offered them. Existing ids in the user's namespace always win — an import can
 * only ADD projects, never overwrite or delete one the user already has. The
 * original legacy data under BASE_NAME is left untouched.
 *
 * Returns true if anything was imported (the store should rehydrate afterwards).
 */
export function importLegacyProjectsForUser(userId: string): boolean {
  if (!userId) return false;

  const legacyRaw = safeGet(BASE_NAME);
  if (legacyRaw === null) return false;

  const claimedBy = safeGet(CLAIM_KEY);
  if (claimedBy && claimedBy !== userId) return false;

  const nsKey = namespaceFor(userId);
  const ownRaw = safeGet(nsKey);

  // Fast path: the user has no namespaced data yet — copy the whole blob.
  if (ownRaw === null) {
    safeSet(nsKey, legacyRaw);
    safeSet(CLAIM_KEY, userId);
    return true;
  }

  // Merge path: union each project-keyed collection, keeping the user's own
  // entries on any id collision. Fall back to claim-only (no data change) if
  // either blob can't be parsed, so a corrupt blob never destroys data.
  const merged = mergeStoredBlobs(ownRaw, legacyRaw);
  if (!merged) {
    safeSet(CLAIM_KEY, userId);
    return false;
  }
  if (merged.addedProjects === 0) {
    // Nothing new to add (every legacy project already present) — just claim so
    // the offer stops without rewriting the user's blob.
    safeSet(CLAIM_KEY, userId);
    return false;
  }

  safeSet(nsKey, merged.json);
  safeSet(CLAIM_KEY, userId);
  return true;
}

/**
 * Additively merge a `source` persisted blob into a `target` persisted blob,
 * unioning every project-keyed collection. Existing ids in `target` always win,
 * so a merge can only ADD entries, never overwrite/delete one. Returns the
 * serialized merged blob and how many *projects* were added, or null if either
 * blob can't be parsed (so a corrupt blob never destroys data).
 */
function mergeStoredBlobs(targetRaw: string, sourceRaw: string): { json: string; addedProjects: number } | null {
  try {
    const target = JSON.parse(targetRaw);
    const source = JSON.parse(sourceRaw);
    const targetState = target?.state ?? {};
    const sourceState = source?.state ?? {};
    let added = 0;
    for (const key of MERGEABLE_COLLECTIONS) {
      const sourceMap = sourceState[key];
      if (!sourceMap || typeof sourceMap !== 'object') continue;
      const targetMap = (targetState[key] && typeof targetState[key] === 'object') ? targetState[key] : {};
      const nextMap: Record<string, unknown> = { ...targetMap };
      for (const id of Object.keys(sourceMap)) {
        if (!(id in nextMap)) {
          nextMap[id] = sourceMap[id];
          if (key === 'projects') added += 1;
        }
      }
      targetState[key] = nextMap;
    }
    target.state = targetState;
    return { json: JSON.stringify(target), addedProjects: added };
  } catch {
    return null;
  }
}

/**
 * Merge the project namespace of `sourceUserId` into `canonicalUserId`'s
 * namespace (additive; existing ids win). Used when the server reports that an
 * account was merged into this one (`mergedUserIds`) so projects created under a
 * now-defunct divergent userId — e.g. from signing in with a different provider
 * before the accounts were linked — are recovered. Non-destructive: the source
 * namespace is left untouched, so the merge is idempotent across reloads.
 * Returns true if the canonical namespace was changed.
 */
export function mergeNamespaceInto(canonicalUserId: string | null, sourceUserId: string): boolean {
  if (!canonicalUserId || !sourceUserId || canonicalUserId === sourceUserId) return false;
  const sourceRaw = safeGet(namespaceFor(sourceUserId));
  if (sourceRaw === null) return false;
  const targetKey = namespaceFor(canonicalUserId);
  const targetRaw = safeGet(targetKey);
  if (targetRaw === null) {
    safeSet(targetKey, sourceRaw);
    return true;
  }
  const merged = mergeStoredBlobs(targetRaw, sourceRaw);
  if (!merged || merged.addedProjects === 0) return false;
  safeSet(targetKey, merged.json);
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
