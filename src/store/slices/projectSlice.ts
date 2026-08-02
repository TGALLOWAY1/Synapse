import type { StateCreator } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import type { Project, HistoryEvent, PipelineStage, ProjectPlatform } from '../../types';
import type { ProjectState } from '../types';
import { trackActivity } from '../../lib/recruiterApi';
import { DEMO_PROJECT_ID, galleryProjectIdForSlot } from '../../data/demoProject';
import {
    loadDemoSnapshotPointer,
    loadDemoSnapshotPublic,
    loadGalleryPointerPublic,
    loadGallerySnapshotPublic,
    restoreSnapshotAs,
    type SnapshotPayload,
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
    resetDemoProject: ProjectState['resetDemoProject'];
    loadGalleryProject: ProjectState['loadGalleryProject'];
    resetGalleryProject: ProjectState['resetGalleryProject'];
};

// Narrow views of the zustand set/get pair, so the showcase (demo + gallery)
// helpers below can live at module level instead of being duplicated per
// action inside the slice.
type ShowcaseSet = (updater: (state: ProjectState) => Partial<ProjectState>) => void;
type ShowcaseGet = () => ProjectState;

// Outcome of a showcase pointer probe. The two null-ish cases are NOT the
// same thing and must stay distinguishable: a FAILED probe (offline / proxy
// error) means "trust the cache — better stale than empty", while a
// SUCCESSFUL probe that finds nothing pinned means the owner explicitly
// removed the content — a cached copy is removed content, not a fallback.
type ShowcasePointerProbe =
    | { ok: true; snapshotId: string | null }
    | { ok: false };

// Wipe one showcase project's slice of every project-keyed store map and its
// IDB images. Shared by `clearDemoProject` and the gallery cache-policy
// discard — this is a session/route-level concern, not a durable mutation, so
// it deliberately bypasses the read-only capability guards.
async function clearShowcaseProject(
    set: ShowcaseSet,
    get: ShowcaseGet,
    targetProjectId: string,
): Promise<void> {
    const versions = get().artifactVersions[targetProjectId] || [];
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
            'downstreamArtifactUpdateProposals', 'downstreamArtifactUpdateReviewEvents',
            'downstreamArtifactUpdateApplications', 'downstreamArtifactUpdateVerifications',
            'downstreamArtifactUpdateVerificationEvents',
        ] as const;
        const next: Record<string, unknown> = {};
        for (const key of keys) {
            const copy = { ...state[key] };
            delete copy[targetProjectId];
            next[key] = copy;
        }
        return next as Partial<ProjectState>;
    });
}

// Hydrate one showcase project (the demo or a gallery slot) from its pinned
// cloud snapshot into the store at `targetProjectId`.
//
// Freshness: a previously cached copy is reused ONLY when its source snapshot
// id still matches the live pointer (`probePointer`). Otherwise (the owner
// pinned a newer snapshot) we re-fetch and overwrite the cache. The pointer
// probe is a tiny, public JSON fetch and runs before any heavy bundle/image
// download. If the probe itself fails (offline / proxy error), we fall back
// to the cached copy so the showcase still opens — better stale than empty.
//
// Image completeness (SYN-003): a STAMPED cache (`demoSourceSnapshotId` set)
// is provably known-complete — the stamp is only written when the restore was
// NOT image-incomplete. So a fresh-but-partial fetch never overwrites a
// stamped cache; fresh-partial still beats no cache or an un-stamped cache,
// and it leaves the stamp off so the next open re-fetches and self-heals.
async function loadShowcaseProject(
    set: ShowcaseSet,
    get: ShowcaseGet,
    options: {
        targetProjectId: string;
        force: boolean;
        // Resolves the live pinned snapshot id for this showcase target. See
        // `ShowcasePointerProbe`: a failed probe and an explicitly empty
        // pointer drive opposite cache decisions.
        probePointer: () => Promise<ShowcasePointerProbe>;
        // Fetches the full public snapshot payload, or null when unavailable.
        fetchPayload: () => Promise<SnapshotPayload | null>;
    },
): Promise<{ available: boolean }> {
    const { targetProjectId, probePointer, fetchPayload } = options;
    let force = options.force;
    let existing: Project | undefined = get().projects[targetProjectId];

    // Old caches were writable. Discard them once; current baseline caches
    // keep the normal pointer-based fast path.
    if (existing && existing.demoCachePolicyVersion !== DEMO_CACHE_POLICY_VERSION) {
        await clearShowcaseProject(set, get, targetProjectId);
        existing = undefined;
        force = true;
    }

    const probe = await probePointer();

    if (probe.ok && !probe.snapshotId) {
        // The probe SUCCEEDED and found nothing pinned for this target (e.g.
        // the owner removed this gallery slot). A cached copy is removed
        // content, not a network fallback — drop it and report unavailable
        // rather than serving it indefinitely on this device.
        if (existing) await clearShowcaseProject(set, get, targetProjectId);
        return { available: false };
    }

    const pointerId = probe.ok ? probe.snapshotId : null;

    if (!force && existing && pointerId && existing.demoSourceSnapshotId === pointerId) {
        return { available: true };
    }
    if (!force && existing && !probe.ok) {
        // Pointer probe failed — keep the cached copy rather than wiping it.
        return { available: true };
    }

    const payload = await fetchPayload();
    if (!payload) {
        // Fetch failed and nothing is cached — surface unavailable. If a
        // cache exists, keep serving it.
        return { available: !!existing };
    }

    // SYN-003: don't overwrite a stamped (known-complete) cache with a
    // fresh-but-partial fetch — the stale stamp already drives a re-fetch /
    // self-heal on the next open.
    if (payload.imagesComplete === false && existing?.demoSourceSnapshotId) {
        return { available: true };
    }

    await restoreSnapshotAs(payload, targetProjectId);

    // Stamp the source snapshot id so the next open can short-circuit when
    // the pointer is unchanged — EXCEPT when the load dropped images
    // (`imagesComplete === false`), so the "stamped cache is known-complete"
    // invariant above holds and the partial copy self-heals next open.
    const sourceId = payload.imagesComplete === false
        ? null
        : payload.manifest?.id ?? pointerId ?? null;
    set((state) => {
        const restored = state.projects[targetProjectId];
        if (!restored) return {};
        return {
            projects: {
                ...state.projects,
                [targetProjectId]: {
                    ...restored,
                    ...(sourceId ? { demoSourceSnapshotId: sourceId } : {}),
                    demoCachePolicyVersion: DEMO_CACHE_POLICY_VERSION,
                },
            },
        };
    });

    return { available: true };
}

// Wipe every piece of local state a showcase project owns: the project-keyed
// store maps, the transient job/progress slices, and all three IDB image
// stores + their reactive Zustand caches. The caller falls through to the
// matching load action for a full re-fetch + restore (deleting the project
// also removes the `demoSourceSnapshotId` stamp, so that load can never
// cache-short-circuit).
async function wipeShowcaseProject(
    set: ShowcaseSet,
    get: ShowcaseGet,
    targetProjectId: string,
): Promise<void> {
    const versionIds = (get().artifactVersions[targetProjectId] ?? []).map((v) => v.id);

    // Best-effort IDB cleanup — a failed delete must never abort the
    // reset; the full restore that follows repopulates IndexedDB regardless.
    for (const versionId of versionIds) {
        try {
            await deleteImagesForVersion(versionId);
        } catch (err) {
            console.warn('[resetShowcaseProject] failed to delete mockup images for version', versionId, err);
        }
        try {
            await deleteScreenImagesForArtifactVersion(versionId);
        } catch (err) {
            console.warn('[resetShowcaseProject] failed to delete screen-inventory images for version', versionId, err);
        }
        try {
            await deleteVariantImagesForVersion(versionId);
        } catch (err) {
            console.warn('[resetShowcaseProject] failed to delete mockup variant images for version', versionId, err);
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
        const projects = { ...state.projects };
        delete projects[targetProjectId];
        const spineVersions = { ...state.spineVersions };
        delete spineVersions[targetProjectId];
        const historyEvents = { ...state.historyEvents };
        delete historyEvents[targetProjectId];
        const branches = { ...state.branches };
        delete branches[targetProjectId];
        const artifacts = { ...state.artifacts };
        delete artifacts[targetProjectId];
        const artifactVersions = { ...state.artifactVersions };
        delete artifactVersions[targetProjectId];
        const feedbackItems = { ...state.feedbackItems };
        delete feedbackItems[targetProjectId];
        const tasks = { ...state.tasks };
        delete tasks[targetProjectId];
        const workflowRuns = { ...state.workflowRuns };
        delete workflowRuns[targetProjectId];
        const jobs = { ...state.jobs };
        delete jobs[targetProjectId];
        const prdProgress = { ...state.prdProgress };
        delete prdProgress[targetProjectId];
        const prdSectionStatus = { ...state.prdSectionStatus };
        delete prdSectionStatus[targetProjectId];
        return {
            projects,
            spineVersions,
            historyEvents,
            branches,
            artifacts,
            artifactVersions,
            feedbackItems,
            tasks,
            workflowRuns,
            jobs,
            prdProgress,
            prdSectionStatus,
        };
    });
}

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

    // Wipes the demo project's local cache (store maps + IDB images) so the
    // next `loadDemoProject()` performs a full re-fetch. Shared machinery in
    // `clearShowcaseProject` above.
    clearDemoProject: async () => {
        await clearShowcaseProject(set, get, DEMO_PROJECT_ID);
    },

    // Hydrates the store with the demo project — the cloud snapshot the owner
    // pinned via SnapshotsPanel, fetched from the public `?demo=1` endpoint
    // and spliced in at the stable DEMO_PROJECT_ID. All freshness / image-
    // completeness / cache-fallback policy lives in `loadShowcaseProject`.
    loadDemoProject: async ({ force = false } = {}) => {
        const { available } = await loadShowcaseProject(set, get, {
            targetProjectId: DEMO_PROJECT_ID,
            force,
            probePointer: async () => {
                const pointer = await loadDemoSnapshotPointer().catch((err) => {
                    console.error('[loadDemoProject] failed to read demo pointer', err);
                    return null;
                });
                // `loadDemoSnapshotPointer` returns null for BOTH a transport
                // failure and "no demo pinned", so the demo probe reports
                // ok:false either way — a cached demo keeps serving, exactly
                // the pre-gallery behavior.
                return pointer?.snapshotId
                    ? { ok: true as const, snapshotId: pointer.snapshotId }
                    : { ok: false as const };
            },
            fetchPayload: () => loadDemoSnapshotPublic().catch((err) => {
                console.error('[loadDemoProject] failed to fetch demo snapshot', err);
                return null;
            }),
        });
        return { projectId: DEMO_PROJECT_ID, available };
    },

    // Hydrates one project-gallery slot from its pinned cloud snapshot into
    // the slot's stable project id — the gallery counterpart of
    // `loadDemoProject`, sharing the exact same freshness and completeness
    // semantics. The pointer probe resolves the slot's snapshot id from the
    // lightweight public gallery pointer.
    loadGalleryProject: async (slot, { force = false } = {}) => {
        const targetProjectId = galleryProjectIdForSlot(slot);
        if (!targetProjectId) return { projectId: null, available: false };
        const { available } = await loadShowcaseProject(set, get, {
            targetProjectId,
            force,
            probePointer: async () => {
                const pointer = await loadGalleryPointerPublic();
                // A readable pointer whose slot is empty means the owner
                // explicitly removed this slot — distinct from a failed probe
                // (null), which keeps the cache.
                if (!pointer) return { ok: false as const };
                return { ok: true as const, snapshotId: pointer.snapshotIds[slot] ?? null };
            },
            fetchPayload: () => loadGallerySnapshotPublic(slot).catch((err) => {
                console.error('[loadGalleryProject] failed to fetch gallery snapshot', err);
                return null;
            }),
        });
        return { projectId: targetProjectId, available };
    },

    // SYN-001: a deterministic "Reset Demo" for the public read-only demo
    // project. This is a session/route-level concern like `loadDemoProject`
    // itself — NOT a durable capability — so it deliberately bypasses the
    // read-only capability guards (`assertProjectCapability`) instead of
    // extending them. Wipe-then-reload machinery in `wipeShowcaseProject`;
    // deleting the project also removes the `demoSourceSnapshotId` stamp, so
    // the follow-up load can never cache-short-circuit.
    resetDemoProject: async () => {
        await wipeShowcaseProject(set, get, DEMO_PROJECT_ID);
        return get().loadDemoProject();
    },

    // Gallery counterpart of `resetDemoProject`, scoped to one slot.
    resetGalleryProject: async (slot) => {
        const targetProjectId = galleryProjectIdForSlot(slot);
        if (!targetProjectId) return { projectId: null, available: false };
        await wipeShowcaseProject(set, get, targetProjectId);
        return get().loadGalleryProject(slot);
    },
});
