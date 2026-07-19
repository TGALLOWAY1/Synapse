import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { DemoRouteGate } from '../DemoRouteGate';
import { resetDemoHydrationForTests } from '../../lib/demoRouteHydration';
import { useProjectStore } from '../../store/projectStore';
import { useAuthStore } from '../../store/authStore';
import { DEMO_PROJECT_ID } from '../../data/demoProject';
import { DEMO_CACHE_POLICY_VERSION } from '../../store/slices/projectSlice';
import type { SnapshotPayload } from '../../lib/snapshotClient';
import type { Project } from '../../types';

// The gate delegates every cache/freshness/failure decision to the store's
// `loadDemoProject()`, whose plumbing we exercise for real here — only the
// snapshot transport is mocked (same seam as loadDemoProject.test.ts).
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

function renderGate(options: { strict?: boolean } = {}) {
    const tree = (
        <MemoryRouter initialEntries={[`/p/${DEMO_PROJECT_ID}`]}>
            <Routes>
                <Route
                    path="/p/:projectId"
                    element={
                        <DemoRouteGate>
                            <div>demo-workspace</div>
                        </DemoRouteGate>
                    }
                />
                <Route path="/" element={<div>home-entry</div>} />
            </Routes>
        </MemoryRouter>
    );
    return render(options.strict ? <StrictMode>{tree}</StrictMode> : tree);
}

beforeEach(() => {
    resetDemoHydrationForTests();
    useProjectStore.setState({
        projects: {},
        spineVersions: {},
        historyEvents: {},
        branches: {},
        artifacts: {},
        artifactVersions: {},
        feedbackItems: {},
    });
    useAuthStore.setState({ user: null, loading: false, authError: null });
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

describe('DemoRouteGate', () => {
    it('hydrates a cold demo route (no cached project) and then mounts the workspace', async () => {
        mockedPointer.mockResolvedValue({ snapshotId: 'snap-A', updatedAt: null });
        mockedPublic.mockResolvedValue(fakePayload('snap-A'));

        renderGate();

        // A stable, accessible loading state — never a flash of the workspace.
        expect(screen.getByRole('status')).toHaveTextContent('Loading demo project');
        expect(screen.queryByText('demo-workspace')).not.toBeInTheDocument();

        expect(await screen.findByText('demo-workspace')).toBeInTheDocument();
        expect(mockedRestore).toHaveBeenCalledTimes(1);
    });

    it('reuses a valid cached demo without re-fetching the bundle', async () => {
        seedDemo('snap-A');
        mockedPointer.mockResolvedValue({ snapshotId: 'snap-A', updatedAt: null });

        renderGate();

        expect(await screen.findByText('demo-workspace')).toBeInTheDocument();
        expect(mockedPublic).not.toHaveBeenCalled();
        expect(mockedRestore).not.toHaveBeenCalled();
    });

    it('replaces a stale cached demo when the pinned snapshot changed', async () => {
        seedDemo('snap-A');
        mockedPointer.mockResolvedValue({ snapshotId: 'snap-B', updatedAt: null });
        mockedPublic.mockResolvedValue(fakePayload('snap-B'));

        renderGate();

        expect(await screen.findByText('demo-workspace')).toBeInTheDocument();
        expect(mockedRestore).toHaveBeenCalledTimes(1);
        expect(
            useProjectStore.getState().projects[DEMO_PROJECT_ID]?.demoSourceSnapshotId,
        ).toBe('snap-B');
    });

    it('shows an explicit error state (not a redirect) when the snapshot cannot be loaded', async () => {
        mockedPointer.mockResolvedValue({ snapshotId: 'snap-A', updatedAt: null });
        mockedPublic.mockResolvedValue(null);

        renderGate();

        expect(await screen.findByRole('alert')).toHaveTextContent('Unable to load demo');
        expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Return home' })).toBeInTheDocument();
        // No silent bounce to the entry page, and no workspace mount.
        expect(screen.queryByText('home-entry')).not.toBeInTheDocument();
        expect(screen.queryByText('demo-workspace')).not.toBeInTheDocument();
    });

    it('shows the error state when hydration throws (restore failure)', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        mockedPointer.mockResolvedValue({ snapshotId: 'snap-A', updatedAt: null });
        mockedPublic.mockResolvedValue(fakePayload('snap-A'));
        mockedRestore.mockRejectedValue(new Error('idb write failed'));

        renderGate();

        expect(await screen.findByRole('alert')).toHaveTextContent('Unable to load demo');
    });

    it('keeps serving a known-valid cached demo when the pointer probe fails', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        seedDemo('snap-A');
        mockedPointer.mockRejectedValue(new Error('offline'));

        renderGate();

        expect(await screen.findByText('demo-workspace')).toBeInTheDocument();
        expect(mockedRestore).not.toHaveBeenCalled();
    });

    it('Retry re-attempts hydration after a failure', async () => {
        mockedPointer.mockResolvedValue({ snapshotId: 'snap-A', updatedAt: null });
        mockedPublic.mockResolvedValue(null);

        renderGate();
        await screen.findByRole('alert');

        // The transient failure clears — the retry should succeed.
        mockedPublic.mockResolvedValue(fakePayload('snap-A'));
        fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

        expect(await screen.findByText('demo-workspace')).toBeInTheDocument();
        expect(mockedRestore).toHaveBeenCalledTimes(1);
    });

    it('Reset & reload demo re-attempts hydration after a failure', async () => {
        mockedPointer.mockResolvedValue({ snapshotId: 'snap-A', updatedAt: null });
        mockedPublic.mockResolvedValue(null);

        renderGate();
        await screen.findByRole('alert');

        // The transient failure clears — the reset+reload should succeed.
        mockedPublic.mockResolvedValue(fakePayload('snap-A'));
        fireEvent.click(screen.getByRole('button', { name: 'Reset & reload demo' }));

        expect(await screen.findByText('demo-workspace')).toBeInTheDocument();
        expect(mockedRestore).toHaveBeenCalledTimes(1);
    });

    it('Return home navigates to the entry route after a failure', async () => {
        mockedPointer.mockResolvedValue({ snapshotId: 'snap-A', updatedAt: null });
        mockedPublic.mockResolvedValue(null);

        renderGate();
        await screen.findByRole('alert');

        fireEvent.click(screen.getByRole('link', { name: 'Return home' }));

        expect(await screen.findByText('home-entry')).toBeInTheDocument();
    });

    it('runs a single hydration pass under React Strict Mode double-mounting', async () => {
        mockedPointer.mockResolvedValue({ snapshotId: 'snap-A', updatedAt: null });
        mockedPublic.mockResolvedValue(fakePayload('snap-A'));

        renderGate({ strict: true });

        expect(await screen.findByText('demo-workspace')).toBeInTheDocument();
        // Both Strict Mode effect invocations share one in-flight pass.
        expect(mockedPointer).toHaveBeenCalledTimes(1);
        expect(mockedPublic).toHaveBeenCalledTimes(1);
        expect(mockedRestore).toHaveBeenCalledTimes(1);
    });

    it('waits for the auth session to settle before hydrating (namespace-switch guard)', async () => {
        useAuthStore.setState({ user: null, loading: true, authError: null });
        mockedPointer.mockResolvedValue({ snapshotId: 'snap-A', updatedAt: null });
        mockedPublic.mockResolvedValue(fakePayload('snap-A'));

        renderGate();

        // While the session resolves, no hydration work starts.
        expect(screen.getByRole('status')).toHaveTextContent('Loading demo project');
        await waitFor(() => expect(mockedPointer).not.toHaveBeenCalled());

        useAuthStore.setState({ loading: false });

        expect(await screen.findByText('demo-workspace')).toBeInTheDocument();
        expect(mockedPointer).toHaveBeenCalledTimes(1);
    });
});
