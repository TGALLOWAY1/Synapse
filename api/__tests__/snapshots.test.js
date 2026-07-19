import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// SYN-003: the pin-time completeness backstop in handlePutDemo. We mock the
// auth/rate-limit seams and the Vercel Blob SDK so we can drive the "set demo"
// path against a controlled set of blobs + manifest.
const enforceRateLimit = vi.fn(() => false);
const requireOwner = vi.fn(() => false); // false = authorized (no early return)
const put = vi.fn(async () => ({}));
const list = vi.fn();
const del = vi.fn(async () => ({}));

vi.mock('../_lib/rateLimit.js', () => ({ enforceRateLimit: (...a) => enforceRateLimit(...a) }));
vi.mock('../_lib/ownerAuth.js', () => ({ requireOwner: (...a) => requireOwner(...a) }));
vi.mock('@vercel/blob', () => ({
  put: (...a) => put(...a),
  list: (...a) => list(...a),
  del: (...a) => del(...a),
}));

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

const SNAP_ID = 'aaaaaaaa11112222333344445555';

// Build the blob list findBlobsForId returns for one snapshot.
function blobsFor({ withImages = false } = {}) {
  const base = [
    { pathname: `snapshots/${SNAP_ID}/data.json`, url: `https://blob/${SNAP_ID}/data.json` },
    { pathname: `snapshots/${SNAP_ID}/manifest.json`, url: `https://blob/${SNAP_ID}/manifest.json` },
  ];
  if (withImages) {
    base.push({ pathname: `snapshots/${SNAP_ID}/images/deadbeef.json`, url: `https://blob/${SNAP_ID}/images/deadbeef.json` });
  }
  return base;
}

// Stub global fetch so fetchBlobJson(manifest.url) resolves to our manifest.
function stubManifestFetch(manifest) {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    json: async () => manifest,
    text: async () => '',
  })));
}

beforeEach(async () => {
  vi.resetModules();
  enforceRateLimit.mockReset().mockReturnValue(false);
  requireOwner.mockReset().mockReturnValue(false);
  put.mockReset().mockResolvedValue({});
  list.mockReset();
  del.mockReset().mockResolvedValue({});
  process.env.BLOB_READ_WRITE_TOKEN = 'test-token';
  ({ default: handler } = await import('../snapshots.js'));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('PUT /api/snapshots?demo=1 — pin-time completeness gate (SYN-003)', () => {
  it('rejects 422 when the manifest claims mockup screens but no image blobs exist', async () => {
    list.mockResolvedValue({ blobs: blobsFor({ withImages: false }), hasMore: false });
    stubManifestFetch({ id: SNAP_ID, mockupScreenCount: 3, imageCount: 0 });

    const res = mockRes();
    await handler({ method: 'PUT', query: { demo: '1', id: SNAP_ID }, headers: {} }, res);

    expect(res.statusCode).toBe(422);
    expect(parsed(res).error).toBe('demo_snapshot_incomplete');
    // The pointer is never written for a rejected pin.
    expect(put).not.toHaveBeenCalled();
  });

  it('passes (200) for a legacy manifest with no mockupScreenCount, even with zero images', async () => {
    list.mockResolvedValue({ blobs: blobsFor({ withImages: false }), hasMore: false });
    stubManifestFetch({ id: SNAP_ID, imageCount: 0 }); // no mockupScreenCount field

    const res = mockRes();
    await handler({ method: 'PUT', query: { demo: '1', id: SNAP_ID }, headers: {} }, res);

    expect(res.statusCode).toBe(200);
    expect(parsed(res)).toEqual({ demoSnapshotId: SNAP_ID });
    // The demo pointer blob was written.
    expect(put).toHaveBeenCalledTimes(1);
  });

  it('passes (200) when image blobs exist even though the manifest claims mockup screens', async () => {
    list.mockResolvedValue({ blobs: blobsFor({ withImages: true }), hasMore: false });
    // fetch should not even be needed here (imageBlobCount > 0 short-circuits),
    // but stub it defensively.
    stubManifestFetch({ id: SNAP_ID, mockupScreenCount: 3, imageCount: 1 });

    const res = mockRes();
    await handler({ method: 'PUT', query: { demo: '1', id: SNAP_ID }, headers: {} }, res);

    expect(res.statusCode).toBe(200);
    expect(parsed(res)).toEqual({ demoSnapshotId: SNAP_ID });
    expect(put).toHaveBeenCalledTimes(1);
  });
});
