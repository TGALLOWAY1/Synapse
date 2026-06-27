import { create } from 'zustand';

// UI-facing sync state for server-backed projects. The orchestrator
// (projectServerSync.ts) drives this store; components read it to render the
// loading / saving / saved / sync-failed / unsaved states.

export type SyncPhase =
  | 'idle' // not signed in or nothing to sync
  | 'loading' // initial pull from the server in flight
  | 'ready' // pulled at least once, in steady state
  | 'error'; // last pull/push failed (local data is intact)

export type ProjectSyncState = 'saving' | 'saved' | 'error' | 'dirty';

export interface ProjectSyncInfo {
  state: ProjectSyncState;
  updatedAt: number;
  error?: string;
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
  /** Per-project sync status. */
  projects: Record<string, ProjectSyncInfo>;

  setPhase: (phase: SyncPhase, error?: string | null) => void;
  setOnline: (online: boolean) => void;
  markPulled: (migratedCount: number) => void;
  setProjectSync: (projectId: string, info: ProjectSyncInfo) => void;
  removeProjectSync: (projectId: string) => void;
  reset: () => void;
}

export const useProjectSyncStore = create<SyncStore>((set) => ({
  phase: 'idle',
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
  lastPulledAt: null,
  error: null,
  migratedCount: 0,
  projects: {},

  setPhase: (phase, error = null) => set({ phase, error: error ?? null }),
  setOnline: (online) => set({ online }),
  markPulled: (migratedCount) =>
    set({ phase: 'ready', error: null, lastPulledAt: Date.now(), migratedCount }),
  setProjectSync: (projectId, info) =>
    set((s) => ({ projects: { ...s.projects, [projectId]: info } })),
  removeProjectSync: (projectId) =>
    set((s) => {
      if (!(projectId in s.projects)) return s;
      const next = { ...s.projects };
      delete next[projectId];
      return { projects: next };
    }),
  reset: () => set({ phase: 'idle', lastPulledAt: null, error: null, migratedCount: 0, projects: {} }),
}));
