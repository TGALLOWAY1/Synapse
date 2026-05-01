import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ProjectState } from './types';
import { createDebouncedStorage } from './storage';
import { createProjectSlice } from './slices/projectSlice';
import { createSpineSlice } from './slices/spineSlice';
import { createBranchSlice } from './slices/branchSlice';
import { createArtifactSlice } from './slices/artifactSlice';
import { createFeedbackSlice } from './slices/feedbackSlice';
import { createStalenessSlice } from './slices/stalenessSlice';
import { createGenerationJobsSlice } from './slices/generationJobsSlice';
import { createPrdProgressSlice } from './slices/prdProgressSlice';

export type { ProjectState } from './types';

export const useProjectStore = create<ProjectState>()(
    persist(
        (...a) => ({
            ...createProjectSlice(...a),
            ...createSpineSlice(...a),
            ...createBranchSlice(...a),
            ...createArtifactSlice(...a),
            ...createFeedbackSlice(...a),
            ...createStalenessSlice(...a),
            ...createGenerationJobsSlice(...a),
            ...createPrdProgressSlice(...a),
        }),
        {
            name: 'synapse-projects-storage',
            storage: createDebouncedStorage(500),
            partialize: (state) => {
                // Strip transient generation status from persisted state.
                const { jobs: _jobs, prdProgress: _prdProgress, ...persisted } = state;
                void _jobs;
                void _prdProgress;
                return persisted;
            },
            onRehydrateStorage: () => {
                return (state) => {
                    if (!state) return;
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
