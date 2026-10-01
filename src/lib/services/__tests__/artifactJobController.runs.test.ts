// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { GenerationMeta, SpineVersion, StructuredPRD } from '../../../types';

// Only the network-bound generation is stubbed; the controller, store, and
// pipeline helpers are real. Mirrors artifactJobController.earlyDesign.test.ts.
vi.mock('../coreArtifactService', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../coreArtifactService')>()),
    generateCoreArtifact: vi.fn(async (subtype: string) => ({ content: `${subtype} content`, metadata: {} })),
}));
vi.mock('../mockupService', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../mockupService')>()),
    generateMockup: vi.fn(() => ({ payload: { title: 'Mockup', screens: [] }, warnings: [] })),
}));
// Keep every mocked slot `done` (generic mock content would otherwise trip
// blocking validation and hold dependents back).
vi.mock('../../artifactBlockingValidation', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../artifactBlockingValidation')>()),
    detectArtifactBlockers: vi.fn(() => []),
}));

import { artifactJobController, MAX_AUTO_RESUME_ATTEMPTS } from '../artifactJobController';
import { generateCoreArtifact } from '../coreArtifactService';
import { useProjectStore } from '../../../store/projectStore';
import { setActiveProjectUser } from '../../../store/userScope';
import { getTabId, OUTPUT_RUN_HEARTBEAT_MS, OUTPUT_RUN_LEASE_MS } from '../../outputRunLease';
import type { OutputRunMarker } from '../../../types';

const genMock = vi.mocked(generateCoreArtifact);

const prd = (): StructuredPRD => ({
    vision: 'A vision',
    targetUsers: ['user'],
    coreProblem: 'problem',
    features: [{ id: 'f1', name: 'Feature One', description: 'desc', userValue: 'value', complexity: 'low' }],
    architecture: 'arch',
    risks: ['risk'],
});

const completeMeta = (): GenerationMeta => ({ passes: [], totalMs: 0, revised: false, schemaVersion: 1 });

function resetStore(): void {
    useProjectStore.setState({
        projects: {},
        spineVersions: {},
        historyEvents: {},
        branches: {},
        artifacts: {},
        artifactVersions: {},
        feedbackItems: {},
        jobs: {},
    });
    localStorage.clear();
}

function seedCompleteProject(): { projectId: string; spineId: string } {
    const store = useProjectStore.getState();
    const { projectId, spineId } = store.createProject('P', 'idea');
    store.updateSpineStructuredPRD(projectId, spineId, prd(), 'md', { generationMeta: completeMeta() });
    return { projectId, spineId };
}

const args = (projectId: string, spineVersionId: string) => ({
    projectId,
    spineVersionId,
    prdContent: 'md',
    structuredPRD: prd(),
    projectPlatform: undefined,
});

async function flush(turns = 2): Promise<void> {
    for (let i = 0; i < turns; i++) await new Promise((r) => setTimeout(r, 0));
}

async function settle(projectId: string): Promise<void> {
    for (let i = 0; i < 500; i++) {
        await new Promise((r) => setTimeout(r, 0));
        if (!artifactJobController.isActive(projectId)) {
            await new Promise((r) => setTimeout(r, 0));
            if (!artifactJobController.isActive(projectId)) return;
        }
    }
    throw new Error('run did not settle');
}

const callsFor = (subtype: string): number => genMock.mock.calls.filter((c) => c[0] === subtype).length;

/** A generation that only ends when the run is aborted (an in-flight call). */
const hangUntilAborted = (_subtype: string, _prd: string, _structured: StructuredPRD, options?: { signal?: AbortSignal }) =>
    new Promise<{ content: string; metadata: Record<string, unknown> }>((_resolve, reject) => {
        options?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
    });

beforeEach(() => {
    resetStore();
    setActiveProjectUser(null);
    genMock.mockReset();
    genMock.mockImplementation(async (subtype: string) => ({ content: `${subtype} content`, metadata: {} }));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('automatic resume is capped per slot (N5)', () => {
    it('re-runs a deterministically failing slot at most MAX_AUTO_RESUME_ATTEMPTS times, then leaves it failed for Retry', async () => {
        const { projectId, spineId } = seedCompleteProject();
        genMock.mockImplementation(async (subtype: string) => {
            if (subtype === 'data_model') throw new Error('schema rejected');
            return { content: `${subtype} content`, metadata: {} };
        });

        artifactJobController.startAll(args(projectId, spineId)); // the user's run
        await settle(projectId);
        expect(callsFor('data_model')).toBe(1);

        // Every Build mount calls resumeIfNeeded. Only the first N re-run it.
        for (let mount = 0; mount < MAX_AUTO_RESUME_ATTEMPTS + 2; mount++) {
            artifactJobController.resumeIfNeeded(args(projectId, spineId));
            await settle(projectId);
        }
        expect(callsFor('data_model')).toBe(1 + MAX_AUTO_RESUME_ATTEMPTS);

        const slot = useProjectStore.getState().jobs[projectId]?.slots.data_model;
        expect(slot?.status).toBe('error');
        expect(slot?.error?.message).toContain('schema rejected');

        // The manual Retry still runs it.
        artifactJobController.retrySlot('data_model', args(projectId, spineId));
        await settle(projectId);
        expect(callsFor('data_model')).toBe(2 + MAX_AUTO_RESUME_ATTEMPTS);
    });

    it('does not count the user\'s own runs against the automatic budget', async () => {
        const { projectId, spineId } = seedCompleteProject();
        genMock.mockImplementation(async (subtype: string) => {
            if (subtype === 'data_model') throw new Error('schema rejected');
            return { content: `${subtype} content`, metadata: {} };
        });

        artifactJobController.startAll(args(projectId, spineId));
        await settle(projectId);
        artifactJobController.startAll(args(projectId, spineId)); // "Generate outputs" again
        await settle(projectId);
        expect(useProjectStore.getState().jobs[projectId]?.slots.data_model?.autoResumeAttempts).toBeUndefined();

        artifactJobController.resumeIfNeeded(args(projectId, spineId));
        await settle(projectId);
        expect(callsFor('data_model')).toBe(3);
    });
});

describe('durable output-run marker (reload before the first output lands)', () => {
    it('stamps a running marker when a run launches and clears it when the run settles', async () => {
        const { projectId, spineId } = seedCompleteProject();
        let release!: () => void;
        const gate = new Promise<void>((r) => { release = r; });
        genMock.mockImplementation(async (subtype: string) => {
            await gate;
            return { content: `${subtype} content`, metadata: {} };
        });

        artifactJobController.startAll(args(projectId, spineId));
        const marker = useProjectStore.getState().projects[projectId]?.outputRun;
        expect(marker).toMatchObject({ spineVersionId: spineId, phase: 'running' });
        expect(marker?.runId).toBe(useProjectStore.getState().jobs[projectId]?.runId);

        release();
        await settle(projectId);
        expect(useProjectStore.getState().projects[projectId]?.outputRun).toBeUndefined();
    });

    it('a page load turns a leftover running marker into interrupted', async () => {
        const project = { id: 'p-reload', name: 'P', createdAt: 1 };
        localStorage.setItem('synapse-projects-storage', JSON.stringify({
            state: {
                projects: {
                    'p-reload': { ...project, outputRun: { spineVersionId: 's1', runId: 'r1', startedAt: 1, phase: 'running' } },
                    'p-settled': { ...project, id: 'p-settled' },
                },
            },
            version: 0,
        }));

        await useProjectStore.persist.rehydrate();

        const projects = useProjectStore.getState().projects;
        expect(projects['p-reload']?.outputRun).toMatchObject({ runId: 'r1', phase: 'interrupted' });
        expect(projects['p-settled']?.outputRun).toBeUndefined();
    });

    it('resumes a run interrupted before any output completed, then settles the marker', async () => {
        const { projectId, spineId } = seedCompleteProject();
        // State after the reload: no outputs, no job, an interrupted marker.
        useProjectStore.setState((s) => ({
            projects: {
                ...s.projects,
                [projectId]: {
                    ...s.projects[projectId],
                    outputRun: { spineVersionId: spineId, runId: 'before-reload', startedAt: 1, phase: 'interrupted' },
                },
            },
        }));

        artifactJobController.resumeIfNeeded(args(projectId, spineId));
        await settle(projectId);

        expect(callsFor('screen_inventory')).toBe(1);
        expect(callsFor('data_model')).toBe(1);
        expect(callsFor('implementation_plan')).toBe(1);
        expect(useProjectStore.getState().projects[projectId]?.outputRun).toBeUndefined();
    });
});

describe('a superseded run cannot clobber the run that replaced it (N8)', () => {
    it('ignores the old run\'s late markAllInterrupted and leaves the new run\'s marker in place', async () => {
        const { projectId, spineId } = seedCompleteProject();
        genMock.mockImplementation(hangUntilAborted);

        // The first run starts while its spine is still the latest.
        artifactJobController.startAll(args(projectId, spineId));
        await flush();
        expect(useProjectStore.getState().jobs[projectId]?.slots.data_model?.status).toBe('generating');

        // A newer spine (e.g. after an edit) becomes the latest mid-run.
        const nextSpine: SpineVersion = {
            id: 'spine-2',
            projectId,
            promptText: 'idea',
            responseText: 'md',
            createdAt: Date.now(),
            isLatest: true,
            isFinal: false,
            generationPhase: 'complete',
            structuredPRD: prd(),
        };
        useProjectStore.setState((s) => ({
            spineVersions: {
                ...s.spineVersions,
                [projectId]: [...s.spineVersions[projectId].map((sp) => ({ ...sp, isLatest: false })), nextSpine],
            },
        }));

        // The new spine's run supersedes (aborts) the old one.
        artifactJobController.startAll(args(projectId, 'spine-2'));
        await flush(6); // let the aborted run settle completely

        const job = useProjectStore.getState().jobs[projectId];
        expect(job?.spineVersionId).toBe('spine-2');
        const statuses = Object.values(job?.slots ?? {}).map((s) => s?.status);
        expect(statuses).not.toContain('interrupted');
        expect(statuses).toContain('generating');
        expect(useProjectStore.getState().projects[projectId]?.outputRun)
            .toMatchObject({ spineVersionId: 'spine-2', phase: 'running', runId: job?.runId });

        artifactJobController.cancelAll(projectId);
        await flush();
        expect(useProjectStore.getState().jobs[projectId]?.slots.data_model?.status).toBe('interrupted');
    });
});

describe('only the latest spine may drive generation', () => {
    // History Mode can select an old PRD; a run started from it would make
    // outputs regenerated from that old plan the project's current ones.
    it('refuses startAll, regenerateSlots and retrySlot for a historical spine', async () => {
        const { projectId, spineId } = seedCompleteProject();
        const nextSpine: SpineVersion = {
            id: 'spine-2',
            projectId,
            promptText: 'idea',
            responseText: 'md',
            createdAt: Date.now(),
            isLatest: true,
            isFinal: false,
            generationPhase: 'complete',
            structuredPRD: prd(),
        };
        useProjectStore.setState((s) => ({
            spineVersions: {
                ...s.spineVersions,
                [projectId]: [...s.spineVersions[projectId].map((sp) => ({ ...sp, isLatest: false })), nextSpine],
            },
        }));

        artifactJobController.startAll(args(projectId, spineId));
        artifactJobController.regenerateSlots(['data_model'], args(projectId, spineId));
        artifactJobController.retrySlot('data_model', args(projectId, spineId));
        await flush(4);

        expect(genMock).not.toHaveBeenCalled();
        expect(artifactJobController.isActive(projectId)).toBe(false);
        expect(useProjectStore.getState().jobs[projectId]).toBeUndefined();
        expect(useProjectStore.getState().projects[projectId]?.outputRun).toBeUndefined();

        // The latest spine still generates.
        artifactJobController.startAll(args(projectId, 'spine-2'));
        await settle(projectId);
        expect(callsFor('data_model')).toBe(1);
    });
});

describe('an incomplete PRD acknowledged once keeps generating ("Generate anyway" is durable)', () => {
    // Finalize used to leave `isFinal` behind as the durable acknowledgement.
    // Without a durable record, the per-run flag dies with the run, so
    // regenerateSlots (Sync outputs / dependency graph) and resumeIfNeeded
    // silently refused every spine with failed sections.
    function seedIncompleteProject(): { projectId: string; spineId: string } {
        const store = useProjectStore.getState();
        const { projectId, spineId } = store.createProject('P', 'idea');
        store.updateSpineStructuredPRD(projectId, spineId, prd(), 'md', {
            generationMeta: { ...completeMeta(), failedSections: ['risks'] },
        });
        return { projectId, spineId };
    }

    it('regenerateSlots runs once the version is acknowledged, and not before', async () => {
        const { projectId, spineId } = seedIncompleteProject();

        artifactJobController.regenerateSlots(['design_system'], args(projectId, spineId));
        await flush(4);
        expect(genMock).not.toHaveBeenCalled();

        useProjectStore.getState().acknowledgeIncompleteSpine(projectId, spineId);
        artifactJobController.regenerateSlots(['design_system'], args(projectId, spineId));
        await settle(projectId);
        expect(callsFor('design_system')).toBe(1);
    });

    it('resumeIfNeeded resumes a run started with "Generate anyway" after the per-run flag is gone', async () => {
        const { projectId, spineId } = seedIncompleteProject();
        genMock.mockImplementation(async (subtype: string) => {
            if (subtype === 'data_model' && callsFor('data_model') === 1) throw new Error('schema rejected');
            return { content: `${subtype} content`, metadata: {} };
        });

        // "Generate anyway": the per-run flag AND the durable record.
        useProjectStore.getState().acknowledgeIncompleteSpine(projectId, spineId);
        artifactJobController.startAll({ ...args(projectId, spineId), acknowledgeIncomplete: true });
        await settle(projectId);
        expect(callsFor('data_model')).toBe(1);

        // A later Build mount resumes with plain args (no per-run flag).
        artifactJobController.resumeIfNeeded(args(projectId, spineId));
        await settle(projectId);
        expect(callsFor('data_model')).toBe(2);
    });

    it('without the durable record a resume after the run is still refused', async () => {
        const { projectId, spineId } = seedIncompleteProject();
        genMock.mockImplementation(async (subtype: string) => {
            if (subtype === 'data_model') throw new Error('schema rejected');
            return { content: `${subtype} content`, metadata: {} };
        });

        artifactJobController.startAll({ ...args(projectId, spineId), acknowledgeIncomplete: true });
        await settle(projectId);
        artifactJobController.resumeIfNeeded(args(projectId, spineId));
        await settle(projectId);
        expect(callsFor('data_model')).toBe(1);
    });
});

describe('output-run lease across tabs (a second tab must not duplicate a live run)', () => {
    const STORAGE_KEY = 'synapse-projects-storage';
    const runMarker = (spineVersionId: string, ownerTabId: string, heartbeatAt: number): OutputRunMarker => ({
        spineVersionId,
        runId: 'first-tab-run',
        startedAt: heartbeatAt - 30_000,
        phase: 'running',
        ownerTabId,
        heartbeatAt,
    });

    /** Persist the project as the owning tab last wrote it (marker included). */
    function persistOwnerState(projectId: string, outputRun: OutputRunMarker): void {
        const s = useProjectStore.getState();
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
            state: {
                projects: { ...s.projects, [projectId]: { ...s.projects[projectId], outputRun } },
                spineVersions: s.spineVersions,
                historyEvents: s.historyEvents,
                artifacts: s.artifacts,
                artifactVersions: s.artifactVersions,
            },
            version: 0,
        }));
    }

    /** This store plays a second tab that loads now: rehydrate from storage. */
    async function loadAsThisTab(): Promise<void> {
        await useProjectStore.persist.rehydrate();
    }

    const markerOf = (projectId: string) => useProjectStore.getState().projects[projectId]?.outputRun;

    it('a second tab loading during a live run (fresh heartbeat) neither interrupts nor resumes it', async () => {
        const { projectId, spineId } = seedCompleteProject();
        persistOwnerState(projectId, runMarker(spineId, 'first-tab', Date.now()));

        await loadAsThisTab();
        expect(markerOf(projectId)?.phase).toBe('running');

        artifactJobController.resumeIfNeeded(args(projectId, spineId));
        artifactJobController.startAll(args(projectId, spineId)); // even an explicit start
        artifactJobController.retrySlot('data_model', args(projectId, spineId));
        await flush();

        expect(genMock).not.toHaveBeenCalled();
        expect(artifactJobController.isActive(projectId)).toBe(false);
        expect(artifactJobController.isRunLiveElsewhere(projectId)).toBe(true);
    });

    it('a stale heartbeat (the owning tab died) is interrupted on load and resumed', async () => {
        const { projectId, spineId } = seedCompleteProject();
        persistOwnerState(projectId, runMarker(spineId, 'first-tab', Date.now() - OUTPUT_RUN_LEASE_MS - 1_000));

        await loadAsThisTab();
        expect(markerOf(projectId)?.phase).toBe('interrupted');

        artifactJobController.resumeIfNeeded(args(projectId, spineId));
        await settle(projectId);
        expect(callsFor('data_model')).toBe(1);
    });

    it('the same tab\'s own reload is interrupted on load and resumed, however fresh the heartbeat', async () => {
        const { projectId, spineId } = seedCompleteProject();
        persistOwnerState(projectId, runMarker(spineId, getTabId(), Date.now()));

        await loadAsThisTab();
        expect(markerOf(projectId)?.phase).toBe('interrupted');

        artifactJobController.resumeIfNeeded(args(projectId, spineId));
        await settle(projectId);
        expect(callsFor('data_model')).toBe(1);
    });

    it('a long-open tab checks what the owner last persisted before resuming', async () => {
        const { projectId, spineId } = seedCompleteProject();
        // This tab's memory holds the other tab's marker from an earlier merge
        // — its heartbeat looks lapsed here, because heartbeats only reach this
        // tab's memory when it adopts a merge…
        useProjectStore.setState((s) => ({
            projects: {
                ...s.projects,
                [projectId]: { ...s.projects[projectId], outputRun: runMarker(spineId, 'first-tab', Date.now() - 60_000) },
            },
        }));
        // …while the owner keeps heartbeating into storage.
        persistOwnerState(projectId, runMarker(spineId, 'first-tab', Date.now()));

        artifactJobController.resumeIfNeeded(args(projectId, spineId));
        await flush();

        expect(genMock).not.toHaveBeenCalled();
    });

    it('the owning tab refreshes its heartbeat while the run is live and drops the lease when it settles', async () => {
        vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
        try {
            const { projectId, spineId } = seedCompleteProject();
            genMock.mockImplementation(hangUntilAborted);

            artifactJobController.startAll(args(projectId, spineId));
            const stamped = markerOf(projectId);
            expect(stamped).toMatchObject({ phase: 'running', ownerTabId: getTabId() });

            vi.advanceTimersByTime(OUTPUT_RUN_HEARTBEAT_MS);
            expect(markerOf(projectId)?.heartbeatAt).toBe((stamped?.heartbeatAt ?? 0) + OUTPUT_RUN_HEARTBEAT_MS);

            artifactJobController.cancelAll(projectId);
            await flush(6);
            expect(markerOf(projectId)).toBeUndefined();
            expect(vi.getTimerCount()).toBe(0); // the heartbeat interval is gone
        } finally {
            vi.useRealTimers();
        }
    });
});
