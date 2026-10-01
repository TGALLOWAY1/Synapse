import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { SnapshotsPanel } from '../SnapshotsPanel';
import { useProjectStore } from '../../store/projectStore';
import type { GalleryInfo, SnapshotListItem } from '../../lib/snapshotClient';

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
        setGalleryMode: vi.fn(),
        removeGallerySnapshot: vi.fn(),
    };
});

import {
    deleteSnapshot,
    listSnapshots,
    loadSnapshot,
    removeGallerySnapshot,
    setDemoSnapshot,
    setGalleryMode,
} from '../../lib/snapshotClient';

const mockedList = vi.mocked(listSnapshots);
const mockedSetDemo = vi.mocked(setDemoSnapshot);
const mockedDelete = vi.mocked(deleteSnapshot);
const mockedLoad = vi.mocked(loadSnapshot);
const mockedSetGalleryMode = vi.mocked(setGalleryMode);
const mockedRemoveGallery = vi.mocked(removeGallerySnapshot);

const SNAPSHOT_ID = 'aaaaaaaa-1111-2222-3333-444444444444';

const snap = (overrides: Partial<SnapshotListItem>): SnapshotListItem => ({
    id: SNAPSHOT_ID,
    title: 'My Snapshot',
    projectName: 'Proj',
    createdAt: '2026-07-11T00:00:00.000Z',
    schemaVersion: 2,
    imageCount: 0,
    screenImageCount: 0,
    variantImageCount: 0,
    ...overrides,
});

const DEMO_GALLERY: GalleryInfo = { mode: 'demo', snapshotIds: [], size: 12, minLive: 2 };

async function renderWith(
    snapshot: SnapshotListItem,
    demoSnapshotId: string | null = null,
    gallery: GalleryInfo = DEMO_GALLERY,
    onClose: () => void = () => {},
) {
    mockedList.mockResolvedValue({ snapshots: [snapshot], demoSnapshotId, gallery });
    render(<SnapshotsPanel projectId="p1" onClose={onClose} />);
    // A pinned snapshot's title also shows in the gallery slot list.
    await screen.findAllByText('My Snapshot');
}

/** The confirmation that replaced the native confirm() — the topmost dialog. */
const confirmDialog = () => screen.getByRole('dialog');

beforeEach(() => {
    useProjectStore.setState({ projects: { p1: { id: 'p1', name: 'Proj', createdAt: 1 } } });
    mockedList.mockReset();
    mockedSetDemo.mockReset();
    mockedSetDemo.mockResolvedValue(SNAPSHOT_ID);
    mockedDelete.mockReset();
    mockedLoad.mockReset();
    mockedSetGalleryMode.mockReset();
    mockedRemoveGallery.mockReset();
});

describe('SnapshotsPanel pin-time completeness gate (SYN-003)', () => {
    it('BLOCKS pinning a snapshot whose mockup spec describes screens but carries 0 images', async () => {
        await renderWith(snap({ mockupScreenCount: 3, imageCount: 0, variantImageCount: 0 }));

        fireEvent.click(screen.getByText('Set demo'));

        expect(mockedSetDemo).not.toHaveBeenCalled();
        expect(await screen.findByText(/describes 3 screens but contains 0 rendered images/i)).toBeTruthy();
        // Blocked before any confirmation is offered.
        expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('BLOCKS a legacy zero-image snapshot with no completeness metadata, asking for a re-save', async () => {
        // mockupScreenCount undefined = legacy manifest, and zero images.
        await renderWith(snap({ mockupScreenCount: undefined, imageCount: 0, screenImageCount: 0, variantImageCount: undefined }));

        fireEvent.click(screen.getByText('Set demo'));

        expect(mockedSetDemo).not.toHaveBeenCalled();
        expect(await screen.findByText(/Re-save this snapshot with the current app version/i)).toBeTruthy();
        expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('ALLOWS pinning a PRD-only demo (mockupScreenCount === 0) with no images', async () => {
        await renderWith(snap({ mockupScreenCount: 0, imageCount: 0, variantImageCount: 0 }));

        fireEvent.click(screen.getByText('Set demo'));
        fireEvent.click(within(confirmDialog()).getByRole('button', { name: 'Make public demo' }));

        await waitFor(() => expect(mockedSetDemo).toHaveBeenCalledTimes(1));
        expect(mockedSetDemo).toHaveBeenCalledWith(SNAPSHOT_ID);
    });

    it('ALLOWS pinning when images are present even though mockup screens exist', async () => {
        await renderWith(snap({ mockupScreenCount: 2, imageCount: 2 }));

        fireEvent.click(screen.getByText('Set demo'));
        fireEvent.click(within(confirmDialog()).getByRole('button', { name: 'Make public demo' }));

        await waitFor(() => expect(mockedSetDemo).toHaveBeenCalledTimes(1));
    });

    it('does NOT gate the unpin path (already-pinned demo with 0 images)', async () => {
        await renderWith(snap({ id: SNAPSHOT_ID, mockupScreenCount: 3, imageCount: 0 }), SNAPSHOT_ID);

        // The already-pinned snapshot renders a "Demo" (unpin) button (there is
        // also a "Demo" badge, so target the button by its title).
        fireEvent.click(screen.getByTitle('Unset as public demo'));
        fireEvent.click(within(confirmDialog()).getByRole('button', { name: 'Unset demo' }));

        await waitFor(() => expect(mockedSetDemo).toHaveBeenCalledTimes(1));
        expect(mockedSetDemo).toHaveBeenCalledWith(null);
    });
});

describe('SnapshotsPanel confirmations (ConfirmDialog, not window.confirm)', () => {
    it('asks before pinning the demo, with the original copy, and does nothing on Cancel', async () => {
        await renderWith(snap({ mockupScreenCount: 0 }));

        fireEvent.click(screen.getByText('Set demo'));

        const dialog = confirmDialog();
        expect(within(dialog).getByText('Make this snapshot the public demo?')).toBeTruthy();
        expect(within(dialog).getByText(
            'Any visitor (no owner token required) will be able to load it from the home page.',
        )).toBeTruthy();

        fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

        expect(screen.queryByRole('dialog')).toBeNull();
        expect(mockedSetDemo).not.toHaveBeenCalled();
    });

    it('Escape cancels the confirmation and leaves the panel open', async () => {
        const onClose = vi.fn();
        await renderWith(snap({ mockupScreenCount: 0 }), null, DEMO_GALLERY, onClose);

        fireEvent.click(screen.getByText('Set demo'));
        fireEvent.keyDown(document.body, { key: 'Escape' });

        expect(screen.queryByRole('dialog')).toBeNull();
        expect(onClose).not.toHaveBeenCalled();
        expect(mockedSetDemo).not.toHaveBeenCalled();
    });

    it('a click on the dialog backdrop cancels it without closing the panel behind it', async () => {
        const onClose = vi.fn();
        await renderWith(snap({ mockupScreenCount: 0 }), null, DEMO_GALLERY, onClose);

        fireEvent.click(screen.getByText('Set demo'));
        // The dialog backdrop is the only role="presentation" element.
        fireEvent.click(screen.getByRole('presentation'));

        expect(screen.queryByRole('dialog')).toBeNull();
        expect(onClose).not.toHaveBeenCalled();
    });

    it('deletes a snapshot only after the destructive confirmation', async () => {
        await renderWith(snap({}));

        fireEvent.click(screen.getByTitle('Delete from cloud'));

        const dialog = confirmDialog();
        expect(within(dialog).getByText('Delete this snapshot from cloud storage?')).toBeTruthy();
        expect(within(dialog).getByText('This cannot be undone.')).toBeTruthy();
        expect(mockedDelete).not.toHaveBeenCalled();
        // Destructive styling: the confirm button is red, not the default indigo.
        const confirm = within(dialog).getByRole('button', { name: 'Delete' });
        expect(confirm.className).toContain('bg-red-600');

        fireEvent.click(confirm);

        await waitFor(() => expect(mockedDelete).toHaveBeenCalledWith(SNAPSHOT_ID));
        expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('loads a snapshot into the workspace only after confirming, then closes the panel', async () => {
        const onClose = vi.fn();
        await renderWith(snap({}), null, DEMO_GALLERY, onClose);

        fireEvent.click(screen.getByTitle('Load into workspace'));

        const dialog = confirmDialog();
        expect(within(dialog).getByText(
            'Loading will replace the current copy of this project in the workspace. Continue?',
        )).toBeTruthy();
        expect(mockedLoad).not.toHaveBeenCalled();

        fireEvent.click(within(dialog).getByRole('button', { name: 'Continue' }));

        await waitFor(() => expect(mockedLoad).toHaveBeenCalledWith(SNAPSHOT_ID));
        await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    });

    it('warns before removing a slot drops a LIVE gallery below its minimum, and only proceeds on confirm', async () => {
        const live: GalleryInfo = { mode: 'gallery', snapshotIds: [SNAPSHOT_ID, 'other-snapshot'], size: 12, minLive: 2 };
        mockedRemoveGallery.mockResolvedValue({ ...live, mode: 'demo', snapshotIds: ['other-snapshot'] });
        await renderWith(snap({ mockupScreenCount: 0 }), null, live);

        fireEvent.click(screen.getByTitle('Remove from the project gallery'));

        const dialog = confirmDialog();
        expect(within(dialog).getByText(
            'Removing this snapshot takes the live gallery below 2 projects, so the public showcase '
            + 'will switch back to the single demo project. The remaining slots are kept — re-fill '
            + 'and go live again when ready. Continue?',
        )).toBeTruthy();
        expect(mockedRemoveGallery).not.toHaveBeenCalled();

        fireEvent.click(within(dialog).getByRole('button', { name: 'Continue' }));

        await waitFor(() => expect(mockedRemoveGallery).toHaveBeenCalledWith(SNAPSHOT_ID));
    });

    it('removes a slot without asking when the live gallery stays at or above its minimum', async () => {
        const live: GalleryInfo = {
            mode: 'gallery',
            snapshotIds: [SNAPSHOT_ID, 'other-snapshot', 'third-snapshot'],
            size: 12,
            minLive: 2,
        };
        mockedRemoveGallery.mockResolvedValue({ ...live, snapshotIds: ['other-snapshot', 'third-snapshot'] });
        await renderWith(snap({ mockupScreenCount: 0 }), null, live);

        fireEvent.click(screen.getByTitle('Remove from the project gallery'));

        expect(screen.queryByRole('dialog')).toBeNull();
        await waitFor(() => expect(mockedRemoveGallery).toHaveBeenCalledWith(SNAPSHOT_ID));
    });

    it('asks before taking the gallery live', async () => {
        const ready: GalleryInfo = { mode: 'demo', snapshotIds: [SNAPSHOT_ID, 'other-snapshot'], size: 12, minLive: 2 };
        mockedSetGalleryMode.mockResolvedValue({ ...ready, mode: 'gallery' });
        await renderWith(snap({ mockupScreenCount: 0 }), null, ready);

        fireEvent.click(screen.getByText('Go live with gallery'));

        const dialog = confirmDialog();
        expect(within(dialog).getByText('Go live with the project gallery?')).toBeTruthy();
        expect(within(dialog).getByText(
            'Visitors will see the 2-project gallery instead of the single demo project.',
        )).toBeTruthy();
        expect(mockedSetGalleryMode).not.toHaveBeenCalled();

        fireEvent.click(within(dialog).getByRole('button', { name: 'Go live' }));

        await waitFor(() => expect(mockedSetGalleryMode).toHaveBeenCalledWith('gallery'));
    });
});
