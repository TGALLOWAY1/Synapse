// Owner-only project snapshots. Bundles the per-project slice of the Zustand
// store together with that project's IndexedDB-backed mockup images, then
// pushes the whole bundle to the /api/snapshots endpoint, which writes it to
// Vercel Blob behind a SYNAPSE_OWNER_TOKEN gate.
//
// The owner token is entered once via the Snapshots panel and stored in
// localStorage under OWNER_TOKEN_KEY. Demo viewers never see snapshots —
// the panel is gated by token presence and every API call requires it.

import type {
    Project, SpineVersion, HistoryEvent, Branch,
    Artifact, ArtifactVersion, FeedbackItem, MockupImageRecord,
} from '../types';
import { useProjectStore } from '../store/projectStore';
import { listImagesForVersion, putImage, deleteImagesForVersion } from './mockupImageStore';

export const OWNER_TOKEN_KEY = 'synapse-owner-token';

export type SnapshotProjectBundle = {
    project: Project;
    spineVersions: SpineVersion[];
    historyEvents: HistoryEvent[];
    branches: Branch[];
    artifacts: Artifact[];
    artifactVersions: ArtifactVersion[];
    feedbackItems: FeedbackItem[];
};

export type SnapshotManifest = {
    id: string;
    title: string;
    projectName: string;
    createdAt: string;
    schemaVersion: number;
    imageCount: number;
    sizeBytes?: number;
};

export type SnapshotPayload = {
    schemaVersion: number;
    manifest: SnapshotManifest;
    project: SnapshotProjectBundle;
    images: MockupImageRecord[];
};

export type SnapshotListItem = SnapshotManifest;

const API_BASE = '/api/snapshots';

export const getOwnerToken = (): string | null => {
    try {
        return localStorage.getItem(OWNER_TOKEN_KEY);
    } catch {
        return null;
    }
};

export const setOwnerToken = (token: string): void => {
    try {
        if (token) localStorage.setItem(OWNER_TOKEN_KEY, token);
        else localStorage.removeItem(OWNER_TOKEN_KEY);
    } catch {
        // ignore — quota / privacy mode
    }
};

const authHeaders = (): Record<string, string> => {
    const token = getOwnerToken();
    if (!token) throw new Error('Owner token not set. Add it in the Snapshots panel.');
    return { Authorization: `Bearer ${token}` };
};

// Pull the per-project slice out of Zustand. We snapshot the store at one
// point in time so concurrent edits don't tear the bundle.
export const collectProjectBundle = (projectId: string): SnapshotProjectBundle => {
    const state = useProjectStore.getState();
    const project = state.projects[projectId];
    if (!project) throw new Error(`Project ${projectId} not found in store`);
    return {
        project,
        spineVersions: state.spineVersions[projectId] ?? [],
        historyEvents: state.historyEvents[projectId] ?? [],
        branches: state.branches[projectId] ?? [],
        artifacts: state.artifacts[projectId] ?? [],
        artifactVersions: state.artifactVersions[projectId] ?? [],
        feedbackItems: state.feedbackItems[projectId] ?? [],
    };
};

// Gather every IDB image record tied to one of this project's artifact
// versions. The store keys artifactVersions by projectId, so the bundle's
// version list already represents this project exhaustively. The IDB index
// is keyed by versionId, so we walk that for each version.
const collectProjectImages = async (bundle: SnapshotProjectBundle): Promise<MockupImageRecord[]> => {
    const out: MockupImageRecord[] = [];
    for (const v of bundle.artifactVersions) {
        const records = await listImagesForVersion(v.id);
        for (const r of records) {
            if (r.projectId === bundle.project.id) out.push(r);
        }
    }
    return out;
};

export const saveSnapshot = async (
    projectId: string,
    title: string,
): Promise<SnapshotManifest> => {
    const bundle = collectProjectBundle(projectId);
    const images = await collectProjectImages(bundle);

    const resp = await fetch(API_BASE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ title, project: bundle, images }),
    });
    if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err?.error ?? `save_failed_${resp.status}`);
    }
    const result = await resp.json();
    return result.manifest as SnapshotManifest;
};

export const listSnapshots = async (): Promise<SnapshotListItem[]> => {
    const resp = await fetch(API_BASE, { headers: authHeaders() });
    if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err?.error ?? `list_failed_${resp.status}`);
    }
    const data = await resp.json();
    return Array.isArray(data?.snapshots) ? data.snapshots : [];
};

export const loadSnapshot = async (id: string): Promise<SnapshotPayload> => {
    const resp = await fetch(`${API_BASE}?id=${encodeURIComponent(id)}`, { headers: authHeaders() });
    if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err?.error ?? `load_failed_${resp.status}`);
    }
    return await resp.json();
};

export const deleteSnapshot = async (id: string): Promise<void> => {
    const resp = await fetch(`${API_BASE}?id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: authHeaders(),
    });
    if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err?.error ?? `delete_failed_${resp.status}`);
    }
};

// Restore a snapshot into the live store. Replaces any existing project with
// the same id (we use the snapshot's project id directly so external
// references — e.g. screen URLs — keep working). Images are repopulated in
// IndexedDB for the project's mockup versions.
export const restoreSnapshot = async (snapshot: SnapshotPayload): Promise<string> => {
    const { project: bundle, images } = snapshot;
    const projectId = bundle.project.id;

    // Repopulate IDB images first, before we expose the project in the store,
    // so renderers don't briefly see "missing image" placeholders.
    const versionIds = new Set(images.map((r) => r.versionId));
    for (const vid of versionIds) {
        await deleteImagesForVersion(vid);
    }
    for (const record of images) {
        await putImage(record);
    }

    // Splice the bundle back into the Zustand store. We mutate the store
    // imperatively because there's no public action for "replace one project
    // wholesale" — that's a deliberately rare operation.
    useProjectStore.setState((state) => ({
        projects: { ...state.projects, [projectId]: bundle.project },
        spineVersions: { ...state.spineVersions, [projectId]: bundle.spineVersions },
        historyEvents: { ...state.historyEvents, [projectId]: bundle.historyEvents },
        branches: { ...state.branches, [projectId]: bundle.branches },
        artifacts: { ...state.artifacts, [projectId]: bundle.artifacts },
        artifactVersions: { ...state.artifactVersions, [projectId]: bundle.artifactVersions },
        feedbackItems: { ...state.feedbackItems, [projectId]: bundle.feedbackItems },
    }));

    return projectId;
};
