import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SnapshotsPanel } from '../SnapshotsPanel';
import { useProjectStore } from '../../store/projectStore';
import type { SnapshotListItem } from '../../lib/snapshotClient';

// SYN-003 pin-time hard gate: mock the snapshot transport so we can drive the
// list and assert whether `setDemoSnapshot` is (or isn't) called for a given
// snapshot's completeness metadata.
vi.mock('../../lib/snapshotClient', async () => {
    const actual = await vi.importActual<typeof import('../../lib/snapshotClient')>('../../lib/snapshotClient');
    return {
        ...actual,
        getOwnerToken: vi.fn(() => 'owner-tok'),
        setOwnerToken: vi.fn(),
        saveSnapshot: vi.fn(),
        loadSnapshot: vi.fn(),
        restoreSnapshot: vi.fn(),
        deleteSnapshot: vi.fn(),
        listSnapshots: vi.fn(),
        setDemoSnapshot: vi.fn(),
    };
});

import { listSnapshots, setDemoSnapshot } from '../../lib/snapshotClient';

const mockedList = vi.mocked(listSnapshots);
const mockedSetDemo = vi.mocked(setDemoSnapshot);

const snap = (overrides: Partial<SnapshotListItem>): SnapshotListItem => ({
    id: 'aaaaaaaa-1111-2222-3333-444444444444',
    title: 'My Snapshot',
    projectName: 'Proj',
    createdAt: '2026-07-11T00:00:00.000Z',
    schemaVersion: 2,
    imageCount: 0,
    screenImageCount: 0,
    variantImageCount: 0,
    ...overrides,
});

async function renderWith(snapshot: SnapshotListItem, demoSnapshotId: string | null = null) {
    mockedList.mockResolvedValue({ snapshots: [snapshot], demoSnapshotId });
    render(<SnapshotsPanel projectId="p1" onClose={() => {}} />);
    await screen.findByText('My Snapshot');
}

beforeEach(() => {
    useProjectStore.setState({ projects: { p1: { id: 'p1', name: 'Proj', createdAt: 1 } } });
    vi.stubGlobal('confirm', vi.fn(() => true));
    mockedList.mockReset();
    mockedSetDemo.mockReset();
    mockedSetDemo.mockResolvedValue('aaaaaaaa-1111-2222-3333-444444444444');
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('SnapshotsPanel pin-time completeness gate (SYN-003)', () => {
    it('BLOCKS pinning a snapshot whose mockup spec describes screens but carries 0 images', async () => {
        await renderWith(snap({ mockupScreenCount: 3, imageCount: 0, variantImageCount: 0 }));

        fireEvent.click(screen.getByText('Set demo'));

        expect(mockedSetDemo).not.toHaveBeenCalled();
        expect(await screen.findByText(/describes 3 screens but contains 0 rendered images/i)).toBeTruthy();
    });

    it('BLOCKS a legacy zero-image snapshot with no completeness metadata, asking for a re-save', async () => {
        // mockupScreenCount undefined = legacy manifest, and zero images.
        await renderWith(snap({ mockupScreenCount: undefined, imageCount: 0, screenImageCount: 0, variantImageCount: undefined }));

        fireEvent.click(screen.getByText('Set demo'));

        expect(mockedSetDemo).not.toHaveBeenCalled();
        expect(await screen.findByText(/Re-save this snapshot with the current app version/i)).toBeTruthy();
    });

    it('ALLOWS pinning a PRD-only demo (mockupScreenCount === 0) with no images', async () => {
        await renderWith(snap({ mockupScreenCount: 0, imageCount: 0, variantImageCount: 0 }));

        fireEvent.click(screen.getByText('Set demo'));

        await waitFor(() => expect(mockedSetDemo).toHaveBeenCalledTimes(1));
        expect(mockedSetDemo).toHaveBeenCalledWith('aaaaaaaa-1111-2222-3333-444444444444');
    });

    it('ALLOWS pinning when images are present even though mockup screens exist', async () => {
        await renderWith(snap({ mockupScreenCount: 2, imageCount: 2 }));

        fireEvent.click(screen.getByText('Set demo'));

        await waitFor(() => expect(mockedSetDemo).toHaveBeenCalledTimes(1));
    });

    it('does NOT gate the unpin path (already-pinned demo with 0 images)', async () => {
        const id = 'aaaaaaaa-1111-2222-3333-444444444444';
        await renderWith(snap({ id, mockupScreenCount: 3, imageCount: 0 }), id);

        // The already-pinned snapshot renders a "Demo" (unpin) button (there is
        // also a "Demo" badge, so target the button by its title).
        fireEvent.click(screen.getByTitle('Unset as public demo'));

        await waitFor(() => expect(mockedSetDemo).toHaveBeenCalledTimes(1));
        expect(mockedSetDemo).toHaveBeenCalledWith(null);
    });
});
