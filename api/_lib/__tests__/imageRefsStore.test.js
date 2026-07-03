import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the Mongo shim so we can assert every imageRefsStore function pins the
// owner's userId into the filter (the RLS-equivalent guarantee) and that the
// refcount-aware GC only orphans blobs with zero remaining refs.
const runMongoAction = vi.fn();
vi.mock('../db.js', () => ({ runMongoAction: (...a) => runMongoAction(...a) }));

let store;

const validRef = (overrides = {}) => ({
  key: 'v1:s1:low',
  hash: 'a'.repeat(64),
  blobUrl: 'https://blob/users/user-a/mockup-images/x.png',
  byteSize: 100,
  kind: 'mockup',
  versionId: 'v1',
  screenId: 's1',
  quality: 'low',
  meta: { prompt: 'x' },
  ...overrides,
});

beforeEach(async () => {
  vi.resetModules();
  runMongoAction.mockReset();
  runMongoAction.mockResolvedValue({});
  store = await import('../imageRefsStore.js');
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('validators', () => {
  it('isValidImageKey bounds the key', () => {
    expect(store.isValidImageKey('v1:s1:low')).toBe(true);
    expect(store.isValidImageKey('')).toBe(false);
    expect(store.isValidImageKey('x'.repeat(513))).toBe(false);
    expect(store.isValidImageKey(null)).toBe(false);
  });

  it('isValidHash requires a 64-char hex digest', () => {
    expect(store.isValidHash('a'.repeat(64))).toBe(true);
    expect(store.isValidHash('A'.repeat(64))).toBe(false); // lowercase only
    expect(store.isValidHash('abc')).toBe(false);
  });

  it('isValidRef requires key, hash and a blobUrl', () => {
    expect(store.isValidRef(validRef())).toBe(true);
    expect(store.isValidRef(validRef({ hash: 'short' }))).toBe(false);
    expect(store.isValidRef(validRef({ blobUrl: '' }))).toBe(false);
    expect(store.isValidRef(null)).toBe(false);
  });
});

describe('listImageRefs', () => {
  it('scopes the query to the owner + project', async () => {
    runMongoAction.mockImplementation(async (action) =>
      action === 'find' ? { documents: [{ key: 'k1' }] } : {},
    );
    const out = await store.listImageRefs('user-a', 'p1');
    expect(out).toEqual([{ key: 'k1' }]);
    const find = runMongoAction.mock.calls.find(([a]) => a === 'find')[1];
    expect(find.filter).toEqual({ userId: 'user-a', projectId: 'p1' });
    // Never leak the owner id back to the client.
    expect(find.projection.userId).toBe(0);
  });
});

describe('upsertImageRef', () => {
  it('pins userId+projectId+key and upserts the sanitized ref', async () => {
    runMongoAction.mockImplementation(async (action) =>
      action === 'updateOne' ? { upsertedId: { _id: 'x' } } : {},
    );
    const saved = await store.upsertImageRef('user-a', 'p1', validRef());
    expect(saved).toMatchObject({ projectId: 'p1', key: 'v1:s1:low', kind: 'mockup' });
    const update = runMongoAction.mock.calls.find(([a]) => a === 'updateOne')[1];
    expect(update.upsert).toBe(true);
    expect(update.filter).toEqual({ userId: 'user-a', projectId: 'p1', key: 'v1:s1:low' });
    expect(update.update.$set.userId).toBe('user-a');
    // dataUrl can never sneak in via meta-less top-level fields.
    expect(update.update.$set.dataUrl).toBeUndefined();
  });

  it('rejects an invalid ref', async () => {
    await expect(store.upsertImageRef('user-a', 'p1', { key: 'k' })).rejects.toThrow(/invalid ref/);
  });
});

describe('findOrphanedHashes (refcount policy)', () => {
  it('orphans only hashes whose remaining count is zero', async () => {
    const hDead = 'd'.repeat(64);
    const hLive = 'e'.repeat(64);
    const lookup = async (hash) => (hash === hDead ? 0 : 2);
    const out = await store.findOrphanedHashes('user-a', [hDead, hLive, hDead], lookup);
    expect(out).toEqual([hDead]);
  });

  it('ignores malformed hashes (never queries / deletes for them)', async () => {
    const lookup = vi.fn(async () => 0);
    const out = await store.findOrphanedHashes('user-a', ['not-a-hash'], lookup);
    expect(out).toEqual([]);
    expect(lookup).not.toHaveBeenCalled();
  });
});

describe('deleteImageRefs (refcount-aware GC)', () => {
  it('deletes owner-scoped refs and orphans only blobs with no remaining refs', async () => {
    const h1 = '1'.repeat(64);
    const h2 = '2'.repeat(64);
    runMongoAction.mockImplementation(async (action, payload) => {
      if (action === 'find') {
        if (payload.filter.key && payload.filter.key.$in) {
          return {
            documents: [
              { key: 'k1', hash: h1, blobUrl: 'url1' },
              { key: 'k2', hash: h2, blobUrl: 'url2' },
            ],
          };
        }
        // refcount lookups: h1 has none remaining, h2 still referenced.
        if (payload.filter.hash === h1) return { documents: [] };
        if (payload.filter.hash === h2) return { documents: [{ key: 'kx' }] };
        return { documents: [] };
      }
      if (action === 'deleteMany') return { deletedCount: 2 };
      return {};
    });

    const out = await store.deleteImageRefs('user-a', 'p1', ['k1', 'k2']);
    expect(out.deletedCount).toBe(2);
    expect(out.orphanedBlobUrls).toEqual(['url1']); // url2 retained (h2 still referenced)

    const del = runMongoAction.mock.calls.find(([a]) => a === 'deleteMany')[1];
    expect(del.filter.userId).toBe('user-a');
    expect(del.filter.projectId).toBe('p1');
  });

  it('no-ops (no delete, no orphans) when no keys match', async () => {
    runMongoAction.mockImplementation(async (action) =>
      action === 'find' ? { documents: [] } : {},
    );
    const out = await store.deleteImageRefs('user-a', 'p1', ['nope']);
    expect(out).toEqual({ deletedCount: 0, orphanedBlobUrls: [] });
    expect(runMongoAction).not.toHaveBeenCalledWith('deleteMany', expect.anything());
  });
});

describe('deleteRefsForProject', () => {
  it('deletes every ref for the project, owner-scoped', async () => {
    const h1 = '1'.repeat(64);
    runMongoAction.mockImplementation(async (action, payload) => {
      if (action === 'find') {
        if (!payload.filter.hash) return { documents: [{ key: 'k1', hash: h1, blobUrl: 'url1' }] };
        return { documents: [] }; // h1 has no remaining refs
      }
      if (action === 'deleteMany') return { deletedCount: 1 };
      return {};
    });
    const out = await store.deleteRefsForProject('user-a', 'p1');
    expect(out.deletedCount).toBe(1);
    expect(out.orphanedBlobUrls).toEqual(['url1']);
    const del = runMongoAction.mock.calls.find(([a]) => a === 'deleteMany')[1];
    expect(del.filter).toEqual({ userId: 'user-a', projectId: 'p1' });
  });
});
