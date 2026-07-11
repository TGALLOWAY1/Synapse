import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useProjectStore } from '../projectStore';
import { DEMO_PROJECT_ID } from '../../data/demoProject';
import { DEMO_CACHE_POLICY_VERSION } from '../slices/projectSlice';
import type { SnapshotPayload } from '../../lib/snapshotClient';
import type { Project } from '../../types';

// We don't care about the bundle/image plumbing here — `restoreSnapshotAs`
// already has its own coverage. We just need to verify `loadDemoProject`
// short-circuits when the cached demo matches the live pointer, and
// re-fetches when it doesn't.
vi.mock('../../lib/snapshotClient', () => ({
    loadDemoSnapshotPointer: vi.fn(),
    loadDemoSnapshotPublic: vi.fn(),
    restoreSnapshotAs: vi.fn(),
}));

import {
    loadDemoSnapshotPointer,
    loadDemoSnapshotPublic,
    restoreSnapshotAs,
} from '../../lib/snapshotClient';

const mockedPointer = vi.mocked(loadDemoSnapshotPointer);
const mockedPublic = vi.mocked(loadDemoSnapshotPublic);
const mockedRestore = vi.mocked(restoreSnapshotAs);

function seedDemo(sourceId: string | undefined): void {
    const project: Project = {
        id: DEMO_PROJECT_ID,
        name: 'Demo',
        createdAt: 0,
        demoCachePolicyVersion: DEMO_CACHE_POLICY_VERSION,
        ...(sourceId ? { demoSourceSnapshotId: sourceId } : {}),
    };
    useProjectStore.setState((state) => ({
        projects: { ...state.projects, [DEMO_PROJECT_ID]: project },
    }));
}

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

beforeEach(() => {
    useProjectStore.setState({
        projects: {},
        spineVersions: {},
        historyEvents: {},
        branches: {},
        artifacts: {},
        artifactVersions: {},
        feedbackItems: {},
    });
    localStorage.clear();
    mockedPointer.mockReset();
    mockedPublic.mockReset();
    mockedRestore.mockReset();
    // The mock `restoreSnapshotAs` should still write the project into the
    // store so the post-restore source-id stamp has something to update.
    mockedRestore.mockImplementation(async (payload, targetId) => {
        useProjectStore.setState((state) => ({
            projects: {
                ...state.projects,
                [targetId]: {
                    ...payload.project.project,
                    id: targetId,
                },
            },
        }));
        return targetId;
    });
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('loadDemoProject — freshness check', () => {
    it('serves the cached demo when its source snapshot id matches the live pointer', async () => {
        seedDemo('snap-A');
        mockedPointer.mockResolvedValue({ snapshotId: 'snap-A', updatedAt: null });

        const result = await useProjectStore.getState().loadDemoProject();

        expect(result).toEqual({ projectId: DEMO_PROJECT_ID, available: true });
        expect(mockedPublic).not.toHaveBeenCalled();
        expect(mockedRestore).not.toHaveBeenCalled();
    });

    it('re-fetches and restores when the owner has pinned a newer snapshot', async () => {
        seedDemo('snap-A');
        mockedPointer.mockResolvedValue({ snapshotId: 'snap-B', updatedAt: null });
        mockedPublic.mockResolvedValue(fakePayload('snap-B'));

        const result = await useProjectStore.getState().loadDemoProject();

        expect(result).toEqual({ projectId: DEMO_PROJECT_ID, available: true });
        expect(mockedPublic).toHaveBeenCalledTimes(1);
        expect(mockedRestore).toHaveBeenCalledTimes(1);
        // The new source id is stamped so the NEXT click can short-circuit.
        const project = useProjectStore.getState().projects[DEMO_PROJECT_ID];
        expect(project?.demoSourceSnapshotId).toBe('snap-B');
    });

    it('re-fetches when the cache exists but carries no source id (legacy cache)', async () => {
        seedDemo(undefined);
        mockedPointer.mockResolvedValue({ snapshotId: 'snap-A', updatedAt: null });
        mockedPublic.mockResolvedValue(fakePayload('snap-A'));

        await useProjectStore.getState().loadDemoProject();

        expect(mockedPublic).toHaveBeenCalledTimes(1);
        const project = useProjectStore.getState().projects[DEMO_PROJECT_ID];
        expect(project?.demoSourceSnapshotId).toBe('snap-A');
    });

    it('keeps serving the cached demo when the pointer probe itself fails', async () => {
        seedDemo('snap-A');
        mockedPointer.mockResolvedValue(null);

        const result = await useProjectStore.getState().loadDemoProject();

        expect(result).toEqual({ projectId: DEMO_PROJECT_ID, available: true });
        expect(mockedPublic).not.toHaveBeenCalled();
    });

    it('reports unavailable when no cache exists and the demo fetch fails', async () => {
        mockedPointer.mockResolvedValue({ snapshotId: 'snap-X', updatedAt: null });
        mockedPublic.mockResolvedValue(null);

        const result = await useProjectStore.getState().loadDemoProject();

        expect(result).toEqual({ projectId: DEMO_PROJECT_ID, available: false });
    });

    it('fetches and stamps the source id on first load (no cache)', async () => {
        mockedPointer.mockResolvedValue({ snapshotId: 'snap-A', updatedAt: null });
        mockedPublic.mockResolvedValue(fakePayload('snap-A'));

        await useProjectStore.getState().loadDemoProject();

        const project = useProjectStore.getState().projects[DEMO_PROJECT_ID];
        expect(project?.demoSourceSnapshotId).toBe('snap-A');
    });

    it('restores but does NOT stamp the source id when the load dropped images', async () => {
        mockedPointer.mockResolvedValue({ snapshotId: 'snap-A', updatedAt: null });
        // Some per-image fetches failed permanently (flaky network / rate
        // limit) — the payload arrives fresh but incomplete.
        mockedPublic.mockResolvedValue({ ...fakePayload('snap-A'), imagesComplete: false });

        const result = await useProjectStore.getState().loadDemoProject();

        // Fresh-partial still beats stale cache — the demo restores and opens…
        expect(result).toEqual({ projectId: DEMO_PROJECT_ID, available: true });
        expect(mockedRestore).toHaveBeenCalledTimes(1);
        // …but no stamp, so the NEXT open re-fetches and self-heals instead of
        // pinning the partial copy as "current".
        const project = useProjectStore.getState().projects[DEMO_PROJECT_ID];
        expect(project?.demoSourceSnapshotId).toBeUndefined();
    });
});
