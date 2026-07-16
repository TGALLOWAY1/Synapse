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
import { deleteImagesForVersion } from '../../lib/mockupImageStore';
import { deleteScreenImagesForArtifactVersion } from '../../lib/screenInventoryImageStore';
import { deleteVariantImagesForVersion } from '../../lib/mockupVariantImageStore';

export const DEMO_CACHE_POLICY_VERSION = 1;

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
        set((state) => ({
            projects: {
                ...state.projects,
                [projectId]: { ...state.projects[projectId], currentStage: stage }
            }
        }));
        void trackActivity(stage === 'mockups' ? 'viewed_mockups' : 'clicked_section', { section: stage, projectId });
    },

    setProjectDesignSystemPreset: (projectId: string, presetId: string) => {
        set((state) => {
            const project = state.projects[projectId];
            if (!project) return state;
            return {
                projects: {
                    ...state.projects,
                    // A chosen preset settles the setup step no matter which UI
                    // it came from (setup step, finalize gate, design artifact).
                    [projectId]: { ...project, designSystemPreset: presetId, needsDesignSetup: false },
                },
            };
        });
    },

    markDesignSetupComplete: (projectId: string) => {
        set((state) => {
            const project = state.projects[projectId];
            if (!project) return state;
            return {
                projects: {
                    ...state.projects,
                    [projectId]: { ...project, needsDesignSetup: false },
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
        set((state) => {
            const keys = [
                'projects', 'spineVersions', 'historyEvents', 'branches', 'artifacts',
                'artifactVersions', 'feedbackItems', 'reviewRuns', 'specialistRuns',
                'reviewFindings', 'reviewIssues', 'planningRecords', 'tasks', 'workflowRuns',
                'readinessReviews', 'readinessCommitmentEvents',
                'downstreamUpdatePlans', 'downstreamUpdatePlanEvents',
            ] as const;
            const next: Record<string, unknown> = {};
            for (const key of keys) {
                const copy = { ...state[key] };
                delete copy[DEMO_PROJECT_ID];
                next[key] = copy;
            }
            return next as Partial<ProjectState>;
        });
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

        await restoreSnapshotAs(payload, DEMO_PROJECT_ID);

        // Stamp the source snapshot id so the next click can short-circuit
        // when the pointer is unchanged. Pull from the freshly-restored
        // payload's manifest, falling back to the pointer if the manifest
        // didn't carry an id (defensive — older bundles always did).
        //
        // EXCEPT when the load dropped images (`imagesComplete === false`:
        // some per-image fetches kept failing — flaky network / rate limit).
        // We still restore what we have (fresh-partial beats stale cache) but
        // leave the stamp off so the next demo open re-fetches and self-heals
        // to the full image set instead of pinning the partial copy forever.
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
});
