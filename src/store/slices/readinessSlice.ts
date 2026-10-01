import type { StateCreator } from 'zustand';
import type { ProjectState } from '../types';

/**
 * LEGACY, READ-ONLY. The Finalize/readiness-commitment layer (readiness
 * review checkpoints, commit/authorize/reopen events, the materiality gate)
 * was removed; nothing writes these collections any more. They stay in the
 * store — and in `ALL_PROJECT_COLLECTIONS`, snapshots, sync, the recovery
 * bundle, retention, and project deletion — purely so older projects keep
 * round-tripping without losing data. Their `ReadinessReviewed` /
 * `PlanCommitted` / `PlanReopened` history events render as plain timeline
 * entries.
 */
export type ReadinessSlice = Pick<ProjectState,
    | 'readinessReviews'
    | 'readinessCommitmentEvents'
>;

export const createReadinessSlice: StateCreator<ProjectState, [], [], ReadinessSlice> = () => ({
    readinessReviews: {},
    readinessCommitmentEvents: {},
});
