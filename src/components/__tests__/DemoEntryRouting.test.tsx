import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ProjectRoute } from '../../App';
import { LoginPage } from '../LoginPage';
import { HomePage } from '../HomePage';
import { resetDemoHydrationForTests } from '../../lib/demoRouteHydration';
import { useProjectStore } from '../../store/projectStore';
import { useAuthStore } from '../../store/authStore';
import { DEMO_PROJECT_ID } from '../../data/demoProject';
import type { RecruiterUser } from '../../lib/recruiterApi';
import type { SnapshotPayload } from '../../lib/snapshotClient';

// The routing contract under test is "which component mounts for which URL" —
// the real ProjectWorkspace is far too heavy for that, so stub it with a
// marker. DemoRouteGate itself stays real (its behavior has its own suite).
vi.mock('../ProjectWorkspace', () => ({
    ProjectWorkspace: () => <div>workspace-mounted</div>,
}));

vi.mock('../../lib/snapshotClient', () => ({
    loadDemoSnapshotPointer: vi.fn(),
    loadDemoSnapshotPublic: vi.fn(),
    restoreSnapshotAs: vi.fn(),
    // App.tsx's RequireOwner reads the owner token from this module.
    getOwnerToken: () => null,
}));

import {
    loadDemoSnapshotPointer,
    loadDemoSnapshotPublic,
    restoreSnapshotAs,
} from '../../lib/snapshotClient';

const mockedPointer = vi.mocked(loadDemoSnapshotPointer);
const mockedPublic = vi.mocked(loadDemoSnapshotPublic);
const mockedRestore = vi.mocked(restoreSnapshotAs);

const TEST_USER: RecruiterUser = {
    userId: 'user-1',
    authProvider: 'email',
    name: 'Test User',
    email: 'test@example.com',
    profileUrl: null,
    headline: '',
    company: null,
    avatarUrl: null,
};

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

function renderAt(initialPath: string, entryElement?: React.ReactElement) {
    return render(
        <MemoryRouter initialEntries={[initialPath]}>
            <Routes>
                <Route path="/" element={entryElement ?? <div>home-entry</div>} />
                <Route path="/p/:projectId" element={<ProjectRoute />} />
            </Routes>
        </MemoryRouter>,
    );
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
    mockedPointer.mockResolvedValue({ snapshotId: 'snap-A', updatedAt: null });
    mockedPublic.mockResolvedValue(fakePayload('snap-A'));
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

describe('ProjectRoute — demo vs ordinary projects', () => {
    it('hydrates the demo at the route boundary before mounting the workspace', async () => {
        renderAt(`/p/${DEMO_PROJECT_ID}`);

        expect(screen.getByRole('status')).toHaveTextContent('Loading demo project');
        expect(await screen.findByText('workspace-mounted')).toBeInTheDocument();
        expect(mockedRestore).toHaveBeenCalledTimes(1);
    });

    it('mounts an ordinary project directly for a signed-in user, with no demo hydration', () => {
        useAuthStore.setState({ user: TEST_USER, loading: false });

        renderAt('/p/some-ordinary-project-id');

        expect(screen.getByText('workspace-mounted')).toBeInTheDocument();
        expect(mockedPointer).not.toHaveBeenCalled();
        expect(mockedPublic).not.toHaveBeenCalled();
    });

    it('redirects a signed-out user to the entry route for an ordinary project', () => {
        renderAt('/p/some-ordinary-project-id');

        expect(screen.getByText('home-entry')).toBeInTheDocument();
        expect(screen.queryByText('workspace-mounted')).not.toBeInTheDocument();
        expect(mockedPointer).not.toHaveBeenCalled();
    });
});

describe('entry-page demo buttons — navigate only, route owns loading', () => {
    it('LoginPage demo button navigates to the demo route (route-owned hydration)', async () => {
        renderAt('/', <LoginPage />);

        fireEvent.click(screen.getByRole('button', { name: 'Demo project' }));

        // The button did not pre-load anything — the ROUTE runs hydration.
        expect(screen.getByRole('status')).toHaveTextContent('Loading demo project');
        expect(await screen.findByText('workspace-mounted')).toBeInTheDocument();
        expect(mockedRestore).toHaveBeenCalledTimes(1);
    });

    it('HomePage demo button navigates to the demo route (route-owned hydration)', async () => {
        useAuthStore.setState({ user: TEST_USER, loading: false });

        renderAt('/', <HomePage />);

        fireEvent.click(screen.getByRole('button', { name: /View demo project/ }));

        expect(screen.getByRole('status')).toHaveTextContent('Loading demo project');
        expect(await screen.findByText('workspace-mounted')).toBeInTheDocument();
        expect(mockedRestore).toHaveBeenCalledTimes(1);
    });
});
