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
// one side are kept — losing brand-new work is strictly worse than a stale
// copy — EXCEPT a project the other tab deleted: both sides' delete tombstones
// (`projectTombstones`, see projectTombstones.ts) are unioned, and a project
// whose tombstone is at least as new as its latest activity is dropped
// instead of resurrected. Activity strictly after the deletion wins (the
// project is kept and its superseded tombstone cleared).
//
// PURE — no store or storage imports (storage.ts must stay import-cycle-free).

import { ARRAY_COLLECTIONS } from './projectBundle';
import {
  isSuppressedByTombstone,
  mergeProjectTombstones,
  pruneProjectTombstones,
  readProjectTombstones,
  type ProjectTombstones,
} from './projectTombstones';

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
 * project-keyed collections (generic `createdAt`/`updatedAt`/`at` fields, so
 * future collections participate without registration; in-place mutations
 * stamp `updatedAt` — see the SpineVersion/Project fields). Used only to
 * arbitrate a cross-tab conflict, which is rare — the O(records) scan is fine.
 */
export function latestProjectActivity(state: Record<string, unknown>, projectId: string): number {
  let latest = 0;
  const projects = state.projects;
  if (projects && typeof projects === 'object') {
    const record = (projects as ProjectMap)[projectId];
    if (record && typeof record === 'object') {
      const r = record as Record<string, unknown>;
      latest = Math.max(latest, toEpoch(r.createdAt), toEpoch(r.updatedAt));
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
      latest = Math.max(latest, toEpoch(r.updatedAt), toEpoch(r.createdAt), toEpoch(r.at));
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
 * - Projects on only one side are kept (union) — unless deleted: delete
 *   tombstones are unioned (newest per id, expired ones pruned) and any
 *   project whose tombstone is at least as new as its winning side's latest
 *   activity is dropped with all its collections. A project with activity
 *   after its tombstone survives and the stale tombstone is cleared.
 * - Other non-collection keys and the envelope `version` come from ours.
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

  // Union both tabs' delete tombstones. A deletion recorded by either tab
  // must survive the other tab's write.
  const oursTombstones = readProjectTombstones(oursState.projectTombstones);
  let mergedTombstones: ProjectTombstones = pruneProjectTombstones(
    mergeProjectTombstones(oursTombstones, readProjectTombstones(storedState.projectTombstones)),
  );

  // Start from ours; graft in every project the stored side wins.
  const mergedState: Record<string, unknown> = { ...oursState };
  const mergedProjects: ProjectMap = { ...oursProjects };
  const mergedCollections: Record<string, CollectionMap> = {};
  for (const key of ARRAY_COLLECTIONS) {
    const map = oursState[key];
    mergedCollections[key] = map && typeof map === 'object' ? { ...(map as CollectionMap) } : {};
  }

  const dropProject = (id: string): void => {
    delete mergedProjects[id];
    for (const key of ARRAY_COLLECTIONS) delete mergedCollections[key][id];
  };

  for (const id of ids) {
    const inStored = id in storedProjects;
    const inOurs = id in oursProjects;
    const storedWins = inStored
      && (!inOurs || latestProjectActivity(storedState, id) > latestProjectActivity(oursState, id));
    const deletedAt = mergedTombstones[id];
    if (deletedAt !== undefined) {
      const winnerActivity = latestProjectActivity(storedWins ? storedState : oursState, id);
      if (isSuppressedByTombstone(deletedAt, winnerActivity)) {
        // Deleted in one tab, still present (stale) in the other: keep it
        // deleted instead of resurrecting it (a stored-only copy is simply
        // not grafted in).
        if (inOurs) {
          dropProject(id);
          changed = true;
        }
        continue;
      }
      // Activity after the deletion wins: the project is kept, and its stale
      // tombstone is cleared so sync treats it as the live project it is.
      mergedTombstones = { ...mergedTombstones };
      delete mergedTombstones[id];
    }
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

  const tombstonesChanged = !sameTombstones(mergedTombstones, oursTombstones);
  if (!changed && !tombstonesChanged) return oursRaw;
  mergedState.projects = mergedProjects;
  for (const key of ARRAY_COLLECTIONS) {
    mergedState[key] = mergedCollections[key];
  }
  mergedState.projectTombstones = mergedTombstones;
  return JSON.stringify({ ...ours, state: mergedState });
}

function sameTombstones(a: ProjectTombstones, b: ProjectTombstones): boolean {
  const aKeys = Object.keys(a);
  if (aKeys.length !== Object.keys(b).length) return false;
  return aKeys.every((id) => b[id] === a[id]);
}
