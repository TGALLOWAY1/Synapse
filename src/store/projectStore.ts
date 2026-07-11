import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ProjectState } from './types';
import { createDebouncedStorage } from './storage';
import { resolveProjectStorageName } from './userScope';
import { createProjectSlice } from './slices/projectSlice';
import { createSpineSlice } from './slices/spineSlice';
import { createBranchSlice } from './slices/branchSlice';
import { createArtifactSlice } from './slices/artifactSlice';
import { createFeedbackSlice } from './slices/feedbackSlice';
import { createStalenessSlice } from './slices/stalenessSlice';
import { createGenerationJobsSlice } from './slices/generationJobsSlice';
import { createPrdProgressSlice } from './slices/prdProgressSlice';
import { createTasksSlice } from './slices/tasksSlice';
import { createMetricsSlice } from './slices/metricsSlice';
import { markInterruptedGenerations } from './interruptedGeneration';
import { guardProjectStoreActions } from '../lib/projectCapabilities';

export type { ProjectState } from './types';

export const useProjectStore = create<ProjectState>()(
    persist(
        (...a) => guardProjectStoreActions({
            ...createProjectSlice(...a),
            ...createSpineSlice(...a),
            ...createBranchSlice(...a),
            ...createArtifactSlice(...a),
            ...createFeedbackSlice(...a),
            ...createStalenessSlice(...a),
            ...createGenerationJobsSlice(...a),
            ...createPrdProgressSlice(...a),
            ...createTasksSlice(...a),
            ...createMetricsSlice(...a),
        }),
        {
            name: 'synapse-projects-storage',
            // The resolver namespaces the persisted key by the active user so
            // accounts don't share projects in one browser (see userScope.ts).
            storage: createDebouncedStorage(500, () => resolveProjectStorageName()),
            partialize: (state) => {
                // Strip transient generation status from persisted state.
                const { jobs: _jobs, prdProgress: _prdProgress, prdSectionStatus: _prdSectionStatus, ...persisted } = state;
                void _jobs;
                void _prdProgress;
                void _prdSectionStatus;
                return persisted;
            },
            onRehydrateStorage: () => {
                return (state) => {
                    if (!state) return;
                    // A page load kills any in-flight PRD pipeline, so spines
                    // persisted mid-generation must be converted to a settled
                    // error — otherwise the UI shows "Generating…" forever.
                    markInterruptedGenerations(state.spineVersions);
                    // Migrate legacy currentStage values. The active pipeline
                    // bar exposes only prd / workspace / history, so any
                    // lingering 'devplan' / 'prompts' / 'mockups' / 'artifacts'
                    // value must be coerced to a value the bar can render.
                    for (const projectId of Object.keys(state.projects)) {
                        const project = state.projects[projectId];
                        const stage = project.currentStage as string | undefined;
                        if (stage !== 'devplan' && stage !== 'prompts' && stage !== 'mockups' && stage !== 'artifacts') continue;
                        const spines = state.spineVersions[projectId] || [];
                        const isFinal = spines.some(s => s.isFinal);
                        state.projects[projectId] = {
                            ...project,
                            currentStage: isFinal ? 'workspace' : 'prd',
                        };
                    }
                };
            },
        }
    )
);
