import type { StateCreator } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import type { Project, HistoryEvent, PipelineStage, ProjectPlatform } from '../../types';
import type { ProjectState } from '../types';
import { trackActivity } from '../../lib/recruiterApi';
import { DEMO_PROJECT_ID } from '../../data/demoProject';
import {
    loadDemoSnapshotPointer,
    loadDemoSnapshotPublic,
    restoreSnapshotAs,
} from '../../lib/snapshotClient';
import { projectsDebug } from '../../lib/projectsDebug';
import { resolveProjectStorageName } from '../userScope';
import { assertProjectCapability } from '../../lib/projectCapabilities';
import { deleteImagesForVersion } from '../../lib/mockupImageStore';
import { deleteScreenImagesForArtifactVersion } from '../../lib/screenInventoryImageStore';
import { deleteVariantImagesForVersion } from '../../lib/mockupVariantImageStore';
import { useMockupImageStore } from '../mockupImageStore';
import { useScreenInventoryImageStore } from '../screenInventoryImageStore';
import { useMockupVariantImageStore } from '../mockupVariantImageStore';
import { ALL_PROJECT_COLLECTIONS } from '../../lib/projectBundle';

export const DEMO_CACHE_POLICY_VERSION = 1;

/**
 * Drop `DEMO_PROJECT_ID` from EVERY persisted project-keyed collection.
 *
 * Derived from `ALL_PROJECT_COLLECTIONS` (the single list the bundle, sync,
 * recovery, namespace switch and legacy import all derive from) rather than a
 * hand-written key list — see cross-cutting rule 6 in CLAUDE.md. Both demo
 * wipes previously spelled the keys out by hand and `resetDemoProject`'s copy
 * had drifted to nine of them, so a reset left the demo's review, planning,
 * readiness and downstream-update records behind.
 */
function withoutDemoCollections(state: ProjectState): Partial<ProjectState> {
    const next: Record<string, unknown> = {};
    for (const key of ALL_PROJECT_COLLECTIONS) {
        const copy = { ...(state[key] as Record<string, unknown>) };
        delete copy[DEMO_PROJECT_ID];
        next[key] = copy;
    }
    return next as Partial<ProjectState>;
}

export type ProjectSlice = {
    projects: Record<string, Project>;
    historyEvents: Record<string, HistoryEvent[]>;
    createProject: ProjectState['createProject'];
    deleteProject: ProjectState['deleteProject'];
    getProject: ProjectState['getProject'];
    getHistoryEvents: ProjectState['getHistoryEvents'];
    setProjectStage: ProjectState['setProjectStage'];
    setProjectDesignSystemPreset: ProjectState['setProjectDesignSystemPreset'];
    markDesignSetupComplete: ProjectState['markDesignSetupComplete'];
    loadDemoProject: ProjectState['loadDemoProject'];
    clearDemoProject: ProjectState['clearDemoProject'];
    resetDemoProject: ProjectState['resetDemoProject'];
};

export const createProjectSlice: StateCreator<ProjectState, [], [], ProjectSlice> = (set, get) => ({
    projects: {},
    historyEvents: {},

    createProject: (name: string, promptText: string, platform?: ProjectPlatform) => {
        const projectId = uuidv4();
        const now = Date.now();
        const newProject: Project = {
            id: projectId,
            name,
            createdAt: now,
            // New projects owe a setup-stage design selection (shown while the
            // PRD generates). Legacy persisted projects lack the flag and keep
            // the finalize-edge preset gate as their only prompt.
            needsDesignSetup: true,
            ...(platform && { platform }),
        };

        const initialSpine = {
            id: 'v1',
            projectId,
            promptText,
            responseText: 'Generating PRD...',
            createdAt: now,
            isLatest: true,
            isFinal: false,
        };

        const initEvent: HistoryEvent = {
            id: uuidv4(),
            projectId,
            spineVersionId: initialSpine.id,
            type: "Init",
            description: "Spine v1 created",
            createdAt: now,
        };

        set((state) => ({
            projects: { ...state.projects, [projectId]: newProject },
            spineVersions: { ...state.spineVersions, [projectId]: [initialSpine] },
            historyEvents: { ...state.historyEvents, [projectId]: [initEvent] },
        }));
        void trackActivity('clicked_section', { section: 'create_project', projectId });
        projectsDebug('project created', {
            projectId,
            name,
            namespace: resolveProjectStorageName(),
            totalProjects: Object.keys(get().projects).length,
        });

        return { projectId, spineId: initialSpine.id };
    },

    deleteProject: (projectId: string) => {
        assertProjectCapability(get().projects[projectId], 'canEditProjectContent');
        set((state) => {
            const newProjects = { ...state.projects };
            delete newProjects[projectId];
            const newSpines = { ...state.spineVersions };
            delete newSpines[projectId];
            const newHistory = { ...state.historyEvents };
            delete newHistory[projectId];
            const newBranches = { ...state.branches };
            delete newBranches[projectId];
            const newArtifacts = { ...state.artifacts };
            delete newArtifacts[projectId];
            const newArtifactVersions = { ...state.artifactVersions };
            delete newArtifactVersions[projectId];
            const newFeedbackItems = { ...state.feedbackItems };
            delete newFeedbackItems[projectId];
            const newTasks = { ...state.tasks };
            delete newTasks[projectId];
            const newWorkflowRuns = { ...state.workflowRuns };
            delete newWorkflowRuns[projectId];
            const newReviewRuns = { ...state.reviewRuns };
            delete newReviewRuns[projectId];
            const newSpecialistRuns = { ...state.specialistRuns };
            delete newSpecialistRuns[projectId];
            const newReviewFindings = { ...state.reviewFindings };
            delete newReviewFindings[projectId];
            const newReviewIssues = { ...state.reviewIssues };
            delete newReviewIssues[projectId];
            const newPlanningRecords = { ...state.planningRecords };
            delete newPlanningRecords[projectId];
            const newReadinessReviews = { ...state.readinessReviews };
            delete newReadinessReviews[projectId];
            const newReadinessCommitmentEvents = { ...state.readinessCommitmentEvents };
            delete newReadinessCommitmentEvents[projectId];
            const newDownstreamUpdatePlans = { ...state.downstreamUpdatePlans };
            delete newDownstreamUpdatePlans[projectId];
            const newDownstreamUpdatePlanEvents = { ...state.downstreamUpdatePlanEvents };
            delete newDownstreamUpdatePlanEvents[projectId];
            const newDownstreamArtifactUpdateProposals = { ...state.downstreamArtifactUpdateProposals };
            delete newDownstreamArtifactUpdateProposals[projectId];
            const newDownstreamArtifactUpdateReviewEvents = { ...state.downstreamArtifactUpdateReviewEvents };
            delete newDownstreamArtifactUpdateReviewEvents[projectId];
            const newDownstreamArtifactUpdateApplications = { ...state.downstreamArtifactUpdateApplications };
            delete newDownstreamArtifactUpdateApplications[projectId];
            const newDownstreamArtifactUpdateVerifications = { ...state.downstreamArtifactUpdateVerifications };
            delete newDownstreamArtifactUpdateVerifications[projectId];
            const newDownstreamArtifactUpdateVerificationEvents = { ...state.downstreamArtifactUpdateVerificationEvents };
            delete newDownstreamArtifactUpdateVerificationEvents[projectId];
            return {
                projects: newProjects,
                spineVersions: newSpines,
                historyEvents: newHistory,
                branches: newBranches,
                artifacts: newArtifacts,
                artifactVersions: newArtifactVersions,
                feedbackItems: newFeedbackItems,
                tasks: newTasks,
                workflowRuns: newWorkflowRuns,
                reviewRuns: newReviewRuns,
                specialistRuns: newSpecialistRuns,
                reviewFindings: newReviewFindings,
                reviewIssues: newReviewIssues,
                planningRecords: newPlanningRecords,
                readinessReviews: newReadinessReviews,
                readinessCommitmentEvents: newReadinessCommitmentEvents,
                downstreamUpdatePlans: newDownstreamUpdatePlans,
                downstreamUpdatePlanEvents: newDownstreamUpdatePlanEvents,
                downstreamArtifactUpdateProposals: newDownstreamArtifactUpdateProposals,
                downstreamArtifactUpdateReviewEvents: newDownstreamArtifactUpdateReviewEvents,
                downstreamArtifactUpdateApplications: newDownstreamArtifactUpdateApplications,
                downstreamArtifactUpdateVerifications: newDownstreamArtifactUpdateVerifications,
                downstreamArtifactUpdateVerificationEvents: newDownstreamArtifactUpdateVerificationEvents,
            };
        });
    },

    getProject: (projectId: string) => {
        return get().projects[projectId];
    },

    getHistoryEvents: (projectId: string) => {
        return get().historyEvents[projectId] || [];
    },

    setProjectStage: (projectId: string, stage: PipelineStage) => {
        assertProjectCapability(get().projects[projectId], 'canPersistWorkflowState');
        set((state) => ({
            projects: {
                ...state.projects,
                [projectId]: { ...state.projects[projectId], currentStage: stage, updatedAt: Date.now() }
            }
        }));
        void trackActivity(stage === 'mockups' ? 'viewed_mockups' : 'clicked_section', { section: stage, projectId });
    },

    setProjectDesignSystemPreset: (projectId: string, presetId: string) => {
        assertProjectCapability(get().projects[projectId], 'canManageDesignSystem');
        set((state) => {
            const project = state.projects[projectId];
            if (!project) return state;
            return {
                projects: {
                    ...state.projects,
                    // A chosen preset settles the setup step no matter which UI
                    // it came from (setup step, finalize gate, design artifact).
                    [projectId]: { ...project, designSystemPreset: presetId, needsDesignSetup: false, updatedAt: Date.now() },
                },
            };
        });
    },

    markDesignSetupComplete: (projectId: string) => {
        assertProjectCapability(get().projects[projectId], 'canManageDesignSystem');
        set((state) => {
            const project = state.projects[projectId];
            if (!project) return state;
            return {
                projects: {
                    ...state.projects,
                    [projectId]: { ...project, needsDesignSetup: false, updatedAt: Date.now() },
                },
            };
        });
    },

    // Hydrates the store with the demo project. The demo is a cloud snapshot
    // the owner has pinned via SnapshotsPanel — we fetch it from the public
    // `/api/snapshots?demo=1` endpoint and splice it in at the stable
    // DEMO_PROJECT_ID.
    //
    // Freshness: a previously cached demo is reused ONLY when its source
    // snapshot id still matches the live pointer. Otherwise (owner pinned a
    // newer snapshot) we re-fetch and overwrite the cache. This is why the
    // desktop used to show a stale demo while mobile — with no cache — showed
    // the latest one. The pointer probe is a tiny, public JSON fetch and runs
    // before any heavy bundle/image download. If the pointer fetch itself
    // fails (offline / proxy error), we fall back to the cached copy so the
    // demo still opens.
    clearDemoProject: async () => {
        const versions = get().artifactVersions[DEMO_PROJECT_ID] || [];
        await Promise.all(versions.flatMap((version) => [
            deleteImagesForVersion(version.id),
            deleteScreenImagesForArtifactVersion(version.id),
            deleteVariantImagesForVersion(version.id),
        ]));
        set((state) => withoutDemoCollections(state));
    },

    loadDemoProject: async ({ force = false } = {}) => {
        const existing = get().projects[DEMO_PROJECT_ID];

        // Old caches were writable. Discard them once; current baseline caches
        // keep the normal pointer-based fast path.
        if (existing && existing.demoCachePolicyVersion !== DEMO_CACHE_POLICY_VERSION) {
            await get().clearDemoProject();
            return get().loadDemoProject({ force: true });
        }

        const pointer = await loadDemoSnapshotPointer().catch((err) => {
            console.error('[loadDemoProject] failed to read demo pointer', err);
            return null;
        });

        if (!force && existing && pointer && existing.demoSourceSnapshotId === pointer.snapshotId) {
            return { projectId: DEMO_PROJECT_ID, available: true };
        }
        if (!force && existing && !pointer) {
            // Pointer probe failed — keep the cached demo rather than wiping
            // it. Better stale than empty.
            return { projectId: DEMO_PROJECT_ID, available: true };
        }

        const payload = await loadDemoSnapshotPublic().catch((err) => {
            console.error('[loadDemoProject] failed to fetch demo snapshot', err);
            return null;
        });
        if (!payload) {
            // Fetch failed and nothing is cached — surface unavailable. If a
            // cache exists, keep serving it.
            return { projectId: DEMO_PROJECT_ID, available: !!existing };
        }

        // SYN-003: a STAMPED cache is provably known-complete — `demoSourceSnapshotId`
        // is only written when the restore was NOT image-incomplete (see the
        // stamp guard below). So when the fresh fetch itself dropped images
        // (`imagesComplete === false`) and we hold such a cache, DON'T overwrite
        // a complete demo with a partial one — keep serving the cache. The stamp
        // is now stale vs. the live pointer, which already drives a re-fetch /
        // self-heal on the next open. (Fresh-partial still wins when there is no
        // cache, or the cache is un-stamped — a partial demo beats an empty one.)
        if (payload.imagesComplete === false && existing?.demoSourceSnapshotId) {
            return { projectId: DEMO_PROJECT_ID, available: true };
        }

        await restoreSnapshotAs(payload, DEMO_PROJECT_ID);

        // Stamp the source snapshot id so the next click can short-circuit
        // when the pointer is unchanged. Pull from the freshly-restored
        // payload's manifest, falling back to the pointer if the manifest
        // didn't carry an id (defensive — older bundles always did).
        //
        // EXCEPT when the load dropped images (`imagesComplete === false`:
        // some per-image fetches kept failing — flaky network / rate limit).
        // We still restore what we have (fresh-partial beats an empty / un-stamped
        // state) but leave the stamp off so the next demo open re-fetches and
        // self-heals to the full image set instead of pinning the partial copy
        // forever — AND so the "stamped cache is known-complete" invariant above
        // holds.
        const sourceId = payload.imagesComplete === false
            ? null
            : payload.manifest?.id ?? pointer?.snapshotId ?? null;
        {
            set((state) => {
                const restored = state.projects[DEMO_PROJECT_ID];
                if (!restored) return {};
                return {
                    projects: {
                        ...state.projects,
                        [DEMO_PROJECT_ID]: {
                            ...restored,
                            ...(sourceId ? { demoSourceSnapshotId: sourceId } : {}),
                            demoCachePolicyVersion: DEMO_CACHE_POLICY_VERSION,
                        },
                    },
                };
            });
        }

        return { projectId: DEMO_PROJECT_ID, available: true };
    },

    // SYN-001: a deterministic "Reset Demo" for the public read-only demo
    // project. This is a session/route-level concern like `loadDemoProject`
    // itself — NOT a durable capability — so it deliberately bypasses the
    // read-only capability guards (`assertProjectCapability`) instead of
    // extending them; the demo is the only project this ever touches
    // (no projectId param).
    //
    // Sequence: wipe every piece of local state the demo namespace owns
    // (every project-keyed store map in ALL_PROJECT_COLLECTIONS, the transient
    // job/progress slices, and all three IDB image stores + their reactive
    // Zustand caches), then
    // fall through to `loadDemoProject()` for a full re-fetch + restore from
    // the pinned snapshot. Deleting `projects[DEMO_PROJECT_ID]` also removes
    // the `demoSourceSnapshotId` stamp, so the subsequent `loadDemoProject()`
    // call can never cache-short-circuit — it always performs a full restore.
    resetDemoProject: async () => {
        const versionIds = (get().artifactVersions[DEMO_PROJECT_ID] ?? []).map((v) => v.id);

        // Best-effort IDB cleanup — a failed delete must never abort the
        // reset; the full restore below repopulates IndexedDB regardless.
        for (const versionId of versionIds) {
            try {
                await deleteImagesForVersion(versionId);
            } catch (err) {
                console.warn('[resetDemoProject] failed to delete mockup images for version', versionId, err);
            }
            try {
                await deleteScreenImagesForArtifactVersion(versionId);
            } catch (err) {
                console.warn('[resetDemoProject] failed to delete screen-inventory images for version', versionId, err);
            }
            try {
                await deleteVariantImagesForVersion(versionId);
            } catch (err) {
                console.warn('[resetDemoProject] failed to delete mockup variant images for version', versionId, err);
            }
        }

        // Evict the reactive Zustand caches that mirror those IDB stores.
        // `restoreSnapshotAs` never proactively clears these (the mockup /
        // screen-inventory caches self-heal lazily via `loadForVersion`, and
        // the variant cache only ever merges) — a full wipe needs an explicit
        // clear so a stale in-memory record can never survive the reset.
        useMockupImageStore.getState().clearVersions(versionIds);
        useScreenInventoryImageStore.getState().clearVersions(versionIds);
        useMockupVariantImageStore.getState().clearVersions(versionIds);

        set((state) => {
            // Every persisted project-keyed collection, plus the transient
            // job/progress slices (which are NOT part of the persisted bundle
            // and so are not covered by ALL_PROJECT_COLLECTIONS).
            const jobs = { ...state.jobs };
            delete jobs[DEMO_PROJECT_ID];
            const prdProgress = { ...state.prdProgress };
            delete prdProgress[DEMO_PROJECT_ID];
            const prdSectionStatus = { ...state.prdSectionStatus };
            delete prdSectionStatus[DEMO_PROJECT_ID];
            return {
                ...withoutDemoCollections(state),
                jobs,
                prdProgress,
                prdSectionStatus,
            };
        });

        return get().loadDemoProject();
    },
});
