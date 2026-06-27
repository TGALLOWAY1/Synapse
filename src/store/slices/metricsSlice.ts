import type { StateCreator } from 'zustand';
import type { WorkflowRun } from '../../types';
import type { ProjectState } from '../types';

// Persisted orchestration-metrics history. Each project keeps a capped, newest-
// first list of WorkflowRun records (PRD generations and artifact bundles) so
// the Metrics dashboard can show real speedup/concurrency/cost numbers across
// sessions. This is a thin, append-only store — all the metric math happens in
// `src/lib/metrics/` before a run reaches `recordWorkflowRun`.

export type MetricsSlice = {
    workflowRuns: Record<string, WorkflowRun[]>;
    recordWorkflowRun: ProjectState['recordWorkflowRun'];
    getWorkflowRuns: ProjectState['getWorkflowRuns'];
    getAllWorkflowRuns: ProjectState['getAllWorkflowRuns'];
    clearWorkflowRuns: ProjectState['clearWorkflowRuns'];
};

// Keep storage bounded — a busy project regenerating repeatedly should not grow
// localStorage without limit. Newest runs are kept.
const RUNS_PER_PROJECT_CAP = 50;

export const createMetricsSlice: StateCreator<ProjectState, [], [], MetricsSlice> = (set, get) => ({
    workflowRuns: {},

    recordWorkflowRun: (run) => {
        set((state) => {
            const existing = state.workflowRuns[run.projectId] ?? [];
            const next = [run, ...existing].slice(0, RUNS_PER_PROJECT_CAP);
            return {
                workflowRuns: { ...state.workflowRuns, [run.projectId]: next },
            };
        });
    },

    getWorkflowRuns: (projectId) => get().workflowRuns[projectId] ?? [],

    getAllWorkflowRuns: () => {
        const all = Object.values(get().workflowRuns).flat();
        // Newest first across all projects.
        return all.sort((a, b) => b.startedAt - a.startedAt);
    },

    clearWorkflowRuns: (projectId) => {
        set((state) => {
            if (!state.workflowRuns[projectId]) return state;
            const next = { ...state.workflowRuns };
            delete next[projectId];
            return { workflowRuns: next };
        });
    },
});
