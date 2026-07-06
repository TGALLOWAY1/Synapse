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

// Image-ref data layer + Blob SDK — mocked so the handler's image-sync routing
// can be exercised without Mongo or Vercel Blob.
const imageRefs = {
  isValidImageKey: vi.fn((k) => typeof k === 'string' && k.length > 0 && k.length <= 512),
  isValidRef: vi.fn((r) => Boolean(r && r.key && r.hash && r.blobUrl)),
  listImageRefs: vi.fn(),
  upsertImageRef: vi.fn(),
  deleteImageRefs: vi.fn(),
  deleteRefsForProject: vi.fn(),
};
const handleUpload = vi.fn();
const del = vi.fn();

vi.mock('../_lib/requireUser.js', () => ({ requireUser: (...a) => requireUser(...a) }));
vi.mock('../_lib/rateLimit.js', () => ({ enforceRateLimit: (...a) => enforceRateLimit(...a) }));
vi.mock('../_lib/projectsStore.js', () => dataLayer);
vi.mock('../_lib/imageRefsStore.js', () => imageRefs);
vi.mock('@vercel/blob/client', () => ({ handleUpload: (...a) => handleUpload(...a) }));
vi.mock('@vercel/blob', () => ({ del: (...a) => del(...a) }));

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
  Object.values(imageRefs).forEach((fn) => fn.mockReset());
  handleUpload.mockReset();
  del.mockReset();
  imageRefs.isValidImageKey.mockImplementation((k) => typeof k === 'string' && k.length > 0 && k.length <= 512);
  imageRefs.isValidRef.mockImplementation((r) => Boolean(r && r.key && r.hash && r.blobUrl));
  dataLayer.isValidProjectId.mockImplementation(
    (id) => typeof id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(id),
  );
  process.env.BLOB_READ_WRITE_TOKEN = 'test-token';
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
    expect(dataLayer.upsertProject).toHaveBeenCalledWith('user-a', 'p1', body.bundle, {
      expectedRevision: undefined,
    });
  });

  it('passes ?expectedRevision through to the conditional upsert', async () => {
    dataLayer.upsertProject.mockResolvedValue({ id: 'p1', revision: 6 });
    const res = mockRes();
    const body = { bundle: { project: { id: 'p1', name: 'X' } } };
    await handler({ method: 'PUT', query: { id: 'p1', expectedRevision: '5' }, headers: {}, body }, res);
    expect(res.statusCode).toBe(200);
    expect(dataLayer.upsertProject).toHaveBeenCalledWith('user-a', 'p1', body.bundle, {
      expectedRevision: 5,
    });
  });

  it('returns 409 when the data layer reports a revision conflict (no overwrite)', async () => {
    dataLayer.upsertProject.mockResolvedValue({ conflict: true, currentRevision: 9, id: 'p1' });
    const res = mockRes();
    const body = { bundle: { project: { id: 'p1', name: 'X' } } };
    await handler({ method: 'PUT', query: { id: 'p1', expectedRevision: '4' }, headers: {}, body }, res);
    expect(res.statusCode).toBe(409);
    expect(parsed(res)).toMatchObject({ error: 'revision_conflict', currentRevision: 9 });
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

describe('image sync actions', () => {
  it('GET image-refs lists the session user\'s refs for the project', async () => {
    imageRefs.listImageRefs.mockResolvedValue([{ key: 'k1' }]);
    const res = mockRes();
    await handler({ method: 'GET', query: { action: 'image-refs', id: 'p1' }, headers: {} }, res);
    expect(res.statusCode).toBe(200);
    expect(parsed(res)).toEqual({ refs: [{ key: 'k1' }] });
    expect(imageRefs.listImageRefs).toHaveBeenCalledWith('user-a', 'p1');
  });

  it('image-ref-put upserts under the session user when the blob URL is in their prefix', async () => {
    imageRefs.upsertImageRef.mockResolvedValue({ key: 'k1' });
    const res = mockRes();
    const ref = { key: 'k1', hash: 'h', blobUrl: 'https://blob/users/user-a/mockup-images/h.png' };
    await handler({ method: 'POST', query: { action: 'image-ref-put', id: 'p1' }, headers: {}, body: { ref } }, res);
    expect(res.statusCode).toBe(200);
    expect(imageRefs.upsertImageRef).toHaveBeenCalledWith('user-a', 'p1', ref);
  });

  it('image-ref-put rejects a blob URL outside the caller\'s prefix', async () => {
    const res = mockRes();
    const ref = { key: 'k1', hash: 'h', blobUrl: 'https://blob/users/SOMEONE_ELSE/mockup-images/h.png' };
    await handler({ method: 'POST', query: { action: 'image-ref-put', id: 'p1' }, headers: {}, body: { ref } }, res);
    expect(res.statusCode).toBe(403);
    expect(parsed(res).error).toBe('forbidden_blob_url');
    expect(imageRefs.upsertImageRef).not.toHaveBeenCalled();
  });

  it('image-ref-delete deletes refs and GCs the orphaned blobs', async () => {
    imageRefs.deleteImageRefs.mockResolvedValue({ deletedCount: 2, orphanedBlobUrls: ['url1', 'url2'] });
    const res = mockRes();
    await handler({ method: 'POST', query: { action: 'image-ref-delete', id: 'p1' }, headers: {}, body: { keys: ['k1', 'k2'] } }, res);
    expect(res.statusCode).toBe(200);
    expect(parsed(res)).toEqual({ deletedCount: 2, orphanedBlobs: 2 });
    expect(imageRefs.deleteImageRefs).toHaveBeenCalledWith('user-a', 'p1', ['k1', 'k2']);
    expect(del).toHaveBeenCalledWith(['url1', 'url2']);
  });

  it('hard-delete also GCs the project\'s image refs + orphan blobs', async () => {
    dataLayer.hardDeleteProject.mockResolvedValue(true);
    imageRefs.deleteRefsForProject.mockResolvedValue({ deletedCount: 1, orphanedBlobUrls: ['url1'] });
    const res = mockRes();
    await handler({ method: 'DELETE', query: { id: 'p1', hard: '1' }, headers: {} }, res);
    expect(res.statusCode).toBe(200);
    expect(imageRefs.deleteRefsForProject).toHaveBeenCalledWith('user-a', 'p1');
    expect(del).toHaveBeenCalledWith(['url1']);
  });

  it('image-upload-token authenticates the browser token request and calls handleUpload', async () => {
    handleUpload.mockResolvedValue({ type: 'blob.generate-client-token', clientToken: 'tok' });
    const res = mockRes();
    await handler(
      { method: 'POST', query: { action: 'image-upload-token' }, headers: {}, body: { type: 'blob.generate-client-token' } },
      res,
    );
    expect(res.statusCode).toBe(200);
    expect(parsed(res)).toEqual({ type: 'blob.generate-client-token', clientToken: 'tok' });
    expect(requireUser).toHaveBeenCalled();
    expect(handleUpload).toHaveBeenCalled();
  });

  it('image-upload-token does NOT require a session for the signed completion callback', async () => {
    handleUpload.mockResolvedValue({ type: 'blob.upload-completed', response: 'ok' });
    const res = mockRes();
    await handler(
      { method: 'POST', query: { action: 'image-upload-token' }, headers: {}, body: { type: 'blob.upload-completed', payload: {} } },
      res,
    );
    expect(res.statusCode).toBe(200);
    // The callback is a server-to-server request with no cookie — auth is the
    // handleUpload signature check, not requireUser.
    expect(requireUser).not.toHaveBeenCalled();
    expect(handleUpload).toHaveBeenCalled();
  });
});
