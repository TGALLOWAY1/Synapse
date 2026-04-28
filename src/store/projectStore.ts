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
        }),
        {
            name: 'synapse-projects-storage',
            storage: createDebouncedStorage(500),
            partialize: (state) => {
                // Strip transient generation job status from persisted state.
                const { jobs: _jobs, ...persisted } = state;
                void _jobs;
                return persisted;
            },
            onRehydrateStorage: () => {
                return (state) => {
                    if (!state) return;
                    // Migrate legacy currentStage values.
                    for (const projectId of Object.keys(state.projects)) {
                        const project = state.projects[projectId];
                        const stage = project.currentStage as string | undefined;
                        if (stage === 'devplan' || stage === 'prompts') {
                            state.projects[projectId] = { ...project, currentStage: 'artifacts' };
                            continue;
                        }
                        if (stage === 'mockups' || stage === 'artifacts') {
                            const spines = state.spineVersions[projectId] || [];
                            const isFinal = spines.some(s => s.isFinal);
                            if (isFinal) {
                                state.projects[projectId] = { ...project, currentStage: 'workspace' };
                            }
                        }
                    }
                };
            },
        }
    )
);
