import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the auth chokepoint, rate limiter, and data layer so we can test the
// handler's routing and — critically — that it passes the *session* userId to
// the data layer, never a client-supplied one.
const requireUser = vi.fn();
const enforceRateLimit = vi.fn(() => false);
const dataLayer = {
  isValidProjectId: vi.fn((id) => typeof id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(id)),
  listProjects: vi.fn(),
  getProject: vi.fn(),
  upsertProject: vi.fn(),
  softDeleteProject: vi.fn(),
  restoreProject: vi.fn(),
  setArchived: vi.fn(),
  hardDeleteProject: vi.fn(),
  importProjects: vi.fn(),
};

vi.mock('../_lib/requireUser.js', () => ({ requireUser: (...a) => requireUser(...a) }));
vi.mock('../_lib/rateLimit.js', () => ({ enforceRateLimit: (...a) => enforceRateLimit(...a) }));
vi.mock('../_lib/projectsStore.js', () => dataLayer);

let handler;

function mockRes() {
  return {
    statusCode: 0,
    body: null,
    headers: {},
    status(code) { this.statusCode = code; return this; },
    setHeader(k, v) { this.headers[k] = v; },
    send(b) { this.body = b; },
  };
}

const parsed = (res) => JSON.parse(res.body);

beforeEach(async () => {
  vi.resetModules();
  requireUser.mockReset().mockResolvedValue({ userId: 'user-a' });
  enforceRateLimit.mockReset().mockReturnValue(false);
  Object.values(dataLayer).forEach((fn) => fn.mockReset());
  dataLayer.isValidProjectId.mockImplementation(
    (id) => typeof id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(id),
  );
  ({ default: handler } = await import('../projects.js'));
});

afterEach(() => vi.restoreAllMocks());

describe('GET /api/projects', () => {
  it('lists the authenticated user\'s projects', async () => {
    dataLayer.listProjects.mockResolvedValue([{ id: 'p1' }]);
    const res = mockRes();
    await handler({ method: 'GET', query: {}, headers: {} }, res);
    expect(res.statusCode).toBe(200);
    expect(parsed(res)).toEqual({ projects: [{ id: 'p1' }] });
    expect(dataLayer.listProjects).toHaveBeenCalledWith('user-a', expect.anything());
  });

  it('fetches one project scoped to the session user', async () => {
    dataLayer.getProject.mockResolvedValue({ id: 'p1', userId: 'user-a' });
    const res = mockRes();
    await handler({ method: 'GET', query: { id: 'p1' }, headers: {} }, res);
    expect(res.statusCode).toBe(200);
    // Session userId, not anything from the request, is used.
    expect(dataLayer.getProject).toHaveBeenCalledWith('user-a', 'p1');
  });

  it('404s when the project is not the user\'s', async () => {
    dataLayer.getProject.mockResolvedValue(null);
    const res = mockRes();
    await handler({ method: 'GET', query: { id: 'p1' }, headers: {} }, res);
    expect(res.statusCode).toBe(404);
  });
});

describe('auth + method gating', () => {
  it('returns nothing more once requireUser has sent a 401', async () => {
    requireUser.mockImplementation(async (_req, res) => {
      res.status(401).setHeader('Content-Type', 'application/json');
      res.send(JSON.stringify({ error: 'unauthorized' }));
      return null;
    });
    const res = mockRes();
    await handler({ method: 'GET', query: {}, headers: {} }, res);
    expect(res.statusCode).toBe(401);
    expect(dataLayer.listProjects).not.toHaveBeenCalled();
  });

  it('rejects unsupported methods', async () => {
    const res = mockRes();
    await handler({ method: 'PATCH', query: {}, headers: {} }, res);
    expect(res.statusCode).toBe(405);
  });

  it('short-circuits when rate-limited', async () => {
    enforceRateLimit.mockReturnValue(true);
    const res = mockRes();
    await handler({ method: 'GET', query: {}, headers: {} }, res);
    expect(requireUser).not.toHaveBeenCalled();
  });
});

describe('PUT /api/projects', () => {
  it('upserts a bundle under the session user and ignores a mismatched body id', async () => {
    dataLayer.upsertProject.mockResolvedValue({ id: 'p1', created: true });
    const res = mockRes();
    const body = { bundle: { project: { id: 'SOMEONE_ELSE', name: 'X' } } };
    await handler({ method: 'PUT', query: { id: 'p1' }, headers: {}, body }, res);
    expect(res.statusCode).toBe(200);
    // URL id + session user win — the body's project.id never selects the row.
    expect(dataLayer.upsertProject).toHaveBeenCalledWith('user-a', 'p1', body.bundle);
  });

  it('rejects a body with no project', async () => {
    const res = mockRes();
    await handler({ method: 'PUT', query: { id: 'p1' }, headers: {}, body: { bundle: {} } }, res);
    expect(res.statusCode).toBe(400);
    expect(parsed(res).error).toBe('invalid_bundle');
  });
});

describe('DELETE /api/projects', () => {
  it('soft-deletes by default', async () => {
    dataLayer.softDeleteProject.mockResolvedValue(true);
    const res = mockRes();
    await handler({ method: 'DELETE', query: { id: 'p1' }, headers: {} }, res);
    expect(res.statusCode).toBe(200);
    expect(parsed(res).soft).toBe(true);
    expect(dataLayer.softDeleteProject).toHaveBeenCalledWith('user-a', 'p1');
  });

  it('hard-deletes with ?hard=1', async () => {
    dataLayer.hardDeleteProject.mockResolvedValue(true);
    const res = mockRes();
    await handler({ method: 'DELETE', query: { id: 'p1', hard: '1' }, headers: {} }, res);
    expect(dataLayer.hardDeleteProject).toHaveBeenCalledWith('user-a', 'p1');
  });
});

describe('POST actions', () => {
  it('imports bundles', async () => {
    dataLayer.importProjects.mockResolvedValue({ imported: [{ id: 'p1', created: true }], failed: [] });
    const res = mockRes();
    const body = { bundles: [{ project: { id: 'p1' } }] };
    await handler({ method: 'POST', query: { action: 'import' }, headers: {}, body }, res);
    expect(res.statusCode).toBe(200);
    expect(dataLayer.importProjects).toHaveBeenCalledWith('user-a', body.bundles);
  });

  it('restores a soft-deleted project', async () => {
    dataLayer.restoreProject.mockResolvedValue(true);
    const res = mockRes();
    await handler({ method: 'POST', query: { action: 'restore', id: 'p1' }, headers: {} }, res);
    expect(res.statusCode).toBe(200);
    expect(parsed(res).restored).toBe(true);
  });
});
