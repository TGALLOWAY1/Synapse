import { describe, it, expect, beforeEach } from 'vitest';
import {
  getProjectSyncMeta,
  setProjectSyncMeta,
  removeProjectSyncMeta,
  getAllProjectSyncMeta,
  isServerNewer,
} from '../projectSyncMeta';

beforeEach(() => {
  localStorage.clear();
});

describe('projectSyncMeta persistence', () => {
  it('returns an empty object for an unknown project (back-compat)', () => {
    expect(getProjectSyncMeta('u1', 'p1')).toEqual({});
  });

  it('shallow-merges patches and survives a reload (durable baseline)', () => {
    setProjectSyncMeta('u1', 'p1', { lastSeenServerRevision: 3, hasUnsyncedChanges: true });
    setProjectSyncMeta('u1', 'p1', { lastCloudSavedAt: 1234 });
    // A fresh read (simulating a reload) sees both patches.
    expect(getProjectSyncMeta('u1', 'p1')).toEqual({
      lastSeenServerRevision: 3,
      hasUnsyncedChanges: true,
      lastCloudSavedAt: 1234,
    });
  });

  it('namespaces per user — one user cannot read another\'s meta', () => {
    setProjectSyncMeta('u1', 'p1', { lastSeenServerRevision: 5 });
    expect(getProjectSyncMeta('u2', 'p1')).toEqual({});
    expect(getAllProjectSyncMeta('u2')).toEqual({});
  });

  it('lets null explicitly clear lastCloudSaveError', () => {
    setProjectSyncMeta('u1', 'p1', { lastCloudSaveError: 'boom' });
    setProjectSyncMeta('u1', 'p1', { lastCloudSaveError: null });
    expect(getProjectSyncMeta('u1', 'p1').lastCloudSaveError).toBeNull();
  });

  it('removeProjectSyncMeta drops a single project', () => {
    setProjectSyncMeta('u1', 'p1', { lastSeenServerRevision: 1 });
    setProjectSyncMeta('u1', 'p2', { lastSeenServerRevision: 2 });
    removeProjectSyncMeta('u1', 'p1');
    expect(getProjectSyncMeta('u1', 'p1')).toEqual({});
    expect(getProjectSyncMeta('u1', 'p2').lastSeenServerRevision).toBe(2);
  });
});

describe('isServerNewer', () => {
  it('prefers the monotonic revision counter', () => {
    expect(isServerNewer({ revision: 4 }, { lastSeenServerRevision: 3 })).toBe(true);
    expect(isServerNewer({ revision: 3 }, { lastSeenServerRevision: 3 })).toBe(false);
    expect(isServerNewer({ revision: 2 }, { lastSeenServerRevision: 3 })).toBe(false);
  });

  it('falls back to updatedAt when revisions are unavailable', () => {
    expect(
      isServerNewer({ updatedAt: '2026-02-02' }, { lastSeenServerUpdatedAt: '2026-01-01' }),
    ).toBe(true);
    expect(
      isServerNewer({ updatedAt: '2026-01-01' }, { lastSeenServerUpdatedAt: '2026-02-02' }),
    ).toBe(false);
  });

  it('returns false when there is no baseline to compare against', () => {
    expect(isServerNewer({ revision: 9, updatedAt: '2026-02-02' }, {})).toBe(false);
  });
});
