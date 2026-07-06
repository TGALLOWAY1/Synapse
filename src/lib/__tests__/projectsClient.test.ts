import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  fetchProjectList,
  fetchProject,
  saveProject,
  deleteProject,
  importProjects,
} from '../projectsClient';
import type { ProjectBundle } from '../projectBundle';

function okJson(body: unknown) {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}
function errJson(status: number, body: unknown) {
  return { ok: false, status, json: async () => body } as unknown as Response;
}

const bundle: ProjectBundle = {
  project: { id: 'p1', name: 'Test', createdAt: 1 },
  spineVersions: [],
  historyEvents: [],
  branches: [],
  artifacts: [],
  artifactVersions: [],
  feedbackItems: [],
  tasks: [],
  workflowRuns: [],
};

beforeEach(() => {
  vi.restoreAllMocks();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('projectsClient', () => {
  it('fetchProjectList GETs /api/projects with the session cookie (shared source)', async () => {
    const fetchMock = vi.fn(async () => okJson({ projects: [{ id: 'p1' }] }));
    vi.stubGlobal('fetch', fetchMock);
    const out = await fetchProjectList();
    expect(out).toEqual([{ id: 'p1' }]);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    // Mobile and desktop both hit this exact endpoint — one backing source.
    expect(url).toBe('/api/projects');
    expect((init as RequestInit).credentials).toBe('include');
  });

  it('fetchProject returns null on 404 (not the user\'s project)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => errJson(404, { error: 'not_found' })));
    expect(await fetchProject('p1')).toBeNull();
  });

  it('saveProject PUTs the bundle and returns the saved summary', async () => {
    const fetchMock = vi.fn(async () => okJson({ project: { id: 'p1', revision: 2 } }));
    vi.stubGlobal('fetch', fetchMock);
    const out = await saveProject('p1', bundle);
    expect(out).toEqual({ id: 'p1', revision: 2 });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/projects?id=p1');
    expect((init as RequestInit).method).toBe('PUT');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ bundle });
  });

  it('saveProject throws on a non-2xx response (so sync can mark failure)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => errJson(500, { error: 'projects_failed' })));
    await expect(saveProject('p1', bundle)).rejects.toThrow(/projects_failed/);
  });

  it('saveProject sends expectedRevision as a query param (conditional write)', async () => {
    const fetchMock = vi.fn(async () => okJson({ project: { id: 'p1', revision: 6 } }));
    vi.stubGlobal('fetch', fetchMock);
    await saveProject('p1', bundle, { expectedRevision: 5 });
    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url).toBe('/api/projects?id=p1&expectedRevision=5');
  });

  it('saveProject falls back to expectedUpdatedAt when there is no revision baseline', async () => {
    const fetchMock = vi.fn(async () => okJson({ project: { id: 'p1', revision: 1 } }));
    vi.stubGlobal('fetch', fetchMock);
    await saveProject('p1', bundle, { expectedUpdatedAt: '2026-01-01T00:00:00.000Z' });
    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url).toContain('expectedUpdatedAt=2026-01-01');
    expect(url).not.toContain('expectedRevision');
  });

  it('saveProject prefers expectedRevision over expectedUpdatedAt when both are given', async () => {
    const fetchMock = vi.fn(async () => okJson({ project: { id: 'p1', revision: 3 } }));
    vi.stubGlobal('fetch', fetchMock);
    await saveProject('p1', bundle, { expectedRevision: 2, expectedUpdatedAt: '2026-01-01T00:00:00.000Z' });
    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url).toContain('expectedRevision=2');
    expect(url).not.toContain('expectedUpdatedAt');
  });

  it('saveProject throws a typed RevisionConflictError on 409 (stale push blocked)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => errJson(409, { error: 'revision_conflict', currentRevision: 9 })));
    await expect(saveProject('p1', bundle, { expectedRevision: 4 })).rejects.toMatchObject({
      code: 'revision_conflict',
      currentRevision: 9,
    });
  });

  it('deleteProject tolerates a 404 (already gone)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => errJson(404, { error: 'not_found' })));
    await expect(deleteProject('p1')).resolves.toBeUndefined();
  });

  it('importProjects POSTs the bundles to the import action', async () => {
    const fetchMock = vi.fn(async () => okJson({ imported: [{ id: 'p1', created: true }], failed: [] }));
    vi.stubGlobal('fetch', fetchMock);
    const out = await importProjects([bundle]);
    expect(out.imported).toEqual([{ id: 'p1', created: true }]);
    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url).toBe('/api/projects?action=import');
  });
});
