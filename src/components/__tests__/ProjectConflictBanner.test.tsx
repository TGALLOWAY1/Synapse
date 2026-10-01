import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ProjectConflictBanner } from '../sync/ProjectSyncStatus';
import { useProjectSyncStore } from '../../store/projectSyncStore';

// The resolution actions hit the server; this suite is about the confirmation
// that now guards the destructive one.
vi.mock('../../store/projectServerSync', () => ({
    refreshProjectsFromServer: vi.fn(),
    resolveConflictUseCloud: vi.fn(async () => {}),
    resolveConflictKeepLocal: vi.fn(async () => {}),
}));

import { resolveConflictUseCloud } from '../../store/projectServerSync';

const mockedUseCloud = vi.mocked(resolveConflictUseCloud);

beforeEach(() => {
    mockedUseCloud.mockClear();
    useProjectSyncStore.setState({
        projects: {
            p1: { state: 'conflict', updatedAt: 1, conflict: { detectedAt: 'push' } },
        },
    });
});

describe('ProjectConflictBanner "Use cloud version" confirmation', () => {
    it('asks first, with the original warning copy, and discards nothing on Cancel', () => {
        render(<ProjectConflictBanner projectId="p1" />);

        fireEvent.click(screen.getByRole('button', { name: 'Use cloud version' }));

        const dialog = screen.getByRole('dialog');
        expect(within(dialog).getByText("Replace this device's copy with the cloud version?")).toBeTruthy();
        expect(within(dialog).getByText(
            'Your local changes will be discarded. Consider downloading a recovery copy first.',
        )).toBeTruthy();
        expect(mockedUseCloud).not.toHaveBeenCalled();

        fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

        expect(screen.queryByRole('dialog')).toBeNull();
        expect(mockedUseCloud).not.toHaveBeenCalled();
    });

    it('Escape also cancels without resolving the conflict', () => {
        render(<ProjectConflictBanner projectId="p1" />);

        fireEvent.click(screen.getByRole('button', { name: 'Use cloud version' }));
        fireEvent.keyDown(document.body, { key: 'Escape' });

        expect(screen.queryByRole('dialog')).toBeNull();
        expect(mockedUseCloud).not.toHaveBeenCalled();
    });

    it('replaces the local copy only after the destructive confirmation', async () => {
        render(<ProjectConflictBanner projectId="p1" />);

        fireEvent.click(screen.getByRole('button', { name: 'Use cloud version' }));
        const dialog = screen.getByRole('dialog');
        // Two buttons share this label (the banner's trigger and the dialog's
        // confirm); the confirm is red because it discards local work.
        const confirm = within(dialog).getByRole('button', { name: 'Use cloud version' });
        expect(confirm.className).toContain('bg-red-600');

        fireEvent.click(confirm);

        await waitFor(() => expect(mockedUseCloud).toHaveBeenCalledWith('p1'));
        expect(screen.queryByRole('dialog')).toBeNull();
    });
});
