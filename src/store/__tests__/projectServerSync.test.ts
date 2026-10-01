// @vitest-environment jsdom
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
import {
  startProjectSync,
  stopProjectSync,
  refreshProjectsFromServer,
  resolveConflictUseCloud,
  resolveConflictKeepLocal,
} from '../projectServerSync';
import { setProjectSyncMeta, getProjectSyncMeta } from '../../lib/projectSyncMeta';
import type { ProjectBundle } from '../../lib/projectBundle';
import { latestProjectActivity, mergePersistedProjectBlobs } from '../../lib/crossTabMerge';
import { resolveProjectStorageName } from '../userScope';

function emptyState() {
  return {
    projects: {},
    projectTombstones: {},
    spineVersions: {},
    historyEvents: {},
    branches: {},
    artifacts: {},
    artifactVersions: {},
    feedbackItems: {},
    tasks: {},
    workflowRuns: {},
    reviewRuns: {}, specialistRuns: {}, reviewFindings: {}, reviewIssues: {}, planningRecords: {},
    readinessReviews: {}, readinessCommitmentEvents: {}, downstreamUpdatePlans: {}, downstreamUpdatePlanEvents: {},
    downstreamArtifactUpdateProposals: {}, downstreamArtifactUpdateReviewEvents: {},
    downstreamArtifactUpdateApplications: {}, downstreamArtifactUpdateVerifications: {},
    downstreamArtifactUpdateVerificationEvents: {},
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

  it('includes downstream proposal authority and verification history in a user sync bundle', async () => {
    client.fetchProjectList.mockResolvedValue([]);
    client.saveProject.mockResolvedValue({ id: 'x' });
    startProjectSync('user-a');
    await vi.waitFor(() => expect(useProjectSyncStore.getState().phase).toBe('ready'));
    client.saveProject.mockClear();

    vi.useFakeTimers();
    const { projectId } = useProjectStore.getState().createProject('Proposal project', 'an idea');
    useProjectStore.setState({
      downstreamArtifactUpdateProposals: { [projectId]: [{ id: 'proposal', projectId }] as never[] },
      downstreamArtifactUpdateVerificationEvents: { [projectId]: [{ id: 'verified', projectId }] as never[] },
    });
    await vi.advanceTimersByTimeAsync(2000);

    expect(client.saveProject).toHaveBeenCalledWith(projectId, expect.objectContaining({
      downstreamArtifactUpdateProposals: [expect.objectContaining({ id: 'proposal' })],
      downstreamArtifactUpdateVerificationEvents: [expect.objectContaining({ id: 'verified' })],
    }), expect.anything());
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

describe('dirty project is retried on reconcile after a reload', () => {
  it('re-pushes a pending (dirty, not server-newer) project instead of leaving it stuck', async () => {
    seedLocalProject('p1', 'Local p1');
    // A prior save failed / the tab closed after schedulePush — durable dirty
    // flag survived the reload; server has NOT advanced.
    setProjectSyncMeta('user-a', 'p1', { lastSeenServerRevision: 2, hasUnsyncedChanges: true });
    client.fetchProjectList.mockResolvedValue([{ id: 'p1', revision: 2 }]);
    client.saveProject.mockResolvedValue({ id: 'p1', revision: 3 });

    startProjectSync('user-a');

    await vi.waitFor(() => {
      expect(client.saveProject).toHaveBeenCalledWith(
        'p1',
        expect.objectContaining({ project: expect.any(Object) }),
        expect.objectContaining({ expectedRevision: 2 }),
      );
    });
    // The pending upload cleared.
    await vi.waitFor(() => {
      expect(getProjectSyncMeta('user-a', 'p1').hasUnsyncedChanges).toBe(false);
    });
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

describe('deleted projects stay deleted (delete tombstones)', () => {
  const phase = () => useProjectSyncStore.getState().phase;

  it('keeps the tombstone when the remote delete fails and retries the delete on the next reconcile instead of pulling the project back', async () => {
    seedLocalProject('p1', 'Local p1');
    setProjectSyncMeta('user-a', 'p1', { lastSeenServerRevision: 1, hasUnsyncedChanges: false });
    client.fetchProjectList.mockResolvedValue([{ id: 'p1', revision: 1, updatedAt: '2026-01-01' }]);
    client.deleteProject.mockRejectedValueOnce(new Error('network')).mockResolvedValue(undefined);

    startProjectSync('user-a');
    await vi.waitFor(() => expect(phase()).toBe('ready'));

    useProjectStore.getState().deleteProject('p1');
    await vi.waitFor(() => expect(client.deleteProject).toHaveBeenCalledTimes(1));
    expect(useProjectStore.getState().projectTombstones['p1']).toBeGreaterThan(0);

    // Next reconcile (reload / back online): the server still lists p1 live.
    refreshProjectsFromServer();
    await vi.waitFor(() => expect(client.deleteProject).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(phase()).toBe('ready'));

    expect(client.fetchProject).not.toHaveBeenCalled(); // never pulled back
    expect(useProjectStore.getState().projects['p1']).toBeUndefined();
    expect(getProjectSyncMeta('user-a', 'p1')).toEqual({}); // delete landed
  });

  it('never pulls a tombstoned project, and never deletes cloud work this device never synced', async () => {
    useProjectStore.setState({ ...emptyState(), projectTombstones: { p1: Date.now() } });
    client.fetchProjectList.mockResolvedValue([{ id: 'p1', revision: 3, updatedAt: '2026-01-01' }]);

    startProjectSync('user-a');
    await vi.waitFor(() => expect(phase()).toBe('ready'));

    expect(client.fetchProject).not.toHaveBeenCalled();
    expect(useProjectStore.getState().projects['p1']).toBeUndefined();
    expect(client.deleteProject).not.toHaveBeenCalled();
  });

  it('never re-creates a tombstoned project on the server', async () => {
    // A stale copy of a deleted project, untouched since the deletion.
    useProjectStore.setState({
      ...emptyState(),
      projects: { p1: { id: 'p1', name: 'Stale', createdAt: 1 } },
      spineVersions: { p1: [] },
      projectTombstones: { p1: Date.now() },
    });
    client.fetchProjectList.mockResolvedValue([]);

    startProjectSync('user-a');
    await vi.waitFor(() => expect(phase()).toBe('ready'));

    expect(client.saveProject).not.toHaveBeenCalled();
  });
});

describe('a failed delete never erases newer cloud work (newer-wins)', () => {
  const phase = () => useProjectSyncStore.getState().phase;
  const deletedAt = Date.parse('2026-05-01T12:00:00Z');

  /** This device deleted p1 (tombstone) after last syncing it at revision 4. */
  function seedDeletedHere(): void {
    useProjectStore.setState({ ...emptyState(), projectTombstones: { p1: deletedAt } });
    setProjectSyncMeta('user-a', 'p1', {
      lastSeenServerRevision: 4,
      lastSeenServerUpdatedAt: '2026-05-01T11:00:00.000Z',
      lastCloudSavedAt: deletedAt - 3_600_000,
    });
  }

  /** A persist envelope holding the given project-keyed state (one tab's blob). */
  const blobOf = (state: Record<string, unknown>) => JSON.stringify({ state: { ...emptyState(), ...state }, version: 0 });

  it('a cloud copy changed after the delete survives: pulled back, tombstone cleared, no delete', async () => {
    seedDeletedHere();
    // Another device edited (or recreated) p1 after this device deleted it.
    client.fetchProjectList.mockResolvedValue([{ id: 'p1', revision: 6, updatedAt: '2026-05-01T12:30:00.000Z' }]);
    client.fetchProject.mockResolvedValue({ id: 'p1', revision: 6, data: serverBundle('p1') });

    startProjectSync('user-a');
    await vi.waitFor(() => expect(phase()).toBe('ready'));

    expect(client.deleteProject).not.toHaveBeenCalled();
    expect(useProjectStore.getState().projects['p1']?.name).toBe('Server p1');
    expect(useProjectStore.getState().projectTombstones['p1']).toBeUndefined();
    expect(getProjectSyncMeta('user-a', 'p1').lastSeenServerRevision).toBe(6);
  });

  it('a revived copy whose content predates the delete still survives a second tab that holds the tombstone', async () => {
    seedDeletedHere();
    // The cloud row changed after the delete, but its CONTENT is older (e.g.
    // offline edits pushed late): serverBundle's activity is epoch 1.
    client.fetchProjectList.mockResolvedValue([{ id: 'p1', revision: 6, updatedAt: '2026-05-01T12:30:00.000Z' }]);
    client.fetchProject.mockResolvedValue({ id: 'p1', revision: 6, data: serverBundle('p1') });

    startProjectSync('user-a');
    await vi.waitFor(() => expect(useProjectStore.getState().projects['p1']).toBeTruthy());

    const s = useProjectStore.getState();
    // The revival itself is activity after the delete...
    expect(latestProjectActivity(s as unknown as Record<string, unknown>, 'p1')).toBeGreaterThan(deletedAt);
    // ...so the cross-tab merge with a stale tab still holding the tombstone
    // keeps the project (in either write direction) instead of dropping it and
    // echoing the drop as a remote delete of the restored cloud work.
    const revived = blobOf({ projects: s.projects, spineVersions: s.spineVersions, projectTombstones: s.projectTombstones });
    const staleTab = blobOf({ projectTombstones: { p1: deletedAt } });
    for (const merged of [mergePersistedProjectBlobs(staleTab, revived), mergePersistedProjectBlobs(revived, staleTab)]) {
      const state = JSON.parse(merged).state;
      expect(state.projects['p1']?.name).toBe('Server p1');
      expect(state.projectTombstones['p1']).toBeUndefined();
    }
  });

  it('a copy another tab kept after the delete is neither deleted nor pulled over — this tab catches up', async () => {
    seedDeletedHere();
    // A second tab still had p1, edited it after the delete here (the
    // cross-tab merge keeps post-delete work) and pushed it — which advanced
    // the device-wide sync baseline to the server's current revision.
    setProjectSyncMeta('user-a', 'p1', { lastSeenServerRevision: 5, lastSeenServerUpdatedAt: '2026-05-01T12:10:00.000Z' });
    const kept = serverBundle('p1');
    localStorage.setItem(resolveProjectStorageName(), blobOf({
      projects: { p1: { ...kept.project, name: 'Kept in tab 2', updatedAt: deletedAt + 600_000 } },
      spineVersions: { p1: kept.spineVersions },
    }));
    client.fetchProjectList.mockResolvedValue([{ id: 'p1', revision: 5, updatedAt: '2026-05-01T12:10:00.000Z' }]);
    client.saveProject.mockResolvedValue({ id: 'p1', revision: 6 });

    startProjectSync('user-a');
    await vi.waitFor(() => expect(phase()).toBe('ready'));

    expect(client.deleteProject).not.toHaveBeenCalled();
    expect(client.fetchProject).not.toHaveBeenCalled();
    // The catch-up write merges the other tab's blob and adopts its copy.
    await vi.waitFor(
      () => expect(useProjectStore.getState().projects['p1']?.name).toBe('Kept in tab 2'),
      { timeout: 3_000 },
    );
    expect(useProjectStore.getState().projectTombstones['p1']).toBeUndefined();
  });

  it('a project deleted again after the newer-wins check stays deleted', async () => {
    seedDeletedHere();
    client.fetchProjectList.mockResolvedValue([{ id: 'p1', revision: 6, updatedAt: '2026-05-01T12:30:00.000Z' }]);
    client.fetchProject.mockImplementation(async (id: string) => {
      // Another tab revived p1 and the user deleted it again while this
      // bundle was in flight (adopted as a newer tombstone).
      useProjectStore.setState({ projectTombstones: { p1: Date.parse('2026-05-01T13:00:00Z') } });
      return { id, revision: 6, data: serverBundle(id) };
    });

    startProjectSync('user-a');
    await vi.waitFor(() => expect(phase()).toBe('ready'));

    expect(useProjectStore.getState().projects['p1']).toBeUndefined();
    expect(useProjectStore.getState().projectTombstones['p1']).toBe(Date.parse('2026-05-01T13:00:00Z'));
    // Not applied, so no server baseline is recorded for content never held.
    expect(getProjectSyncMeta('user-a', 'p1').lastSeenServerRevision).toBe(4);
  });

  it('a pulled bundle skipped at apply time records no server baseline', async () => {
    client.fetchProjectList.mockResolvedValue([{ id: 'p2', revision: 3, updatedAt: '2026-05-01T12:00:00.000Z' }]);
    client.fetchProject.mockImplementation(async (id: string) => {
      // Deleted in another tab while the bundle was in flight.
      useProjectStore.setState({ projectTombstones: { [id]: Date.now() } });
      return { id, revision: 3, data: serverBundle(id) };
    });

    startProjectSync('user-a');
    await vi.waitFor(() => expect(phase()).toBe('ready'));

    expect(useProjectStore.getState().projects['p2']).toBeUndefined();
    // A baseline would make the next reconcile treat the server copy as
    // "unchanged since this device synced it" and retry the delete on it.
    expect(getProjectSyncMeta('user-a', 'p2')).toEqual({});
  });

  it('an older cloud copy — unchanged since this device last synced it — is deleted', async () => {
    seedDeletedHere();
    client.fetchProjectList.mockResolvedValue([{ id: 'p1', revision: 4, updatedAt: '2026-05-01T11:00:00.000Z' }]);
    client.deleteProject.mockResolvedValue(undefined);

    startProjectSync('user-a');
    await vi.waitFor(() => expect(phase()).toBe('ready'));

    expect(client.deleteProject).toHaveBeenCalledWith('p1');
    expect(client.fetchProject).not.toHaveBeenCalled();
    expect(useProjectStore.getState().projects['p1']).toBeUndefined();
  });

  it('a cloud change stamped before the delete loses to it (the delete is retried)', async () => {
    seedDeletedHere();
    // Changed on another device since this one last synced — but before the
    // deletion here, so the delete is the newer act.
    client.fetchProjectList.mockResolvedValue([{ id: 'p1', revision: 5, updatedAt: '2026-05-01T11:30:00.000Z' }]);
    client.deleteProject.mockResolvedValue(undefined);

    startProjectSync('user-a');
    await vi.waitFor(() => expect(phase()).toBe('ready'));

    expect(client.deleteProject).toHaveBeenCalledWith('p1');
    expect(client.fetchProject).not.toHaveBeenCalled();
  });
});

describe('output-run lease heartbeats are not pushed', () => {
  it('a heartbeat-only change does not upload the bundle; a real change still does', async () => {
    seedLocalProject('p1', 'Local p1');
    useProjectStore.setState((s) => ({
      projects: {
        ...s.projects,
        p1: {
          ...s.projects['p1'],
          outputRun: { spineVersionId: 'v1', runId: 'r1', startedAt: 1, phase: 'running', ownerTabId: 't', heartbeatAt: 1 },
        },
      },
    }));
    setProjectSyncMeta('user-a', 'p1', { lastSeenServerRevision: 2, hasUnsyncedChanges: false });
    client.fetchProjectList.mockResolvedValue([{ id: 'p1', revision: 2 }]);
    client.saveProject.mockResolvedValue({ id: 'p1', revision: 3 });

    startProjectSync('user-a');
    await vi.waitFor(() => expect(useProjectSyncStore.getState().phase).toBe('ready'));
    client.saveProject.mockClear();

    vi.useFakeTimers();
    useProjectStore.getState().heartbeatOutputRun('p1', 'r1');
    await vi.advanceTimersByTimeAsync(2000);
    expect(client.saveProject).not.toHaveBeenCalled();

    useProjectStore.getState().setProjectStage('p1', 'workspace');
    await vi.advanceTimersByTimeAsync(2000);
    expect(client.saveProject).toHaveBeenCalledTimes(1);
  });
});

describe('reconcile reports partial pull failures', () => {
  it('lists the projects it could not download instead of reporting a clean sync', async () => {
    client.fetchProjectList.mockResolvedValue([
      { id: 'p1', updatedAt: '2026-01-01' },
      { id: 'p2', updatedAt: '2026-01-01' },
    ]);
    client.fetchProject.mockImplementation(async (id: string) => {
      if (id === 'p2') throw new Error('fetch_failed_500');
      return { id, data: serverBundle(id) };
    });

    startProjectSync('user-a');
    await vi.waitFor(() => expect(useProjectSyncStore.getState().phase).toBe('ready'));

    expect(useProjectSyncStore.getState().failedPullIds).toEqual(['p2']);
    expect(useProjectStore.getState().projects['p1']).toBeTruthy();
    expect(useProjectStore.getState().projects['p2']).toBeUndefined();

    // A clean retry clears the partial-failure status.
    client.fetchProject.mockImplementation(async (id: string) => ({ id, data: serverBundle(id) }));
    refreshProjectsFromServer();
    await vi.waitFor(() => expect(useProjectStore.getState().projects['p2']).toBeTruthy());
    await vi.waitFor(() => expect(useProjectSyncStore.getState().phase).toBe('ready'));
    expect(useProjectSyncStore.getState().failedPullIds).toEqual([]);
  });
});

describe('conflict resolution reports what actually happened', () => {
  async function startInConflict(): Promise<void> {
    seedLocalProject('p1', 'Local edit');
    setProjectSyncMeta('user-a', 'p1', { lastSeenServerRevision: 1, hasUnsyncedChanges: true });
    client.fetchProjectList.mockResolvedValue([{ id: 'p1', revision: 5, updatedAt: '2026-03-03' }]);
    startProjectSync('user-a');
    await vi.waitFor(() => expect(useProjectSyncStore.getState().projects['p1']?.state).toBe('conflict'));
  }

  it('use cloud: a failed fetch reports failed and restores the conflict (not stuck at saving)', async () => {
    await startInConflict();
    client.fetchProject.mockRejectedValue(new Error('network'));

    await expect(resolveConflictUseCloud('p1')).resolves.toBe('failed');
    expect(useProjectSyncStore.getState().projects['p1']?.state).toBe('conflict');
    expect(useProjectStore.getState().projects['p1']?.name).toBe('Local edit');
  });

  it('use cloud: adopts the cloud copy', async () => {
    await startInConflict();
    client.fetchProject.mockResolvedValue({ id: 'p1', revision: 5, data: serverBundle('p1') });

    await expect(resolveConflictUseCloud('p1')).resolves.toBe('resolved');
    expect(useProjectStore.getState().projects['p1']?.name).toBe('Server p1');
  });

  it('use cloud: reports a missing cloud copy (local kept)', async () => {
    await startInConflict();
    client.fetchProject.mockResolvedValue(null);

    await expect(resolveConflictUseCloud('p1')).resolves.toBe('cloud_missing');
    expect(useProjectStore.getState().projects['p1']?.name).toBe('Local edit');
  });

  it('keep local: reports a second conflict, an upload failure, and success distinctly', async () => {
    await startInConflict();
    client.fetchProject.mockResolvedValue({ id: 'p1', revision: 6, data: serverBundle('p1') });

    client.saveProject.mockRejectedValueOnce(new client.RevisionConflictError(7));
    await expect(resolveConflictKeepLocal('p1')).resolves.toBe('conflicted_again');

    client.saveProject.mockRejectedValueOnce(new Error('save_failed'));
    await expect(resolveConflictKeepLocal('p1')).resolves.toBe('upload_failed');

    client.saveProject.mockResolvedValueOnce({ id: 'p1', revision: 7 });
    await expect(resolveConflictKeepLocal('p1')).resolves.toBe('resolved');
    expect(getProjectSyncMeta('user-a', 'p1').conflict).toBe(false);
  });
});
