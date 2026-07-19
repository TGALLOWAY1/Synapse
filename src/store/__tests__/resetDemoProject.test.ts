import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useProjectStore } from '../projectStore';
import { DEMO_PROJECT_ID } from '../../data/demoProject';
import type { SnapshotPayload } from '../../lib/snapshotClient';
import type { ArtifactVersion, Project, ProjectJobState } from '../../types';
import type { SectionId } from '../../lib/schemas/prdSchemas';
import type { PrdSectionStatusEntry } from '../slices/prdProgressSlice';

// Mirrors loadDemoProject.test.ts's seam — we don't care about the bundle/
// image plumbing inside restoreSnapshotAs, only that resetDemoProject wipes
// the demo namespace and then drives a full re-fetch + restore.
vi.mock('../../lib/snapshotClient', () => ({
    loadDemoSnapshotPointer: vi.fn(),
    loadDemoSnapshotPublic: vi.fn(),
    restoreSnapshotAs: vi.fn(),
}));

// In-memory fakes for the three IDB image libs resetDemoProject deletes
// from, plus their reactive Zustand caches (mockupImageStore /
// screenInventoryImageStore import several other named exports from these
// same lib modules — supply them all so those store modules keep working).
vi.mock('../../lib/mockupImageStore', () => ({
    buildImageKey: (v: string, s: string, q: string) => `${v}:${s}:${q}`,
    buildScreenScopeKey: (v: string, s: string) => `${v}:${s}:`,
    getImage: vi.fn(async () => undefined),
    listImagesForVersion: vi.fn(async () => []),
    putImage: vi.fn(async () => {}),
    deleteImagesForVersion: vi.fn(async () => {}),
}));

vi.mock('../../lib/screenInventoryImageStore', () => ({
    slugifyScreenName: (name: string) => name.toLowerCase(),
    buildScreenImageKey: (v: string, s: string, n: number) => `${v}:${s}:${n}`,
    listScreenImagesForArtifactVersion: vi.fn(async () => []),
    putScreenImage: vi.fn(async () => {}),
    setPreferredScreenImage: vi.fn(async () => []),
    deleteScreenImagesForArtifactVersion: vi.fn(async () => {}),
}));

vi.mock('../../lib/mockupVariantImageStore', () => ({
    buildVariantImageKey: (v: string, s: string, variant: string, q: string) => `${v}:${s}:${variant}:${q}`,
    getVariantImage: vi.fn(async () => undefined),
    listVariantImagesForVersion: vi.fn(async () => []),
    putVariantImage: vi.fn(async () => {}),
    deleteVariantImagesForVersion: vi.fn(async () => {}),
}));

import {
    loadDemoSnapshotPointer,
    loadDemoSnapshotPublic,
    restoreSnapshotAs,
} from '../../lib/snapshotClient';
import { deleteImagesForVersion } from '../../lib/mockupImageStore';
import { deleteScreenImagesForArtifactVersion } from '../../lib/screenInventoryImageStore';
import { deleteVariantImagesForVersion } from '../../lib/mockupVariantImageStore';
import { useMockupImageStore } from '../mockupImageStore';
import { useScreenInventoryImageStore } from '../screenInventoryImageStore';
import { useMockupVariantImageStore } from '../mockupVariantImageStore';

const mockedPointer = vi.mocked(loadDemoSnapshotPointer);
const mockedPublic = vi.mocked(loadDemoSnapshotPublic);
const mockedRestore = vi.mocked(restoreSnapshotAs);
const mockedDeleteImages = vi.mocked(deleteImagesForVersion);
const mockedDeleteScreenImages = vi.mocked(deleteScreenImagesForArtifactVersion);
const mockedDeleteVariantImages = vi.mocked(deleteVariantImagesForVersion);

function fakePayload(snapshotId: string): SnapshotPayload {
    return {
        schemaVersion: 2,
        manifest: {
            id: snapshotId,
            title: 't',
            projectName: 'Demo',
            createdAt: '2026-01-01',
            schemaVersion: 2,
            imageCount: 0,
        },
        project: {
            project: { id: DEMO_PROJECT_ID, name: 'Demo', createdAt: 0 },
            spineVersions: [],
            historyEvents: [],
            branches: [],
            artifacts: [],
            artifactVersions: [],
            feedbackItems: [],
        },
        images: [],
    };
}

const makeVersion = (id: string): ArtifactVersion => ({
    id,
    artifactId: 'artifact-1',
    versionNumber: 1,
    parentVersionId: null,
    content: 'content',
    metadata: {},
    sourceRefs: [],
    generationPrompt: '',
    isPreferred: true,
    createdAt: 0,
});

/** Populates every demo-keyed slice with corrupted/mutated data — including a
 * stray artifact version, tasks, and transient job/progress entries — so a
 * reset has something real to wipe. */
function seedCorruptedDemo(): void {
    const project: Project = {
        id: DEMO_PROJECT_ID,
        name: 'Demo',
        createdAt: 0,
        demoSourceSnapshotId: 'snap-old',
    };
    useProjectStore.setState((state) => ({
        projects: { ...state.projects, [DEMO_PROJECT_ID]: project },
        spineVersions: { ...state.spineVersions, [DEMO_PROJECT_ID]: [] },
        historyEvents: { ...state.historyEvents, [DEMO_PROJECT_ID]: [] },
        branches: { ...state.branches, [DEMO_PROJECT_ID]: [] },
        artifacts: { ...state.artifacts, [DEMO_PROJECT_ID]: [] },
        artifactVersions: {
            ...state.artifactVersions,
            [DEMO_PROJECT_ID]: [makeVersion('stray-version-1'), makeVersion('stray-version-2')],
        },
        feedbackItems: { ...state.feedbackItems, [DEMO_PROJECT_ID]: [] },
        tasks: { ...state.tasks, [DEMO_PROJECT_ID]: [] },
        workflowRuns: { ...state.workflowRuns, [DEMO_PROJECT_ID]: [] },
        jobs: {
            ...state.jobs,
            [DEMO_PROJECT_ID]: {
                spineVersionId: 'v1',
                startedAt: 0,
                slots: {},
            } as unknown as ProjectJobState,
        },
        prdProgress: { ...state.prdProgress, [DEMO_PROJECT_ID]: { messages: ['hi'], updatedAt: 0 } },
        prdSectionStatus: {
            ...state.prdSectionStatus,
            [DEMO_PROJECT_ID]: {
                product_basics: { tier: 'fast', status: 'complete' },
            } as unknown as Record<SectionId, PrdSectionStatusEntry>,
        },
    }));
}

beforeEach(() => {
    useProjectStore.setState({
        projects: {},
        spineVersions: {},
        historyEvents: {},
        branches: {},
        artifacts: {},
        artifactVersions: {},
        feedbackItems: {},
        tasks: {},
        workflowRuns: {},
        jobs: {},
        prdProgress: {},
        prdSectionStatus: {},
    });
    useMockupImageStore.setState({ images: {}, inFlight: {}, errors: {}, loadedVersions: {} });
    useScreenInventoryImageStore.setState({ images: {}, hydrated: {}, uploading: {}, errors: {} });
    useMockupVariantImageStore.setState({ images: {}, inFlight: {}, errors: {} });
    localStorage.clear();

    mockedPointer.mockReset();
    mockedPublic.mockReset();
    mockedRestore.mockReset();
    mockedDeleteImages.mockClear();
    mockedDeleteScreenImages.mockClear();
    mockedDeleteVariantImages.mockClear();

    // Same pattern as loadDemoProject.test.ts: the mocked restore only
    // touches `projects[targetId]`, so any other demo-keyed slice still
    // showing data after a reset+reload proves the wipe didn't happen (the
    // mock can't have "fixed" it by restoring it).
    mockedRestore.mockImplementation(async (payload, targetId) => {
        useProjectStore.setState((state) => ({
            projects: {
                ...state.projects,
                [targetId]: { ...payload.project.project, id: targetId },
            },
        }));
        return targetId;
    });
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('resetDemoProject', () => {
    it('wipes every demo-keyed slice and performs a full reload (no cache short-circuit)', async () => {
        seedCorruptedDemo();
        mockedPointer.mockResolvedValue({ snapshotId: 'snap-new', updatedAt: null });
        mockedPublic.mockResolvedValue(fakePayload('snap-new'));

        const result = await useProjectStore.getState().resetDemoProject();

        expect(result).toEqual({ projectId: DEMO_PROJECT_ID, available: true });

        // The nine project-keyed maps no longer carry demo data (the mocked
        // restore only repopulates `projects[DEMO_PROJECT_ID]`, so any of
        // these still holding data would prove the wipe was skipped).
        const state = useProjectStore.getState();
        expect(state.spineVersions[DEMO_PROJECT_ID]).toBeUndefined();
        expect(state.historyEvents[DEMO_PROJECT_ID]).toBeUndefined();
        expect(state.branches[DEMO_PROJECT_ID]).toBeUndefined();
        expect(state.artifacts[DEMO_PROJECT_ID]).toBeUndefined();
        expect(state.artifactVersions[DEMO_PROJECT_ID]).toBeUndefined();
        expect(state.feedbackItems[DEMO_PROJECT_ID]).toBeUndefined();
        expect(state.tasks[DEMO_PROJECT_ID]).toBeUndefined();
        expect(state.workflowRuns[DEMO_PROJECT_ID]).toBeUndefined();

        // Transients are cleared too.
        expect(state.jobs[DEMO_PROJECT_ID]).toBeUndefined();
        expect(state.prdProgress[DEMO_PROJECT_ID]).toBeUndefined();
        expect(state.prdSectionStatus[DEMO_PROJECT_ID]).toBeUndefined();

        // IDB delete helpers were invoked once per stray artifact version id.
        expect(mockedDeleteImages).toHaveBeenCalledWith('stray-version-1');
        expect(mockedDeleteImages).toHaveBeenCalledWith('stray-version-2');
        expect(mockedDeleteScreenImages).toHaveBeenCalledWith('stray-version-1');
        expect(mockedDeleteScreenImages).toHaveBeenCalledWith('stray-version-2');
        expect(mockedDeleteVariantImages).toHaveBeenCalledWith('stray-version-1');
        expect(mockedDeleteVariantImages).toHaveBeenCalledWith('stray-version-2');

        // A full restore ran — the pointer/public transport was hit and
        // restoreSnapshotAs was called; deleting `projects[DEMO_PROJECT_ID]`
        // dropped the old `demoSourceSnapshotId` stamp, so loadDemoProject
        // could never cache-short-circuit.
        expect(mockedPointer).toHaveBeenCalledTimes(1);
        expect(mockedPublic).toHaveBeenCalledTimes(1);
        expect(mockedRestore).toHaveBeenCalledTimes(1);
        expect(state.projects[DEMO_PROJECT_ID]?.demoSourceSnapshotId).toBe('snap-new');
    });

    it('resets cleanly when no demo project exists locally', async () => {
        mockedPointer.mockResolvedValue({ snapshotId: 'snap-new', updatedAt: null });
        mockedPublic.mockResolvedValue(fakePayload('snap-new'));

        const result = await useProjectStore.getState().resetDemoProject();

        expect(result).toEqual({ projectId: DEMO_PROJECT_ID, available: true });
        expect(mockedDeleteImages).not.toHaveBeenCalled();
        expect(mockedRestore).toHaveBeenCalledTimes(1);
    });

    it('does not fail the reset when an IDB delete rejects', async () => {
        seedCorruptedDemo();
        mockedDeleteImages.mockRejectedValueOnce(new Error('idb boom'));
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        mockedPointer.mockResolvedValue({ snapshotId: 'snap-new', updatedAt: null });
        mockedPublic.mockResolvedValue(fakePayload('snap-new'));

        const result = await useProjectStore.getState().resetDemoProject();

        expect(result).toEqual({ projectId: DEMO_PROJECT_ID, available: true });
        // The reset still ran to completion despite the rejected delete.
        expect(mockedRestore).toHaveBeenCalledTimes(1);
        expect(useProjectStore.getState().spineVersions[DEMO_PROJECT_ID]).toBeUndefined();
    });

    it('clears the reactive mockup/screen/variant image caches for the demo version ids', async () => {
        seedCorruptedDemo();
        useMockupImageStore.setState({
            images: {
                'stray-version-1:scr-home:low': {
                    key: 'stray-version-1:scr-home:low',
                    projectId: DEMO_PROJECT_ID,
                    artifactId: 'artifact-1',
                    versionId: 'stray-version-1',
                    screenId: 'scr-home',
                    dataUrl: 'data:image/png;base64,x',
                    quality: 'low',
                    prompt: '',
                    generatedAt: 0,
                },
            },
            inFlight: {},
            errors: {},
            loadedVersions: { 'stray-version-1': true },
        });
        useScreenInventoryImageStore.setState({
            images: {
                'stray-version-2:home:1': {
                    key: 'stray-version-2:home:1',
                    projectId: DEMO_PROJECT_ID,
                    artifactId: 'artifact-1',
                    artifactVersionId: 'stray-version-2',
                    screenSlug: 'home',
                    screenName: 'Home',
                    versionNumber: 1,
                    isPreferred: true,
                    dataUrl: 'data:image/png;base64,x',
                    mimeType: 'image/png',
                    prompt: '',
                    generatedAt: 0,
                },
            },
            hydrated: { 'stray-version-2': true },
            uploading: {},
            errors: {},
        });
        useMockupVariantImageStore.setState({
            images: {
                'stray-version-1:scr-home:mobile:default:low': {
                    key: 'stray-version-1:scr-home:mobile:default:low',
                    projectId: DEMO_PROJECT_ID,
                    artifactId: 'artifact-1',
                    versionId: 'stray-version-1',
                    screenId: 'scr-home',
                    variantId: 'mobile:default',
                    viewport: 'mobile',
                    stateName: 'Default',
                    dataUrl: 'data:image/png;base64,x',
                    quality: 'low',
                    prompt: '',
                    generatedAt: 0,
                },
            },
            inFlight: {},
            errors: {},
        });
        mockedPointer.mockResolvedValue({ snapshotId: 'snap-new', updatedAt: null });
        mockedPublic.mockResolvedValue(fakePayload('snap-new'));

        await useProjectStore.getState().resetDemoProject();

        expect(useMockupImageStore.getState().images).toEqual({});
        expect(useMockupImageStore.getState().loadedVersions).toEqual({});
        expect(useScreenInventoryImageStore.getState().images).toEqual({});
        expect(useScreenInventoryImageStore.getState().hydrated).toEqual({});
        expect(useMockupVariantImageStore.getState().images).toEqual({});
    });
});
