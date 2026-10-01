import { create } from 'zustand';

// UI-facing sync state for server-backed projects. The orchestrator
// (projectServerSync.ts) drives this store; components read it to render the
// loading / saving / saved / sync-failed / unsaved states.

export type SyncPhase =
  | 'idle' // not signed in or nothing to sync
  | 'loading' // initial pull from the server in flight
  | 'ready' // pulled at least once, in steady state
  | 'error'; // last pull/push failed (local data is intact)

export type ProjectSyncState = 'saving' | 'saved' | 'error' | 'dirty' | 'conflict';

export interface ProjectSyncInfo {
  state: ProjectSyncState;
  updatedAt: number;
  error?: string;
  /** Epoch ms of the last successful cloud save (mirrors durable meta so the UI
   *  can show "Synced 2m ago" without reaching into localStorage). */
  lastCloudSavedAt?: number;
  /** Last failed cloud-save message, surfaced next to the status indicator. */
  lastCloudSaveError?: string;
  /** True when the server copy advanced on another device while this device has
   *  unsynced edits. Carries the details needed to resolve the conflict. */
  conflict?: ProjectConflictInfo;
}

export interface ProjectConflictInfo {
  /** Server revision that superseded this device's last-seen revision. */
  serverRevision?: number;
  /** Server `updatedAt` of the superseding version (ISO string). */
  serverUpdatedAt?: string;
  /** How the conflict was detected: during the sign-in reconcile, or when a
   *  push was rejected because the server had advanced. */
  detectedAt: 'reconcile' | 'push';
}

interface SyncStore {
  /** Overall sync phase for the active user. */
  phase: SyncPhase;
  /** Whether the browser currently reports online. */
  online: boolean;
  /** Timestamp of the last successful pull. */
  lastPulledAt: number | null;
  /** Last overall error message (pull failure), if any. */
  error: string | null;
  /** Count of local projects uploaded during the most recent reconcile. */
  migratedCount: number;
  /** Projects whose cloud copy could not be downloaded during the most recent
   *  reconcile (a per-project fetch failed while the rest synced) — a partial
   *  failure, reported alongside phase 'ready'. Empty after a clean pull. */
  failedPullIds: string[];
  /** Per-project sync status. */
  projects: Record<string, ProjectSyncInfo>;

  setPhase: (phase: SyncPhase, error?: string | null) => void;
  setOnline: (online: boolean) => void;
  markPulled: (migratedCount: number, failedPullIds?: string[]) => void;
  setProjectSync: (projectId: string, info: ProjectSyncInfo) => void;
  /** Merge a partial update into a project's sync info (preserves other fields
   *  like a standing conflict or last-saved timestamp). */
  patchProjectSync: (projectId: string, patch: Partial<ProjectSyncInfo>) => void;
  removeProjectSync: (projectId: string) => void;
  reset: () => void;
}

// Stable empty list so a clean reconcile never hands selectors a fresh array.
const NO_FAILED_PULLS: string[] = [];

export const useProjectSyncStore = create<SyncStore>((set) => ({
  phase: 'idle',
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
  lastPulledAt: null,
  error: null,
  migratedCount: 0,
  failedPullIds: NO_FAILED_PULLS,
  projects: {},

  setPhase: (phase, error = null) => set({ phase, error: error ?? null }),
  setOnline: (online) => set({ online }),
  markPulled: (migratedCount, failedPullIds) =>
    set({
      phase: 'ready',
      error: null,
      lastPulledAt: Date.now(),
      migratedCount,
      failedPullIds: failedPullIds && failedPullIds.length > 0 ? [...failedPullIds] : NO_FAILED_PULLS,
    }),
  setProjectSync: (projectId, info) =>
    set((s) => ({ projects: { ...s.projects, [projectId]: info } })),
  patchProjectSync: (projectId, patch) =>
    set((s) => {
      const prev = s.projects[projectId];
      const base: ProjectSyncInfo = prev ?? { state: 'saved', updatedAt: Date.now() };
      return { projects: { ...s.projects, [projectId]: { ...base, ...patch } } };
    }),
  removeProjectSync: (projectId) =>
    set((s) => {
      if (!(projectId in s.projects)) return s;
      const next = { ...s.projects };
      delete next[projectId];
      return { projects: next };
    }),
  reset: () => set({
    phase: 'idle',
    lastPulledAt: null,
    error: null,
    migratedCount: 0,
    failedPullIds: NO_FAILED_PULLS,
    projects: {},
  }),
}));
