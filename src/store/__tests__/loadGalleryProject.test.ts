import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useProjectStore } from '../projectStore';
import { GALLERY_PROJECT_IDS, galleryProjectIdForSlot } from '../../data/demoProject';
import { DEMO_CACHE_POLICY_VERSION } from '../slices/projectSlice';
import type { SnapshotPayload } from '../../lib/snapshotClient';
import type { Project } from '../../types';

// Gallery hydration shares `loadShowcaseProject` with the demo (which has its
// own suite in loadDemoProject.test.ts). Here we verify the gallery-specific
// wiring: the per-slot pointer probe, the per-slot target project id, the
// stamp, and the out-of-range slot guard.
vi.mock('../../lib/snapshotClient', () => ({
    loadDemoSnapshotPointer: vi.fn(),
    loadDemoSnapshotPublic: vi.fn(),
    loadGalleryPointerPublic: vi.fn(),
    loadGallerySnapshotPublic: vi.fn(),
    restoreSnapshotAs: vi.fn(),
}));

import {
    loadGalleryPointerPublic,
    loadGallerySnapshotPublic,
    restoreSnapshotAs,
} from '../../lib/snapshotClient';

const mockedPointer = vi.mocked(loadGalleryPointerPublic);
const mockedPublic = vi.mocked(loadGallerySnapshotPublic);
const mockedRestore = vi.mocked(restoreSnapshotAs);

const SLOT = 2;
const SLOT_PROJECT_ID = GALLERY_PROJECT_IDS[SLOT];

const pointerState = (snapshotIds: string[]) => ({
    mode: 'gallery' as const,
    snapshotIds,
    size: 12,
    minLive: 2,
    updatedAt: null,
});

function seedSlot(sourceId: string | undefined): void {
    const project: Project = {
        id: SLOT_PROJECT_ID,
        name: 'Gallery project',
        createdAt: 0,
        demoCachePolicyVersion: DEMO_CACHE_POLICY_VERSION,
        ...(sourceId ? { demoSourceSnapshotId: sourceId } : {}),
    };
    useProjectStore.setState((state) => ({
        projects: { ...state.projects, [SLOT_PROJECT_ID]: project },
    }));
}

function fakePayload(snapshotId: string): SnapshotPayload {
    return {
        schemaVersion: 2,
        manifest: {
            id: snapshotId,
            title: 't',
            projectName: 'Gallery project',
            createdAt: '2026-01-01',
            schemaVersion: 2,
            imageCount: 0,
        },
        project: {
            project: { id: SLOT_PROJECT_ID, name: 'Gallery project', createdAt: 0 },
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

describe('loadGalleryProject — per-slot hydration', () => {
    it('reports unavailable (null project id) for an out-of-range slot', async () => {
        const result = await useProjectStore.getState().loadGalleryProject(99);

        expect(result).toEqual({ projectId: null, available: false });
        expect(mockedPointer).not.toHaveBeenCalled();
        expect(mockedPublic).not.toHaveBeenCalled();
    });

    it('fetches the slot payload and stamps its snapshot id on first load', async () => {
        mockedPointer.mockResolvedValue(pointerState(['s0', 's1', 'snap-C']));
        mockedPublic.mockResolvedValue(fakePayload('snap-C'));

        const result = await useProjectStore.getState().loadGalleryProject(SLOT);

        expect(result).toEqual({ projectId: SLOT_PROJECT_ID, available: true });
        expect(mockedPublic).toHaveBeenCalledWith(SLOT);
        expect(mockedRestore).toHaveBeenCalledWith(expect.anything(), SLOT_PROJECT_ID);
        const project = useProjectStore.getState().projects[SLOT_PROJECT_ID];
        expect(project?.demoSourceSnapshotId).toBe('snap-C');
    });

    it('serves the cached slot when its stamp matches the live pointer', async () => {
        seedSlot('snap-C');
        mockedPointer.mockResolvedValue(pointerState(['s0', 's1', 'snap-C']));

        const result = await useProjectStore.getState().loadGalleryProject(SLOT);

        expect(result).toEqual({ projectId: SLOT_PROJECT_ID, available: true });
        expect(mockedPublic).not.toHaveBeenCalled();
        expect(mockedRestore).not.toHaveBeenCalled();
    });

    it('re-fetches when the owner has pinned a different snapshot into the slot', async () => {
        seedSlot('snap-C');
        mockedPointer.mockResolvedValue(pointerState(['s0', 's1', 'snap-D']));
        mockedPublic.mockResolvedValue(fakePayload('snap-D'));

        const result = await useProjectStore.getState().loadGalleryProject(SLOT);

        expect(result).toEqual({ projectId: SLOT_PROJECT_ID, available: true });
        expect(mockedRestore).toHaveBeenCalledTimes(1);
        const project = useProjectStore.getState().projects[SLOT_PROJECT_ID];
        expect(project?.demoSourceSnapshotId).toBe('snap-D');
    });

    it('keeps serving the cached slot when the pointer probe fails', async () => {
        seedSlot('snap-C');
        mockedPointer.mockResolvedValue(null);

        const result = await useProjectStore.getState().loadGalleryProject(SLOT);

        expect(result).toEqual({ projectId: SLOT_PROJECT_ID, available: true });
        expect(mockedPublic).not.toHaveBeenCalled();
    });

    it('reports unavailable when the slot is empty and nothing is cached', async () => {
        mockedPointer.mockResolvedValue(pointerState(['s0']));
        mockedPublic.mockResolvedValue(null); // server 404s the empty slot

        const result = await useProjectStore.getState().loadGalleryProject(SLOT);

        expect(result).toEqual({ projectId: SLOT_PROJECT_ID, available: false });
    });

    it('drops the cached copy when the owner has removed the slot (probe ok, slot empty)', async () => {
        seedSlot('snap-C');
        // The pointer probe SUCCEEDS but the slot no longer holds a snapshot —
        // removed content must not keep serving from cache on this device.
        mockedPointer.mockResolvedValue(pointerState(['s0', 's1']));

        const result = await useProjectStore.getState().loadGalleryProject(SLOT);

        expect(result).toEqual({ projectId: SLOT_PROJECT_ID, available: false });
        expect(useProjectStore.getState().projects[SLOT_PROJECT_ID]).toBeUndefined();
        expect(mockedPublic).not.toHaveBeenCalled();
        expect(mockedRestore).not.toHaveBeenCalled();
    });

    it('does NOT stamp when the slot load dropped images (self-heals next open)', async () => {
        mockedPointer.mockResolvedValue(pointerState(['s0', 's1', 'snap-C']));
        mockedPublic.mockResolvedValue({ ...fakePayload('snap-C'), imagesComplete: false });

        const result = await useProjectStore.getState().loadGalleryProject(SLOT);

        expect(result).toEqual({ projectId: SLOT_PROJECT_ID, available: true });
        expect(mockedRestore).toHaveBeenCalledTimes(1);
        const project = useProjectStore.getState().projects[SLOT_PROJECT_ID];
        expect(project?.demoSourceSnapshotId).toBeUndefined();
    });

    it('keeps a stamped (known-complete) cache instead of restoring a partial fetch', async () => {
        seedSlot('snap-C');
        mockedPointer.mockResolvedValue(pointerState(['s0', 's1', 'snap-D']));
        mockedPublic.mockResolvedValue({ ...fakePayload('snap-D'), imagesComplete: false });

        const result = await useProjectStore.getState().loadGalleryProject(SLOT);

        expect(result).toEqual({ projectId: SLOT_PROJECT_ID, available: true });
        expect(mockedRestore).not.toHaveBeenCalled();
        const project = useProjectStore.getState().projects[SLOT_PROJECT_ID];
        expect(project?.demoSourceSnapshotId).toBe('snap-C');
    });

    it('hydrates two different slots under two different project ids', async () => {
        mockedPointer.mockResolvedValue(pointerState(['snap-A', 'snap-B']));
        mockedPublic.mockImplementation(async (slot) => fakePayload(slot === 0 ? 'snap-A' : 'snap-B'));

        await useProjectStore.getState().loadGalleryProject(0);
        await useProjectStore.getState().loadGalleryProject(1);

        expect(useProjectStore.getState().projects[galleryProjectIdForSlot(0)!]).toBeTruthy();
        expect(useProjectStore.getState().projects[galleryProjectIdForSlot(1)!]).toBeTruthy();
        expect(mockedRestore).toHaveBeenCalledTimes(2);
    });
});
