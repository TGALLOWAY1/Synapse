import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ProjectRoute } from '../../App';
import { GalleryPage } from '../GalleryPage';
import { HomePage } from '../HomePage';
import { resetDemoHydrationForTests } from '../../lib/demoRouteHydration';
import { resetGalleryStatusForTests } from '../../lib/galleryStatus';
import { useProjectStore } from '../../store/projectStore';
import { useAuthStore } from '../../store/authStore';
import { DEMO_PROJECT_ID, GALLERY_PROJECT_IDS } from '../../data/demoProject';
import type { RecruiterUser } from '../../lib/recruiterApi';
import type { SnapshotPayload } from '../../lib/snapshotClient';

// Routing contract for the project gallery: which component mounts for which
// URL, and how the entry button flips once the showcase mode is 'gallery'.
// The real ProjectWorkspace is far too heavy — stub it with a marker.
vi.mock('../ProjectWorkspace', () => ({
    ProjectWorkspace: () => <div>workspace-mounted</div>,
}));

vi.mock('../../lib/snapshotClient', () => ({
    loadDemoSnapshotPointer: vi.fn(),
    loadDemoSnapshotPublic: vi.fn(),
    loadGalleryPointerPublic: vi.fn(),
    loadGallerySnapshotPublic: vi.fn(),
    restoreSnapshotAs: vi.fn(),
    // App.tsx's RequireOwner reads the owner token from this module.
    getOwnerToken: () => null,
}));

import {
    loadDemoSnapshotPointer,
    loadGalleryPointerPublic,
    loadGallerySnapshotPublic,
    restoreSnapshotAs,
} from '../../lib/snapshotClient';

const mockedDemoPointer = vi.mocked(loadDemoSnapshotPointer);
const mockedGalleryPointer = vi.mocked(loadGalleryPointerPublic);
const mockedGalleryPublic = vi.mocked(loadGallerySnapshotPublic);
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

function fakePayload(snapshotId: string, projectId: string): SnapshotPayload {
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
            project: { id: projectId, name: 'Gallery project', createdAt: 0 },
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

// Stub the public `?gallery=1` state fetch used by galleryStatus.ts (plain
// fetch, deliberately not snapshotClient).
function stubGalleryStateFetch(body: unknown) {
    vi.stubGlobal('fetch', vi.fn(async () => ({
        ok: true,
        json: async () => body,
    })));
}

function renderAt(initialPath: string, entryElement?: React.ReactElement) {
    return render(
        <MemoryRouter initialEntries={[initialPath]}>
            <Routes>
                <Route path="/" element={entryElement ?? <div>home-entry</div>} />
                <Route path="/gallery" element={<GalleryPage />} />
                <Route path="/p/:projectId" element={<ProjectRoute />} />
            </Routes>
        </MemoryRouter>,
    );
}

beforeEach(() => {
    resetDemoHydrationForTests();
    resetGalleryStatusForTests();
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
    mockedDemoPointer.mockReset();
    mockedDemoPointer.mockResolvedValue({ snapshotId: 'snap-A', updatedAt: null });
    mockedGalleryPointer.mockReset();
    mockedGalleryPublic.mockReset();
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
    vi.unstubAllGlobals();
});

describe('gallery slot routes — public, gate-hydrated like the demo', () => {
    it('hydrates a gallery slot at the route boundary before mounting the workspace', async () => {
        mockedGalleryPointer.mockResolvedValue({
            mode: 'gallery', snapshotIds: ['s0', 's1'], size: 12, minLive: 2, updatedAt: null,
        });
        mockedGalleryPublic.mockResolvedValue(fakePayload('s1', GALLERY_PROJECT_IDS[1]));

        renderAt(`/p/${GALLERY_PROJECT_IDS[1]}`);

        expect(screen.getByRole('status')).toHaveTextContent('Loading gallery project');
        expect(await screen.findByText('workspace-mounted')).toBeInTheDocument();
        expect(mockedGalleryPublic).toHaveBeenCalledWith(1);
        expect(mockedRestore).toHaveBeenCalledTimes(1);
    });

    it('does not require authentication for a gallery slot (signed-out visitor)', async () => {
        mockedGalleryPointer.mockResolvedValue({
            mode: 'gallery', snapshotIds: ['s0'], size: 12, minLive: 2, updatedAt: null,
        });
        mockedGalleryPublic.mockResolvedValue(fakePayload('s0', GALLERY_PROJECT_IDS[0]));

        renderAt(`/p/${GALLERY_PROJECT_IDS[0]}`);

        expect(await screen.findByText('workspace-mounted')).toBeInTheDocument();
        expect(screen.queryByText('home-entry')).not.toBeInTheDocument();
    });
});

describe('GalleryPage — go-live gating', () => {
    it('redirects to the classic demo while the showcase mode is still demo', async () => {
        stubGalleryStateFetch({ mode: 'demo', size: 6, entries: [] });
        // The demo route will mount its gate; let its hydration resolve to
        // available via a cached demo project.
        useProjectStore.setState((state) => ({
            projects: {
                ...state.projects,
                [DEMO_PROJECT_ID]: {
                    id: DEMO_PROJECT_ID, name: 'Demo', createdAt: 0,
                    demoCachePolicyVersion: 1, demoSourceSnapshotId: 'snap-A',
                },
            },
        }));

        renderAt('/gallery');

        // GalleryPage bounces to /p/<demo id>; the demo gate then mounts.
        await waitFor(() => expect(screen.queryByText(/Loading project gallery/)).not.toBeInTheDocument());
        expect(await screen.findByText('workspace-mounted')).toBeInTheDocument();
    });

    it('renders one card per pinned project once the gallery is live', async () => {
        stubGalleryStateFetch({
            mode: 'gallery',
            size: 6,
            entries: [
                { slot: 0, snapshotId: 's0', title: 'Fitness Coach', imageCount: 4 },
                { slot: 1, snapshotId: 's1', title: 'Recipe Box', imageCount: 2 },
            ],
        });

        renderAt('/gallery');

        expect(await screen.findByText('Project gallery')).toBeInTheDocument();
        expect(screen.getByText('Fitness Coach')).toBeInTheDocument();
        expect(screen.getByText('Recipe Box')).toBeInTheDocument();
    });
});

describe('HomePage entry button — flips only when the gallery is live', () => {
    it('shows "View project gallery" and routes to /gallery in gallery mode', async () => {
        useAuthStore.setState({ user: TEST_USER, loading: false });
        stubGalleryStateFetch({
            mode: 'gallery',
            size: 6,
            entries: [{ slot: 0, snapshotId: 's0', title: 'Fitness Coach' }],
        });

        renderAt('/', <HomePage />);

        const button = await screen.findByRole('button', { name: /View project gallery/ });
        fireEvent.click(button);

        expect(await screen.findByText('Project gallery')).toBeInTheDocument();
    });

    it('keeps the classic "View demo project" button while the mode is demo', async () => {
        useAuthStore.setState({ user: TEST_USER, loading: false });
        stubGalleryStateFetch({ mode: 'demo', size: 6, entries: [] });

        renderAt('/', <HomePage />);

        expect(await screen.findByRole('button', { name: /View demo project/ })).toBeInTheDocument();
        await waitFor(() =>
            expect(screen.queryByRole('button', { name: /View project gallery/ })).not.toBeInTheDocument());
    });
});
