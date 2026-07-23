// Cross-tab conflict merge for the persisted project store blob.
//
// The project store persists as ONE whole-store localStorage value (Zustand
// `persist` envelope `{ state, version }`), debounced per tab. Two open Synapse
// tabs therefore race last-writer-wins on the ENTIRE store: a stale background
// tab (hydrated before the other tab's work landed) that flushes any write —
// including its unload flush — silently reverts everything the other tab
// persisted since. In a freshly generated project the mockup spec version is
// the LAST thing written, so it is exactly what such a clobber deletes; on the
// next boot the artifact auto-resume then sees "mockup missing for this spine"
// and silently regenerates it (and its paid images).
//
// `mergePersistedProjectBlobs` is the write-time guard's resolver
// (`registerCrossTabMerge` in src/store/storage.ts): given the blob currently
// in localStorage (written by another tab) and the blob this tab is about to
// write, it produces a union that keeps, PER PROJECT, the side that shows the
// most recent activity. A project's slices are always taken wholesale from one
// side, so every project stays an internally-consistent snapshot (version
// arrays, preferred flags, and history all agree). Projects present on only
// one side are kept — losing brand-new work is strictly worse than the rare
// resurrection of a project deleted concurrently in another tab (server sync
// re-applies remote deletions for signed-in users).
//
// PURE — no store or storage imports (storage.ts must stay import-cycle-free).

import { ARRAY_COLLECTIONS } from './projectBundle';

interface PersistedEnvelope {
  state?: Record<string, unknown>;
  version?: number;
}

type ProjectMap = Record<string, { createdAt?: unknown } | undefined>;
type CollectionMap = Record<string, unknown[] | undefined>;

function parseEnvelope(raw: string): PersistedEnvelope | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const state = (parsed as PersistedEnvelope).state;
    if (!state || typeof state !== 'object') return null;
    return parsed as PersistedEnvelope;
  } catch {
    return null;
  }
}

function projectsOf(envelope: PersistedEnvelope): ProjectMap {
  const projects = envelope.state?.projects;
  return projects && typeof projects === 'object' ? (projects as ProjectMap) : {};
}

const toEpoch = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

/**
 * Newest activity timestamp we can attribute to `projectId` in a persisted
 * state: the max over the project record's own stamps and every record in the
 * project-keyed collections (generic `createdAt`/`updatedAt` fields, so future
 * collections participate without registration). Used only to arbitrate a
 * cross-tab conflict, which is rare — the O(records) scan is fine.
 */
export function latestProjectActivity(state: Record<string, unknown>, projectId: string): number {
  let latest = 0;
  const projects = state.projects;
  if (projects && typeof projects === 'object') {
    const record = (projects as ProjectMap)[projectId];
    if (record && typeof record === 'object') {
      latest = Math.max(latest, toEpoch((record as Record<string, unknown>).createdAt));
    }
  }
  for (const key of ARRAY_COLLECTIONS) {
    const map = state[key];
    if (!map || typeof map !== 'object') continue;
    const rows = (map as CollectionMap)[projectId];
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue;
      const r = row as Record<string, unknown>;
      latest = Math.max(latest, toEpoch(r.updatedAt), toEpoch(r.createdAt));
    }
  }
  return latest;
}

/**
 * Merge the blob another tab stored (`storedRaw`) with the blob this tab wants
 * to write (`oursRaw`) into the value that should actually be persisted.
 *
 * - Per project id (union of both sides): the side with the newer
 *   `latestProjectActivity` wins WHOLESALE — its project record and its entry
 *   in every project-keyed collection are taken together; ties go to ours.
 * - Projects on only one side are kept (union).
 * - Non-collection keys and the envelope `version` come from ours.
 * - If either blob does not parse as a persist envelope, ours is returned
 *   unchanged (never let a corrupt blob poison the write).
 */
export function mergePersistedProjectBlobs(storedRaw: string, oursRaw: string): string {
  if (storedRaw === oursRaw) return oursRaw;
  const stored = parseEnvelope(storedRaw);
  const ours = parseEnvelope(oursRaw);
  if (!stored || !ours) return oursRaw;

  const storedState = stored.state as Record<string, unknown>;
  const oursState = ours.state as Record<string, unknown>;
  const storedProjects = projectsOf(stored);
  const oursProjects = projectsOf(ours);

  const ids = new Set([...Object.keys(storedProjects), ...Object.keys(oursProjects)]);
  let changed = false;

  // Start from ours; graft in every project the stored side wins.
  const mergedState: Record<string, unknown> = { ...oursState };
  const mergedProjects: ProjectMap = { ...oursProjects };
  const mergedCollections: Record<string, CollectionMap> = {};
  for (const key of ARRAY_COLLECTIONS) {
    const map = oursState[key];
    mergedCollections[key] = map && typeof map === 'object' ? { ...(map as CollectionMap) } : {};
  }

  for (const id of ids) {
    const inStored = id in storedProjects;
    const inOurs = id in oursProjects;
    const storedWins = inStored
      && (!inOurs || latestProjectActivity(storedState, id) > latestProjectActivity(oursState, id));
    if (!storedWins) continue;
    changed = true;
    mergedProjects[id] = storedProjects[id];
    for (const key of ARRAY_COLLECTIONS) {
      const storedMap = storedState[key];
      const rows = storedMap && typeof storedMap === 'object' ? (storedMap as CollectionMap)[id] : undefined;
      // Take the winning side's entry wholesale — including its ABSENCE, so the
      // grafted project stays one coherent snapshot.
      if (Array.isArray(rows)) mergedCollections[key][id] = rows;
      else delete mergedCollections[key][id];
    }
  }

  if (!changed) return oursRaw;
  mergedState.projects = mergedProjects;
  for (const key of ARRAY_COLLECTIONS) {
    mergedState[key] = mergedCollections[key];
  }
  return JSON.stringify({ ...ours, state: mergedState });
}
