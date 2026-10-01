import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { artifactJobController, MAX_AUTO_RESUME_ATTEMPTS } from '../services/artifactJobController';
import { useProjectStore } from '../../store/projectStore';
import { visibleCoreSubtypes } from '../coreArtifactPipeline';
import type {
    Artifact, ArtifactSlotKey, ArtifactVersion, CoreArtifactSubtype, OutputRunMarker, SlotState, StructuredPRD,
} from '../../types';

// W4 (docs/ARTIFACT_READINESS_RESOLUTION_PLAN.md): unhiding `component_inventory`
// changes auto-resume. While it was hidden, `resumeIfNeeded` deliberately never
// woke for it — the user had no row to see or retry it, so an errored hidden slot
// would have been retried invisibly on every workspace remount. Now that the slot
// is visible (status + Retry live in the Screens view's Components section), it
// SHOULD auto-resume like any other pending output. These tests pin both halves:
// the new wake behavior, and the "nothing pending → no run" control.

const projectId = 'project-resume';
const spineId = 'spine-1';
const structuredPRD = { productName: 'Resume' } as StructuredPRD;

const args = {
    projectId,
    spineVersionId: spineId,
    prdContent: 'PRD',
    structuredPRD,
};

const artifactFor = (subtype: CoreArtifactSubtype): Artifact => ({
    id: `art-${subtype}`,
    projectId,
    type: 'core_artifact',
    subtype,
    title: subtype,
    status: 'active',
    currentVersionId: `ver-${subtype}`,
    createdAt: 1,
    updatedAt: 1,
});

const versionFor = (subtype: CoreArtifactSubtype): ArtifactVersion => ({
    id: `ver-${subtype}`,
    artifactId: `art-${subtype}`,
    versionNumber: 1,
    parentVersionId: null,
    content: `${subtype} content`,
    metadata: {},
    sourceRefs: [{
        id: `ref-${subtype}`,
        sourceArtifactId: projectId,
        sourceArtifactVersionId: spineId,
        sourceType: 'spine',
    }],
    generationPrompt: 'prompt',
    isPreferred: true,
    createdAt: 1,
});

const mockupArtifact: Artifact = {
    id: 'art-mockup',
    projectId,
    type: 'mockup',
    title: 'Mockups',
    status: 'active',
    currentVersionId: 'ver-mockup',
    createdAt: 1,
    updatedAt: 1,
};

const mockupVersion: ArtifactVersion = {
    id: 'ver-mockup',
    artifactId: 'art-mockup',
    versionNumber: 1,
    parentVersionId: null,
    content: '{}',
    metadata: {},
    sourceRefs: [{
        id: 'ref-mockup',
        sourceArtifactId: projectId,
        sourceArtifactVersionId: spineId,
        sourceType: 'spine',
    }],
    generationPrompt: 'prompt',
    isPreferred: true,
    createdAt: 1,
};

/** Seed the store with every visible core slot done for the spine except `missing`. */
function seedStore(missing: CoreArtifactSubtype[]): void {
    const done = visibleCoreSubtypes().filter(subtype => !missing.includes(subtype));
    useProjectStore.setState({
        projects: {
            [projectId]: { id: projectId, name: 'Resume', createdAt: 1, designSystemPreset: 'minimal' },
        },
        spineVersions: {
            [projectId]: [{
                id: spineId,
                projectId,
                promptText: 'idea',
                responseText: 'PRD',
                createdAt: 1,
                isLatest: true,
                isFinal: true,
                structuredPRD,
            }],
        },
        artifacts: { [projectId]: [...done.map(artifactFor), mockupArtifact] },
        artifactVersions: { [projectId]: [...done.map(versionFor), mockupVersion] },
        jobs: {},
    });
}

const realStartAll = artifactJobController.startAll;
let startAll: ReturnType<typeof vi.fn>;

beforeEach(() => {
    startAll = vi.fn();
    artifactJobController.startAll = startAll as unknown as typeof realStartAll;
});

afterEach(() => {
    artifactJobController.startAll = realStartAll;
});

describe('artifactJobController.resumeIfNeeded — component_inventory is no longer hidden', () => {
    it('auto-wakes a run for a pending component_inventory slot', () => {
        // Previously this slot was hidden, so `pending` filtered it out and the
        // errored/missing inventory stayed pending forever — silently degrading
        // every mockup generated afterwards.
        seedStore(['component_inventory']);

        artifactJobController.resumeIfNeeded(args);

        expect(startAll).toHaveBeenCalledTimes(1);
        expect(startAll).toHaveBeenCalledWith(args, { autoResume: true });
    });

    it('does not wake a run when every visible slot is already done', () => {
        seedStore([]);

        artifactJobController.resumeIfNeeded(args);

        expect(startAll).not.toHaveBeenCalled();
    });

    it('still requires durable evidence that an output run had begun', () => {
        // Nothing generated for this spine at all → opening Explore/Build must
        // not silently start generating (auto-resume is recovery, not an entry
        // side effect).
        seedStore(visibleCoreSubtypes());
        useProjectStore.setState({
            artifacts: { [projectId]: [] },
            artifactVersions: { [projectId]: [] },
        });

        artifactJobController.resumeIfNeeded(args);

        expect(startAll).not.toHaveBeenCalled();
    });
});

/** No output exists for the spine at all (a reload before the first one landed). */
function seedNothingGenerated(outputRun?: OutputRunMarker): void {
    seedStore(visibleCoreSubtypes());
    useProjectStore.setState((s) => ({
        artifacts: { [projectId]: [] },
        artifactVersions: { [projectId]: [] },
        projects: { [projectId]: { ...s.projects[projectId], ...(outputRun ? { outputRun } : {}) } },
    }));
}

const marker = (phase: OutputRunMarker['phase'], spineVersionId = spineId): OutputRunMarker => ({
    spineVersionId,
    runId: 'run-before-reload',
    startedAt: 1,
    phase,
});

function seedJob(slots: Partial<Record<ArtifactSlotKey, SlotState>>, spineVersionId = spineId): void {
    useProjectStore.setState({
        jobs: { [projectId]: { spineVersionId, startedAt: 1, slots: slots as Record<ArtifactSlotKey, SlotState> } },
    });
}

describe('artifactJobController.resumeIfNeeded — a run interrupted before its first output', () => {
    it('resumes when the durable output-run marker reads interrupted (reload mid-run)', () => {
        seedNothingGenerated(marker('interrupted'));

        artifactJobController.resumeIfNeeded(args);

        expect(startAll).toHaveBeenCalledWith(args, { autoResume: true });
    });

    it('does not resume on a still-running marker — that run may be live in another tab or device', () => {
        seedNothingGenerated(marker('running'));

        artifactJobController.resumeIfNeeded(args);

        expect(startAll).not.toHaveBeenCalled();
    });

    it('ignores a marker left by a run for a different spine', () => {
        seedNothingGenerated(marker('interrupted', 'older-spine'));

        artifactJobController.resumeIfNeeded(args);

        expect(startAll).not.toHaveBeenCalled();
    });

    it('resumes when this session\'s job for the spine still has in-progress slots', () => {
        seedNothingGenerated();
        seedJob({
            design_system: { status: 'interrupted', attempt: 1 },
            data_model: { status: 'queued', attempt: 0 },
        });

        artifactJobController.resumeIfNeeded(args);

        expect(startAll).toHaveBeenCalledWith(args, { autoResume: true });
    });

    it('does not treat a settled, all-failed job as an interrupted run', () => {
        seedNothingGenerated();
        seedJob({ design_system: { status: 'error', attempt: 1 }, data_model: { status: 'error', attempt: 1 } });

        artifactJobController.resumeIfNeeded(args);

        expect(startAll).not.toHaveBeenCalled();
    });
});

describe('artifactJobController.resumeIfNeeded — automatic attempts are capped', () => {
    const failing = (autoResumeAttempts: number): SlotState => ({
        status: 'error',
        attempt: 1,
        autoResumeAttempts,
        error: { message: 'boom', category: 'unknown', timestamp: 1 },
    });

    it('leaves a slot that used up its automatic attempts failed (no run)', () => {
        seedStore(['data_model']);
        seedJob({ data_model: failing(MAX_AUTO_RESUME_ATTEMPTS) });

        artifactJobController.resumeIfNeeded(args);

        expect(startAll).not.toHaveBeenCalled();
        expect(useProjectStore.getState().jobs[projectId]?.slots.data_model?.status).toBe('error');
    });

    it('still resumes while a pending slot has automatic attempts left', () => {
        seedStore(['data_model']);
        seedJob({ data_model: failing(MAX_AUTO_RESUME_ATTEMPTS - 1) });

        artifactJobController.resumeIfNeeded(args);

        expect(startAll).toHaveBeenCalledWith(args, { autoResume: true });
    });

    it('starts a fresh automatic budget for a new spine', () => {
        seedStore(['data_model']);
        // The exhausted counter belongs to an older spine's job.
        seedJob({ data_model: failing(MAX_AUTO_RESUME_ATTEMPTS) }, 'older-spine');

        artifactJobController.resumeIfNeeded(args);

        expect(startAll).toHaveBeenCalledWith(args, { autoResume: true });
    });
});
