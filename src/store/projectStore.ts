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
import { createGenerationJobsSlice } from './slices/generationJobsSlice';
import { createPrdProgressSlice } from './slices/prdProgressSlice';
import { createTasksSlice } from './slices/tasksSlice';
import { createMetricsSlice } from './slices/metricsSlice';
import { createReviewSlice } from './slices/reviewSlice';
import { createReadinessSlice } from './slices/readinessSlice';
import { createDownstreamUpdatePlanSlice } from './slices/downstreamUpdatePlanSlice';
import { markInterruptedGenerations } from './interruptedGeneration';
import { markInterruptedReviews } from './interruptedReviews';
import { guardProjectStoreActions } from '../lib/projectCapabilities';
import { sweepRetentionCollections } from '../lib/collectionRetention';

export type { ProjectState } from './types';

export const useProjectStore = create<ProjectState>()(
    persist(
        (...a) => guardProjectStoreActions({
            ...createProjectSlice(...a),
            ...createSpineSlice(...a),
            ...createBranchSlice(...a),
            ...createArtifactSlice(...a),
            ...createFeedbackSlice(...a),
            ...createGenerationJobsSlice(...a),
            ...createPrdProgressSlice(...a),
            ...createTasksSlice(...a),
            ...createMetricsSlice(...a),
            ...createReviewSlice(...a),
            ...createReadinessSlice(...a),
            ...createDownstreamUpdatePlanSlice(...a),
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
                    markInterruptedReviews(state.reviewRuns ?? {}, state.specialistRuns ?? {});
                    state.downstreamUpdatePlans ??= {};
                    state.downstreamUpdatePlanEvents ??= {};
                    state.downstreamArtifactUpdateProposals ??= {};
                    state.downstreamArtifactUpdateReviewEvents ??= {};
                    state.downstreamArtifactUpdateApplications ??= {};
                    state.downstreamArtifactUpdateVerifications ??= {};
                    state.downstreamArtifactUpdateVerificationEvents ??= {};
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
                    // One-time rehydrate-time retention sweep. Write-time
                    // pruning only runs when a NEW root record is appended, so
                    // state that grew past the caps before the caps existed —
                    // or while persistence was failing on quota ("Storage
                    // full" toast) — would otherwise never shrink. This runs
                    // on every hydration: initial boot AND every
                    // `persist.rehydrate()` (per-user namespace switches in
                    // projectUserSync.applyProjectUser, legacy import), so a
                    // different user's oversized namespace is swept the moment
                    // it loads. The sweep is pure and reference-stable: when
                    // nothing exceeds a cap it returns the input references
                    // and we touch nothing (no extra persist, no re-render).
                    const sweep = sweepRetentionCollections({
                        spineVersions: state.spineVersions ?? {},
                        reviewRuns: state.reviewRuns ?? {},
                        specialistRuns: state.specialistRuns ?? {},
                        reviewFindings: state.reviewFindings ?? {},
                        reviewIssues: state.reviewIssues ?? {},
                        readinessReviews: state.readinessReviews ?? {},
                        readinessCommitmentEvents: state.readinessCommitmentEvents ?? {},
                        downstreamUpdatePlans: state.downstreamUpdatePlans,
                        downstreamUpdatePlanEvents: state.downstreamUpdatePlanEvents,
                        downstreamArtifactUpdateProposals: state.downstreamArtifactUpdateProposals,
                        downstreamArtifactUpdateReviewEvents: state.downstreamArtifactUpdateReviewEvents,
                        downstreamArtifactUpdateApplications: state.downstreamArtifactUpdateApplications,
                        downstreamArtifactUpdateVerifications: state.downstreamArtifactUpdateVerifications,
                        downstreamArtifactUpdateVerificationEvents: state.downstreamArtifactUpdateVerificationEvents,
                    });
                    if (sweep.pruned) {
                        // `state` IS the live store state here (zustand set it
                        // with replace before invoking this callback), so an
                        // in-place merge is how the other rehydrate fixups
                        // above land too.
                        Object.assign(state, sweep.collections);
                        // Persist the shrunken state. Zustand does NOT write
                        // back to storage after a normal hydration, and with
                        // our synchronous storage this callback can run while
                        // the store is still being created (module init), so
                        // defer one tick and issue a no-op setState: the
                        // persist middleware wraps setState with a debounced
                        // storage write of the CURRENT state, and the merged
                        // slice references are unchanged, so subscribers'
                        // selector outputs stay stable (no re-render churn).
                        queueMicrotask(() => useProjectStore.setState({}));
                    }
                };
            },
        }
    )
);
