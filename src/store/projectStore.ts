import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ProjectState } from './types';
import type { OutputRunMarker, SpineVersion } from '../types';
import { createDebouncedStorage, registerCrossTabMerge, registerQuotaRecovery } from './storage';
import { compactPersistedNamespaces, decodePersistedBlob } from './persistCodec';
import { latestProjectActivity, mergePersistedProjectBlobs } from '../lib/crossTabMerge';
import { readOutputRunMarker } from '../lib/outputRunLease';
import { readProjectTombstones } from '../lib/projectTombstones';
import { ALL_PROJECT_COLLECTIONS } from '../lib/projectBundle';
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
import { markInterruptedGenerations, markInterruptedOutputRuns } from './interruptedGeneration';
import { markInterruptedReviews } from './interruptedReviews';
import { guardProjectStoreActions } from '../lib/projectCapabilities';
import { sweepRetentionCollections } from '../lib/collectionRetention';

export type { ProjectState } from './types';

/**
 * Return a spineVersions map with the rebuildable `canonicalSpine` cache
 * removed from every spine, cloning only where something is actually dropped so
 * unchanged arrays keep their reference. Used by `partialize` so the cache never
 * reaches localStorage (it is reconstructed lazily wherever consumed). The live
 * in-memory state is untouched — only the persisted projection is stripped.
 */
export function stripPersistedCanonicalSpines(
    spineVersions: Record<string, SpineVersion[]>,
): Record<string, SpineVersion[]> {
    let changed = false;
    const next: Record<string, SpineVersion[]> = {};
    for (const [projectId, spines] of Object.entries(spineVersions ?? {})) {
        if (!spines.some(spine => spine.canonicalSpine !== undefined)) {
            next[projectId] = spines;
            continue;
        }
        changed = true;
        next[projectId] = spines.map(spine => (
            spine.canonicalSpine === undefined ? spine : { ...spine, canonicalSpine: undefined }
        ));
    }
    return changed ? next : spineVersions;
}

// Re-encode any oversized PLAIN persisted namespace (active, other users',
// and the legacy anonymous blob) into the compressed format BEFORE the store
// hydrates. A device already at the "Storage full" toast only recovers if
// space frees up, and the inactive namespaces are never rewritten by normal
// writes — this sweep is what actually releases their quota. Pure re-encoding
// of identical bytes; see persistCodec.ts.
compactPersistedNamespaces('synapse-projects-storage');

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
                // Drop the rebuildable `canonicalSpine` cache from every persisted
                // spine. It is a deterministic projection of `structuredPRD`
                // reconstructed lazily wherever consumed (coreArtifactService,
                // review manifest), so persisting it only bloats localStorage —
                // the very growth that trips the "Storage full" toast. Edit
                // versions already omit it (spineSlice); this strips it from
                // generation versions and, crucially, retroactively from every
                // pre-existing over-quota store on its next write. Only the
                // persisted copy is dropped — the live in-memory spine keeps its
                // cache for the current session. See docs/CANONICAL_PRD_SPINE.md.
                return { ...persisted, spineVersions: stripPersistedCanonicalSpines(persisted.spineVersions) };
            },
            onRehydrateStorage: () => {
                return (state) => {
                    if (!state) return;
                    // A page load kills any in-flight PRD pipeline, so spines
                    // persisted mid-generation must be converted to a settled
                    // error — otherwise the UI shows "Generating…" forever.
                    markInterruptedGenerations(state.spineVersions);
                    // Same for artifact output runs: a leftover 'running'
                    // marker this tab owned, or whose lease lapsed, becomes
                    // 'interrupted' so the Build view resumes the run
                    // (artifactJobController.resumeIfNeeded). A marker another
                    // live tab is still heartbeating is left 'running'.
                    markInterruptedOutputRuns(state.projects ?? {});
                    markInterruptedReviews(state.reviewRuns ?? {}, state.specialistRuns ?? {});
                    // Legacy blobs predate delete tombstones.
                    state.projectTombstones ??= {};
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

// Cross-tab write safety. Each tab persists the WHOLE store as one debounced
// localStorage value, so without this a stale background tab's flush (any
// change, or its unload flush) last-writer-wins over the entire namespace and
// silently reverts work a fresher tab persisted since — in a freshly generated
// project that is the mockup spec version, the last thing written, which then
// looks "gone" on the next boot and gets silently auto-regenerated
// (artifactJobController.resumeIfNeeded). The storage layer detects the
// under-us change and calls this merge (per-project newest-wins union, pure —
// see src/lib/crossTabMerge.ts) instead of overwriting. After a merged value
// lands, adopt it into memory so this tab's UI and NEXT write include the
// other tab's work natively; deferred a tick because the flush can run inside
// an unload handler or mid-setState.
//
// Adoption deliberately does NOT go through `persist.rehydrate()`: that would
// re-run `onRehydrateStorage`, whose interruption fixups assume a page load
// killed all in-flight work — a project mid-generation in the OTHER tab
// (`generationPhase: 'running'`) would be adopted as a settled "interrupted"
// error here and could then be persisted back over the live run. Instead we
// read the merged blob and setState only the persisted project-keyed
// collections plus the per-user delete tombstones (the merge unions both tabs'
// tombstones and drops the projects they suppress); transient slices (jobs,
// prdProgress) and boot fixups are untouched.
registerCrossTabMerge({
    merge: mergePersistedProjectBlobs,
    onApplied: () => {
        queueMicrotask(() => {
            try {
                const raw = localStorage.getItem(resolveProjectStorageName());
                const json = decodePersistedBlob(raw);
                if (!json) return;
                const parsed = JSON.parse(json) as { state?: Record<string, unknown> };
                const persistedState = parsed?.state;
                if (!persistedState || typeof persistedState !== 'object') return;
                const adopted: Record<string, unknown> = {};
                for (const key of [...ALL_PROJECT_COLLECTIONS, 'projectTombstones'] as const) {
                    const value = persistedState[key];
                    if (value && typeof value === 'object') adopted[key] = value;
                }
                if (Object.keys(adopted).length > 0) {
                    useProjectStore.setState(adopted as Partial<ProjectState>);
                }
            } catch {
                // Adoption is best-effort — this tab just stays on its own view
                // and the next flush re-merges against the stored value again.
            }
        });
    },
});

// Mid-session quota recovery. The rehydrate sweep only runs at load; if a write
// overflows the quota *during* a session (e.g. a burst of review runs) no sweep
// ever fires. Registering this hook lets the storage layer prune the retention
// collections the moment a save fails and retry, warning only if pruning could
// not free enough. Returns true iff it actually removed anything — a truthy
// return schedules a fresh, smaller write through the persist middleware. The
// canonicalSpine cache is stripped from that write by `partialize`, so version
// history shrinks on the retry too even though this sweep never touches it.
registerQuotaRecovery(() => {
    const state = useProjectStore.getState();
    const sweep = sweepRetentionCollections({
        spineVersions: state.spineVersions ?? {},
        reviewRuns: state.reviewRuns ?? {},
        specialistRuns: state.specialistRuns ?? {},
        reviewFindings: state.reviewFindings ?? {},
        reviewIssues: state.reviewIssues ?? {},
        readinessReviews: state.readinessReviews ?? {},
        readinessCommitmentEvents: state.readinessCommitmentEvents ?? {},
        downstreamUpdatePlans: state.downstreamUpdatePlans ?? {},
        downstreamUpdatePlanEvents: state.downstreamUpdatePlanEvents ?? {},
        downstreamArtifactUpdateProposals: state.downstreamArtifactUpdateProposals ?? {},
        downstreamArtifactUpdateReviewEvents: state.downstreamArtifactUpdateReviewEvents ?? {},
        downstreamArtifactUpdateApplications: state.downstreamArtifactUpdateApplications ?? {},
        downstreamArtifactUpdateVerifications: state.downstreamArtifactUpdateVerifications ?? {},
        downstreamArtifactUpdateVerificationEvents: state.downstreamArtifactUpdateVerificationEvents ?? {},
    });
    if (!sweep.pruned) return false;
    // Merge the pruned (reference-stable) collections; this setState schedules a
    // fresh persist of the shrunken state through the debounced storage.
    useProjectStore.setState(sweep.collections);
    return true;
});

/**
 * What this user's persisted namespace currently holds for one project — i.e.
 * what OTHER tabs have written. This tab's store only adopts another tab's
 * writes when it next writes itself (the cross-tab merge above), so decision
 * points that must not act on a stale in-memory view check this fresh one:
 * - before spending money on generation, `artifactJobController` looks for
 *   another tab's live output-run lease (its heartbeat never reaches this
 *   tab's memory on its own) and whether that tab advanced the project past
 *   what this tab has in memory;
 * - before acting on a delete tombstone against a still-live cloud copy,
 *   server sync's reconcile checks whether another tab kept the project
 *   (`activity` after the deletion) or deleted it again (a newer `deletedAt`).
 * `activity` is 0 and `deletedAt` undefined when the blob has no such project /
 * tombstone. Parses the whole blob — call it only at such decision points.
 * Undefined when storage is unavailable or the blob can't be read.
 */
export function readPersistedProjectSnapshot(
    projectId: string,
): { outputRun?: OutputRunMarker; activity: number; deletedAt?: number } | undefined {
    try {
        const json = decodePersistedBlob(localStorage.getItem(resolveProjectStorageName()));
        if (!json) return undefined;
        const state = (JSON.parse(json) as { state?: Record<string, unknown> })?.state;
        if (!state || typeof state !== 'object') return undefined;
        const projects = state.projects as Record<string, { outputRun?: unknown } | undefined> | undefined;
        return {
            outputRun: readOutputRunMarker(projects?.[projectId]?.outputRun),
            activity: latestProjectActivity(state, projectId),
            deletedAt: readProjectTombstones(state.projectTombstones)[projectId],
        };
    } catch {
        return undefined;
    }
}

/**
 * Ask this tab to catch up with what other tabs persisted. A no-op setState
 * schedules the normal debounced write, whose cross-tab guard merges the
 * newer stored blob and adopts the result (onApplied) — the same safe path
 * every write takes. Never adopt by overwriting memory directly: that could
 * drop this tab's own not-yet-flushed edits.
 */
export function requestCrossTabCatchUp(): void {
    useProjectStore.setState({});
}
