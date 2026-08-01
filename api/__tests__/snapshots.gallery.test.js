import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Project-gallery channel: adding/removing slots, the go-live mode toggle
// (which must refuse to flip to 'gallery' until every slot is filled), and
// the public reads. We mock the auth/rate-limit seams and the Vercel Blob
// SDK so we can drive the handlers against a controlled set of blobs.
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

const GALLERY_POINTER_PATH = 'snapshots/_gallery.json';
const POINTER_URL = 'https://blob/_gallery.json';

const SNAP_IDS = [
  'aaaaaaaa1111',
  'bbbbbbbb2222',
  'cccccccc3333',
  'dddddddd4444',
  'eeeeeeee5555',
  'ffffffff6666',
];
const NEW_ID = '9999999a0000';

// Drive `list` by prefix: the gallery pointer path resolves to a pointer
// blob (when `pointer` is set), and any `snapshots/<id>/` prefix resolves to
// that snapshot's data/manifest/image blobs (when the id is in `known`).
function stubBlobs({ pointer = null, known = [], withImages = true } = {}) {
  list.mockImplementation(async ({ prefix }) => {
    if (prefix === GALLERY_POINTER_PATH) {
      return {
        blobs: pointer ? [{ pathname: GALLERY_POINTER_PATH, url: POINTER_URL }] : [],
        hasMore: false,
      };
    }
    const id = known.find((k) => prefix.startsWith(`snapshots/${k}/`));
    if (!id) return { blobs: [], hasMore: false };
    const blobs = [
      { pathname: `snapshots/${id}/data.json`, url: `https://blob/${id}/data.json` },
      { pathname: `snapshots/${id}/manifest.json`, url: `https://blob/${id}/manifest.json` },
    ];
    if (withImages) {
      blobs.push({ pathname: `snapshots/${id}/images/deadbeef.json`, url: `https://blob/${id}/images/deadbeef.json` });
    }
    return { blobs, hasMore: false };
  });
  // fetchBlobJson resolves the pointer body; manifests only matter for the
  // zero-image gate, which `withImages: true` short-circuits.
  vi.stubGlobal('fetch', vi.fn(async (url) => ({
    ok: true,
    json: async () => (url === POINTER_URL ? pointer : { id: 'x', imageCount: 1 }),
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

const putPointerBody = () => {
  const call = put.mock.calls.find(([path]) => path === GALLERY_POINTER_PATH);
  return call ? JSON.parse(call[1]) : null;
};

describe('PUT /api/snapshots?gallery=1&id= — slot management', () => {
  it('appends a snapshot to the next free slot', async () => {
    stubBlobs({ pointer: { mode: 'demo', snapshotIds: SNAP_IDS.slice(0, 2) }, known: [NEW_ID] });

    const res = mockRes();
    await handler({ method: 'PUT', query: { gallery: '1', id: NEW_ID }, headers: {} }, res);

    expect(res.statusCode).toBe(200);
    expect(parsed(res).snapshotIds).toEqual([...SNAP_IDS.slice(0, 2), NEW_ID]);
    expect(putPointerBody()?.snapshotIds).toEqual([...SNAP_IDS.slice(0, 2), NEW_ID]);
  });

  it('rejects 409 gallery_full once all six slots are filled', async () => {
    stubBlobs({ pointer: { mode: 'demo', snapshotIds: SNAP_IDS }, known: [NEW_ID] });

    const res = mockRes();
    await handler({ method: 'PUT', query: { gallery: '1', id: NEW_ID }, headers: {} }, res);

    expect(res.statusCode).toBe(409);
    expect(parsed(res).error).toBe('gallery_full');
    expect(putPointerBody()).toBeNull();
  });

  it('rejects 409 already_in_gallery for a duplicate add', async () => {
    stubBlobs({ pointer: { mode: 'demo', snapshotIds: [SNAP_IDS[0]] }, known: SNAP_IDS });

    const res = mockRes();
    await handler({ method: 'PUT', query: { gallery: '1', id: SNAP_IDS[0] }, headers: {} }, res);

    expect(res.statusCode).toBe(409);
    expect(parsed(res).error).toBe('already_in_gallery');
  });

  it('applies the SYN-003 completeness gate to gallery adds (0 images + mockup screens -> 422)', async () => {
    stubBlobs({ pointer: { mode: 'demo', snapshotIds: [] }, known: [NEW_ID], withImages: false });
    // Manifest claims mockup screens but the snapshot has no image blobs.
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ id: NEW_ID, mockupScreenCount: 3, imageCount: 0 }),
      text: async () => '',
    })));

    const res = mockRes();
    await handler({ method: 'PUT', query: { gallery: '1', id: NEW_ID }, headers: {} }, res);

    expect(res.statusCode).toBe(422);
    expect(parsed(res).error).toBe('demo_snapshot_incomplete');
    expect(putPointerBody()).toBeNull();
  });

  it('removes a snapshot and shifts later slots down', async () => {
    stubBlobs({ pointer: { mode: 'gallery', snapshotIds: SNAP_IDS }, known: SNAP_IDS });

    const res = mockRes();
    await handler({ method: 'PUT', query: { gallery: '1', id: SNAP_IDS[1], remove: '1' }, headers: {} }, res);

    expect(res.statusCode).toBe(200);
    expect(parsed(res).snapshotIds).toEqual([SNAP_IDS[0], ...SNAP_IDS.slice(2)]);
  });
});

describe('PUT /api/snapshots?gallery=1&mode= — the go-live switch', () => {
  it('refuses to flip to gallery mode while slots are unfilled (422 gallery_not_ready)', async () => {
    stubBlobs({ pointer: { mode: 'demo', snapshotIds: SNAP_IDS.slice(0, 4) }, known: SNAP_IDS });

    const res = mockRes();
    await handler({ method: 'PUT', query: { gallery: '1', mode: 'gallery' }, headers: {} }, res);

    expect(res.statusCode).toBe(422);
    expect(parsed(res).error).toBe('gallery_not_ready');
    expect(parsed(res).message).toMatch(/4\/6/);
    expect(putPointerBody()).toBeNull();
  });

  it('refuses to go live when a pinned snapshot no longer exists', async () => {
    // All six ids pinned, but the last one's blobs are gone.
    stubBlobs({ pointer: { mode: 'demo', snapshotIds: SNAP_IDS }, known: SNAP_IDS.slice(0, 5) });

    const res = mockRes();
    await handler({ method: 'PUT', query: { gallery: '1', mode: 'gallery' }, headers: {} }, res);

    expect(res.statusCode).toBe(422);
    expect(parsed(res).error).toBe('gallery_not_ready');
  });

  it('goes live once all six slots hold existing snapshots', async () => {
    stubBlobs({ pointer: { mode: 'demo', snapshotIds: SNAP_IDS }, known: SNAP_IDS });

    const res = mockRes();
    await handler({ method: 'PUT', query: { gallery: '1', mode: 'gallery' }, headers: {} }, res);

    expect(res.statusCode).toBe(200);
    expect(parsed(res).mode).toBe('gallery');
    expect(putPointerBody()?.mode).toBe('gallery');
  });

  it('flips back to demo mode without any readiness requirement', async () => {
    stubBlobs({ pointer: { mode: 'gallery', snapshotIds: SNAP_IDS.slice(0, 3) }, known: SNAP_IDS });

    const res = mockRes();
    await handler({ method: 'PUT', query: { gallery: '1', mode: 'demo' }, headers: {} }, res);

    expect(res.statusCode).toBe(200);
    expect(parsed(res).mode).toBe('demo');
  });
});

describe('GET /api/snapshots?gallery=1 — public reads', () => {
  it('is public: serves the pointer without owner auth', async () => {
    // requireOwner returning true means "unauthorized, response already sent";
    // the public gallery GET must never even consult it.
    requireOwner.mockReturnValue(true);
    stubBlobs({ pointer: { mode: 'gallery', snapshotIds: SNAP_IDS }, known: SNAP_IDS });

    const res = mockRes();
    await handler({ method: 'GET', query: { gallery: '1', pointer: '1' }, headers: {} }, res);

    expect(res.statusCode).toBe(200);
    expect(parsed(res)).toMatchObject({ mode: 'gallery', snapshotIds: SNAP_IDS, size: 6 });
    expect(requireOwner).not.toHaveBeenCalled();
  });

  it('defaults to demo mode when no gallery pointer exists', async () => {
    stubBlobs({ pointer: null });

    const res = mockRes();
    await handler({ method: 'GET', query: { gallery: '1', pointer: '1' }, headers: {} }, res);

    expect(res.statusCode).toBe(200);
    expect(parsed(res)).toMatchObject({ mode: 'demo', snapshotIds: [] });
  });

  it('404s an empty gallery slot', async () => {
    stubBlobs({ pointer: { mode: 'gallery', snapshotIds: SNAP_IDS.slice(0, 2) }, known: SNAP_IDS });

    const res = mockRes();
    await handler({ method: 'GET', query: { gallery: '1', slot: '4' }, headers: {} }, res);

    expect(res.statusCode).toBe(404);
    expect(parsed(res).error).toBe('no_gallery_slot');
  });

  it('serves a filled slot by resolving its snapshot id', async () => {
    stubBlobs({ pointer: { mode: 'gallery', snapshotIds: SNAP_IDS }, known: SNAP_IDS });

    const res = mockRes();
    await handler({ method: 'GET', query: { gallery: '1', slot: '0' }, headers: {} }, res);

    expect(res.statusCode).toBe(200);
  });
});
