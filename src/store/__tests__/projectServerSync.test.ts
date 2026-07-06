import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock the server transport so we can drive reconcile/push without a backend.
const client = vi.hoisted(() => {
  class RevisionConflictError extends Error {
    code = 'revision_conflict' as const;
    currentRevision?: number;
    constructor(currentRevision?: number) {
      super('revision_conflict');
      this.name = 'RevisionConflictError';
      this.currentRevision = currentRevision;
    }
  }
  return {
    fetchProjectList: vi.fn(),
    fetchProject: vi.fn(),
    saveProject: vi.fn(),
    deleteProject: vi.fn(),
    RevisionConflictError,
  };
});
vi.mock('../../lib/projectsClient', () => client);

import { useProjectStore } from '../projectStore';
import { useProjectSyncStore } from '../projectSyncStore';
import { startProjectSync, stopProjectSync } from '../projectServerSync';
import { setProjectSyncMeta, getProjectSyncMeta } from '../../lib/projectSyncMeta';
import type { ProjectBundle } from '../../lib/projectBundle';

function emptyState() {
  return {
    projects: {},
    spineVersions: {},
    historyEvents: {},
    branches: {},
    artifacts: {},
    artifactVersions: {},
    feedbackItems: {},
    tasks: {},
    workflowRuns: {},
  };
}

function serverBundle(id: string): ProjectBundle {
  return {
    project: { id, name: `Server ${id}`, createdAt: 1 },
    spineVersions: [
      { id: 'v1', projectId: id, promptText: 'idea', responseText: 'PRD', createdAt: 1, isLatest: true, isFinal: false },
    ],
    historyEvents: [],
    branches: [],
    artifacts: [],
    artifactVersions: [],
    feedbackItems: [],
    tasks: [],
    workflowRuns: [],
  };
}

beforeEach(() => {
  Object.values(client).forEach((fn) => {
    if (typeof fn === 'function' && 'mockReset' in fn) fn.mockReset();
  });
  useProjectStore.setState(emptyState());
  useProjectSyncStore.getState().reset();
  localStorage.clear();
});

afterEach(() => {
  stopProjectSync();
  vi.useRealTimers();
});

describe('reconcile (pull) — project appears on another device / persists after refresh', () => {
  it('pulls a server project this device does not have into the store', async () => {
    client.fetchProjectList.mockResolvedValue([{ id: 'p1', updatedAt: '2026-01-01' }]);
    client.fetchProject.mockResolvedValue({ id: 'p1', data: serverBundle('p1') });
    client.saveProject.mockResolvedValue({ id: 'p1' });

    startProjectSync('user-a');

    await vi.waitFor(() => {
      expect(useProjectStore.getState().projects['p1']).toBeTruthy();
    });
    expect(useProjectStore.getState().spineVersions['p1']).toHaveLength(1);
    // A freshly pulled project shows as saved, not dirty.
    expect(useProjectSyncStore.getState().projects['p1']?.state).toBe('saved');
  });
});

describe('reconcile (push) — local-only projects migrate to the server', () => {
  it('uploads a local project the server does not have', async () => {
    useProjectStore.setState({
      ...emptyState(),
      projects: { p1: { id: 'p1', name: 'Local', createdAt: 1 } },
      spineVersions: { p1: [] },
    });
    client.fetchProjectList.mockResolvedValue([]); // server has nothing
    client.saveProject.mockResolvedValue({ id: 'p1' });

    startProjectSync('user-a');

    await vi.waitFor(() => {
      expect(client.saveProject).toHaveBeenCalledWith('p1', expect.objectContaining({ project: expect.any(Object) }), expect.anything());
    });
    expect(useProjectSyncStore.getState().migratedCount).toBe(1);
  });
});

describe('failed save does not delete local data', () => {
  it('keeps the local project and surfaces an error state when the push fails', async () => {
    useProjectStore.setState({
      ...emptyState(),
      projects: { p1: { id: 'p1', name: 'Local', createdAt: 1 } },
      spineVersions: { p1: [] },
    });
    client.fetchProjectList.mockResolvedValue([]);
    client.saveProject.mockRejectedValue(new Error('save_failed'));

    startProjectSync('user-a');

    await vi.waitFor(() => {
      expect(useProjectSyncStore.getState().projects['p1']?.state).toBe('error');
    });
    // Local data is untouched despite the failed save.
    expect(useProjectStore.getState().projects['p1']).toBeTruthy();
    // Reconcile still completes (pull succeeded) — not a hard failure.
    expect(useProjectSyncStore.getState().phase).toBe('ready');
  });
});

describe('a server pull error is recoverable, not data loss', () => {
  it('sets an error phase and leaves local projects intact', async () => {
    useProjectStore.setState({
      ...emptyState(),
      projects: { p1: { id: 'p1', name: 'Local', createdAt: 1 } },
    });
    client.fetchProjectList.mockRejectedValue(new Error('network'));

    startProjectSync('user-a');

    await vi.waitFor(() => {
      expect(useProjectSyncStore.getState().phase).toBe('error');
    });
    expect(useProjectStore.getState().projects['p1']).toBeTruthy();
  });
});

describe('live local changes push (debounced) after the initial reconcile', () => {
  it('pushes a newly created project to the server', async () => {
    client.fetchProjectList.mockResolvedValue([]);
    client.saveProject.mockResolvedValue({ id: 'x' });

    startProjectSync('user-a');
    // Wait until reconcile finishes and the subscription is attached.
    await vi.waitFor(() => {
      expect(useProjectSyncStore.getState().phase).toBe('ready');
    });
    client.saveProject.mockClear();

    vi.useFakeTimers();
    const { projectId } = useProjectStore.getState().createProject('New', 'an idea');
    await vi.advanceTimersByTimeAsync(2000); // past the push debounce

    expect(client.saveProject).toHaveBeenCalledWith(projectId, expect.objectContaining({ project: expect.any(Object) }), expect.anything());
  });
});

function seedLocalProject(id: string, name: string) {
  useProjectStore.setState({
    ...emptyState(),
    projects: { [id]: { id, name, createdAt: 1 } },
    spineVersions: { [id]: [] },
  });
}

describe('server-newer + local clean → safe refresh (no data loss)', () => {
  it('overwrites the clean local copy with the newer server copy and re-baselines', async () => {
    seedLocalProject('p1', 'Local p1');
    // Baseline: we last saw revision 1 and have no unsynced edits.
    setProjectSyncMeta('user-a', 'p1', { lastSeenServerRevision: 1, hasUnsyncedChanges: false });

    client.fetchProjectList.mockResolvedValue([{ id: 'p1', revision: 2, updatedAt: '2026-02-02' }]);
    client.fetchProject.mockResolvedValue({ id: 'p1', revision: 2, data: serverBundle('p1') });

    startProjectSync('user-a');

    await vi.waitFor(() => {
      expect(useProjectStore.getState().projects['p1']?.name).toBe('Server p1');
    });
    expect(useProjectSyncStore.getState().projects['p1']?.state).toBe('saved');
    expect(getProjectSyncMeta('user-a', 'p1').lastSeenServerRevision).toBe(2);
    expect(getProjectSyncMeta('user-a', 'p1').conflict).toBe(false);
  });
});

describe('server-newer + local dirty → conflict (client B does NOT overwrite client A)', () => {
  it('flags conflict and preserves BOTH the local edits and the server copy', async () => {
    // Client B has an older local copy WITH unsynced edits.
    seedLocalProject('p1', 'Local edit on device B');
    setProjectSyncMeta('user-a', 'p1', { lastSeenServerRevision: 1, hasUnsyncedChanges: true });

    // Client A already saved a newer revision to the server.
    client.fetchProjectList.mockResolvedValue([{ id: 'p1', revision: 5, updatedAt: '2026-03-03' }]);

    startProjectSync('user-a');

    await vi.waitFor(() => {
      expect(useProjectSyncStore.getState().projects['p1']?.state).toBe('conflict');
    });
    // Local edits are untouched — not silently overwritten by the server copy.
    expect(useProjectStore.getState().projects['p1']?.name).toBe('Local edit on device B');
    // We did NOT pull/overwrite (no full fetch for a conflicted project).
    expect(client.fetchProject).not.toHaveBeenCalled();
    // Durable conflict recorded so it survives a reload.
    expect(getProjectSyncMeta('user-a', 'p1').conflict).toBe(true);
  });
});

describe('push guard → a stale push is rejected and becomes a conflict', () => {
  it('marks conflict (not a plain error) and keeps local data when the server advanced', async () => {
    seedLocalProject('p1', 'Local p1');
    // We have a baseline and are in sync at reconcile time.
    setProjectSyncMeta('user-a', 'p1', { lastSeenServerRevision: 3, hasUnsyncedChanges: false });
    client.fetchProjectList.mockResolvedValue([{ id: 'p1', revision: 3, updatedAt: '2026-01-01' }]);

    startProjectSync('user-a');
    await vi.waitFor(() => {
      expect(useProjectSyncStore.getState().phase).toBe('ready');
    });

    // The server advances on another device; our conditional push is rejected.
    client.saveProject.mockRejectedValue(new client.RevisionConflictError(9));

    vi.useFakeTimers();
    // A local edit to p1 schedules a push.
    useProjectStore.getState().setProjectStage('p1', 'workspace');
    await vi.advanceTimersByTimeAsync(2000);
    vi.useRealTimers();

    await vi.waitFor(() => {
      expect(useProjectSyncStore.getState().projects['p1']?.state).toBe('conflict');
    });
    // Local data preserved.
    expect(useProjectStore.getState().projects['p1']).toBeTruthy();
    expect(getProjectSyncMeta('user-a', 'p1').conflict).toBe(true);
  });
});

describe('cloud save failure exposes unsynced / failed durability state', () => {
  it('sets an error state and records the failure without dropping local data', async () => {
    seedLocalProject('p1', 'Local p1');
    setProjectSyncMeta('user-a', 'p1', { lastSeenServerRevision: 2, hasUnsyncedChanges: false });
    client.fetchProjectList.mockResolvedValue([{ id: 'p1', revision: 2 }]);

    startProjectSync('user-a');
    await vi.waitFor(() => {
      expect(useProjectSyncStore.getState().phase).toBe('ready');
    });

    client.saveProject.mockRejectedValue(new Error('payload_too_large'));

    vi.useFakeTimers();
    useProjectStore.getState().setProjectStage('p1', 'workspace');
    await vi.advanceTimersByTimeAsync(2000);
    vi.useRealTimers();

    await vi.waitFor(() => {
      expect(useProjectSyncStore.getState().projects['p1']?.state).toBe('error');
    });
    const info = useProjectSyncStore.getState().projects['p1'];
    expect(info?.lastCloudSaveError).toBe('payload_too_large');
    // Local data intact + durable unsynced flag set.
    expect(useProjectStore.getState().projects['p1']).toBeTruthy();
    expect(getProjectSyncMeta('user-a', 'p1').hasUnsyncedChanges).toBe(true);
  });
});
