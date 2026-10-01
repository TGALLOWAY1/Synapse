import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../../store/projectServerSync', () => ({
    refreshProjectsFromServer: vi.fn(),
    resolveConflictUseCloud: vi.fn(),
    resolveConflictKeepLocal: vi.fn(),
}));

import { SyncStatusBanner, ProjectConflictBanner } from '../sync/ProjectSyncStatus';
import { useProjectSyncStore } from '../../store/projectSyncStore';
import { useToastStore } from '../../store/toastStore';
import {
    refreshProjectsFromServer,
    resolveConflictKeepLocal,
    resolveConflictUseCloud,
} from '../../store/projectServerSync';

beforeEach(() => {
    vi.clearAllMocks();
    useProjectSyncStore.getState().reset();
    useProjectSyncStore.setState({ online: true });
    useToastStore.setState({ toasts: [] });
});

describe('SyncStatusBanner — partial pull failure', () => {
    it('reports projects that could not be downloaded instead of a clean "synced"', () => {
        useProjectSyncStore.getState().markPulled(0, ['p2', 'p3']);

        render(<SyncStatusBanner signedIn />);

        expect(screen.getByText(/2 projects couldn't be downloaded from the cloud/)).toBeInTheDocument();
        expect(screen.queryByText('Projects synced across your devices.')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: /Retry/ }));
        expect(refreshProjectsFromServer).toHaveBeenCalledTimes(1);
    });

    it('shows the plain synced state after a clean pull', () => {
        useProjectSyncStore.getState().markPulled(0);

        render(<SyncStatusBanner signedIn />);

        expect(screen.getByText('Projects synced across your devices.')).toBeInTheDocument();
    });
});

describe('ProjectConflictBanner — resolution outcomes are surfaced', () => {
    const seedConflict = () => useProjectSyncStore.getState().setProjectSync('p1', {
        state: 'conflict',
        updatedAt: 1,
        conflict: { detectedAt: 'push', serverRevision: 7 },
    });
    const toastTitles = () => useToastStore.getState().toasts.map((t) => t.title);

    it('reports a failed keep-local resolution', async () => {
        seedConflict();
        vi.mocked(resolveConflictKeepLocal).mockResolvedValue('failed');

        render(<ProjectConflictBanner projectId="p1" />);
        fireEvent.click(screen.getByRole('button', { name: /Keep this device's version/ }));

        await waitFor(() => expect(toastTitles()).toContain("Couldn't resolve the conflict"));
    });

    it('reports a missing cloud copy when choosing the cloud version', async () => {
        seedConflict();
        vi.spyOn(window, 'confirm').mockReturnValue(true);
        vi.mocked(resolveConflictUseCloud).mockResolvedValue('cloud_missing');

        render(<ProjectConflictBanner projectId="p1" />);
        fireEvent.click(screen.getByRole('button', { name: /Use cloud version/ }));

        await waitFor(() => expect(toastTitles()).toContain('No cloud version to use'));
    });

    it('stays quiet when the resolution succeeds', async () => {
        seedConflict();
        vi.mocked(resolveConflictKeepLocal).mockResolvedValue('resolved');

        render(<ProjectConflictBanner projectId="p1" />);
        fireEvent.click(screen.getByRole('button', { name: /Keep this device's version/ }));

        await waitFor(() => expect(resolveConflictKeepLocal).toHaveBeenCalledWith('p1'));
        expect(useToastStore.getState().toasts).toEqual([]);
    });
});
