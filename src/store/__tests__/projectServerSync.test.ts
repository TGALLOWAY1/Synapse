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
