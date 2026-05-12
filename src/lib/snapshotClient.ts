// Owner-only project snapshots. Bundles the per-project slice of the Zustand
// store together with that project's IndexedDB-backed mockup images, then
// pushes the whole bundle to the /api/snapshots endpoint, which writes it to
// Vercel Blob behind a SYNAPSE_OWNER_TOKEN gate.
//
// The owner token is entered once via the Snapshots panel and stored in
// localStorage under OWNER_TOKEN_KEY. Demo viewers never see snapshots —
// the panel is gated by token presence and every API call requires it.
//
// One snapshot can also be designated "the demo project": the server keeps a
// pointer blob (_demo.json) and exposes a public `?demo=1` read so anonymous
// visitors can load it from the home page without an owner token.

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

export type SnapshotListItem = SnapshotManifest & { isDemo?: boolean };

export type SnapshotListResult = {
    snapshots: SnapshotListItem[];
    demoSnapshotId: string | null;
};

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

// The server returns { error: 'code', message: 'human-readable detail' }. The
// panel only renders one string, so we prefer the message when it exists and
// fall back to the code; on parse failure we fall back to the status.
const errorFromResponse = async (resp: Response, fallbackCode: string): Promise<Error> => {
    const body = await resp.json().catch(() => null) as { error?: string; message?: string } | null;
    const message = typeof body?.message === 'string' && body.message.length > 0 ? body.message : null;
    const code = typeof body?.error === 'string' && body.error.length > 0 ? body.error : null;
    if (message && code) return new Error(`${code}: ${message}`);
    if (message) return new Error(message);
    if (code) return new Error(code);
    return new Error(`${fallbackCode}_${resp.status}`);
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
    if (!resp.ok) throw await errorFromResponse(resp, 'save_failed');
    const result = await resp.json();
    return result.manifest as SnapshotManifest;
};

export const listSnapshots = async (): Promise<SnapshotListResult> => {
    const resp = await fetch(API_BASE, { headers: authHeaders() });
    if (!resp.ok) throw await errorFromResponse(resp, 'list_failed');
    const data = await resp.json();
    const snapshots: SnapshotListItem[] = Array.isArray(data?.snapshots) ? data.snapshots : [];
    const demoSnapshotId: string | null =
        typeof data?.demoSnapshotId === 'string' ? data.demoSnapshotId : null;
    return { snapshots, demoSnapshotId };
};

// Owner-only: pin a snapshot as the demo project. Pass null to clear.
export const setDemoSnapshot = async (snapshotId: string | null): Promise<string | null> => {
    const url = snapshotId
        ? `${API_BASE}?demo=1&id=${encodeURIComponent(snapshotId)}`
        : `${API_BASE}?demo=1`;
    const resp = await fetch(url, { method: 'PUT', headers: authHeaders() });
    if (!resp.ok) throw await errorFromResponse(resp, 'set_demo_failed');
    const body = await resp.json();
    return typeof body?.demoSnapshotId === 'string' ? body.demoSnapshotId : null;
};

// Public: fetch the snapshot the owner has marked as the demo. No auth.
// Returns null when no demo has been set (server returns 404 in that case).
export const loadDemoSnapshotPublic = async (): Promise<SnapshotPayload | null> => {
    const resp = await fetch(`${API_BASE}?demo=1`);
    if (resp.status === 404) return null;
    if (!resp.ok) throw await errorFromResponse(resp, 'load_demo_failed');
    return await resp.json();
};

export const loadSnapshot = async (id: string): Promise<SnapshotPayload> => {
    const resp = await fetch(`${API_BASE}?id=${encodeURIComponent(id)}`, { headers: authHeaders() });
    if (!resp.ok) throw await errorFromResponse(resp, 'load_failed');
    return await resp.json();
};

export const deleteSnapshot = async (id: string): Promise<void> => {
    const resp = await fetch(`${API_BASE}?id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: authHeaders(),
    });
    if (!resp.ok) throw await errorFromResponse(resp, 'delete_failed');
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

// Deep-clone a bundle while rewriting every string occurrence of `fromId` to
// `toId`. We use this when restoring a snapshot as the demo project so the
// project URL is stable across visitors (always /p/<DEMO_PROJECT_ID>) and
// independent of whichever real project id was saved.
const rewriteProjectId = <T,>(value: T, fromId: string, toId: string): T => {
    if (Array.isArray(value)) {
        return value.map((v) => rewriteProjectId(v, fromId, toId)) as unknown as T;
    }
    if (value && typeof value === 'object') {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
            out[k] = rewriteProjectId(v, fromId, toId);
        }
        return out as T;
    }
    if (typeof value === 'string' && value === fromId) {
        return toId as unknown as T;
    }
    return value;
};

// Restore a snapshot into the store under a fixed `targetProjectId` instead
// of the snapshot's own id. Used by `loadDemoProject` so the demo always
// lives at `/p/<DEMO_PROJECT_ID>` regardless of which real project the owner
// saved as the demo source.
export const restoreSnapshotAs = async (
    snapshot: SnapshotPayload,
    targetProjectId: string,
): Promise<string> => {
    const sourceId = snapshot.project.project.id;
    const remapped: SnapshotProjectBundle = sourceId === targetProjectId
        ? snapshot.project
        : rewriteProjectId(snapshot.project, sourceId, targetProjectId);

    const versionIds = new Set(snapshot.images.map((r) => r.versionId));
    for (const vid of versionIds) {
        await deleteImagesForVersion(vid);
    }
    for (const record of snapshot.images) {
        // Image records also embed projectId, so remap before persisting.
        const remappedRecord = sourceId === targetProjectId
            ? record
            : rewriteProjectId(record, sourceId, targetProjectId);
        await putImage(remappedRecord);
    }

    useProjectStore.setState((state) => ({
        projects: { ...state.projects, [targetProjectId]: remapped.project },
        spineVersions: { ...state.spineVersions, [targetProjectId]: remapped.spineVersions },
        historyEvents: { ...state.historyEvents, [targetProjectId]: remapped.historyEvents },
        branches: { ...state.branches, [targetProjectId]: remapped.branches ?? [] },
        artifacts: { ...state.artifacts, [targetProjectId]: remapped.artifacts },
        artifactVersions: { ...state.artifactVersions, [targetProjectId]: remapped.artifactVersions },
        feedbackItems: { ...state.feedbackItems, [targetProjectId]: remapped.feedbackItems ?? [] },
    }));

    return targetProjectId;
};
