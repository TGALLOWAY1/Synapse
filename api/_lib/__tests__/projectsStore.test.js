import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the Mongo shim so we can assert that every projectsStore function pins
// the owner's userId into the filter (the RLS-equivalent guarantee) and maps
// onto the right action.
const runMongoAction = vi.fn();
vi.mock('../db.js', () => ({ runMongoAction: (...a) => runMongoAction(...a) }));

let store;

const bundle = (overrides = {}) => ({
  project: { id: 'p1', name: 'My Project', createdAt: 1000, ...overrides.project },
  spineVersions: [
    { id: 'v1', isLatest: true, promptText: 'Build a todo app', ...overrides.spine },
  ],
  historyEvents: [],
  branches: [],
  artifacts: [],
  artifactVersions: [],
  feedbackItems: [],
  tasks: [],
  workflowRuns: [],
});

beforeEach(async () => {
  vi.resetModules();
  runMongoAction.mockReset();
  // ensureProjectIndexes resolves on createIndexes; default every call to a
  // benign empty shape so functions under test proceed.
  runMongoAction.mockResolvedValue({});
  store = await import('../projectsStore.js');
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('isValidProjectId', () => {
  it('accepts uuid-ish ids and rejects garbage', () => {
    expect(store.isValidProjectId('3f2504e0-4f89-41d3-9a0c-0305e82c3301')).toBe(true);
    expect(store.isValidProjectId('demo-project')).toBe(true);
    expect(store.isValidProjectId('')).toBe(false);
    expect(store.isValidProjectId('has space')).toBe(false);
    expect(store.isValidProjectId('a/../b')).toBe(false);
    expect(store.isValidProjectId(null)).toBe(false);
  });
});

describe('listProjects', () => {
  it('scopes the query to the owner and excludes deleted/archived by default', async () => {
    runMongoAction.mockImplementation(async (action) => {
      if (action === 'find') return { documents: [{ id: 'p1', title: 'X' }] };
      return {};
    });
    const out = await store.listProjects('user-a');
    expect(out).toEqual([{ id: 'p1', title: 'X' }]);
    const findCall = runMongoAction.mock.calls.find(([a]) => a === 'find');
    expect(findCall[1].filter).toEqual({ userId: 'user-a', deletedAt: null, status: 'active' });
    expect(findCall[1].sort).toEqual({ updatedAt: -1 });
    // Heavy bundle must not be projected into a list view.
    expect(findCall[1].projection.data).toBeUndefined();
  });

  it('includes archived and deleted when asked', async () => {
    runMongoAction.mockImplementation(async (action) => (action === 'find' ? { documents: [] } : {}));
    await store.listProjects('user-a', { includeArchived: true, includeDeleted: true });
    const findCall = runMongoAction.mock.calls.find(([a]) => a === 'find');
    expect(findCall[1].filter).toEqual({ userId: 'user-a' });
  });
});

describe('getProject', () => {
  it('filters by userId AND id so User A cannot read User B', async () => {
    runMongoAction.mockImplementation(async (action) =>
      action === 'findOne' ? { document: { id: 'p1', userId: 'user-a' } } : {},
    );
    const out = await store.getProject('user-a', 'p1');
    expect(out).toEqual({ id: 'p1', userId: 'user-a' });
    const findOne = runMongoAction.mock.calls.find(([a]) => a === 'findOne');
    expect(findOne[1].filter).toEqual({ userId: 'user-a', id: 'p1' });
  });

  it('returns null for an invalid id without hitting the db', async () => {
    const out = await store.getProject('user-a', 'bad id');
    expect(out).toBeNull();
    expect(runMongoAction).not.toHaveBeenCalledWith('findOne', expect.anything());
  });
});

describe('upsertProject', () => {
  it('upserts owner-scoped, denormalizes title/idea, and bumps revision', async () => {
    runMongoAction.mockImplementation(async (action) =>
      action === 'updateOne' ? { matchedCount: 0, upsertedId: { _id: 'x' } } : {},
    );
    const saved = await store.upsertProject('user-a', 'p1', bundle());
    expect(saved).toMatchObject({ id: 'p1', title: 'My Project', idea: 'Build a todo app', created: true });

    const update = runMongoAction.mock.calls.find(([a]) => a === 'updateOne')[1];
    expect(update.upsert).toBe(true);
    expect(update.filter).toEqual({ userId: 'user-a', id: 'p1' });
    expect(update.update.$set.userId).toBe('user-a');
    expect(update.update.$set.data).toBeTruthy();
    expect(update.update.$inc).toEqual({ revision: 1 });
    expect(update.update.$setOnInsert.createdAt).toBeInstanceOf(Date);
  });

  it('rejects an invalid project id', async () => {
    await expect(store.upsertProject('user-a', 'bad id', bundle())).rejects.toThrow(/invalid/);
  });

  it('returns the new revision derived from the prior one', async () => {
    runMongoAction.mockImplementation(async (action) => {
      if (action === 'findOne') return { document: { revision: 5 } };
      if (action === 'updateOne') return { matchedCount: 1 };
      return {};
    });
    const saved = await store.upsertProject('user-a', 'p1', bundle());
    expect(saved.revision).toBe(6);
    expect(saved.conflict).toBeUndefined();
  });

  it('writes when expectedRevision matches the stored revision', async () => {
    runMongoAction.mockImplementation(async (action) => {
      if (action === 'findOne') return { document: { revision: 5 } };
      if (action === 'updateOne') return { matchedCount: 1 };
      return {};
    });
    const saved = await store.upsertProject('user-a', 'p1', bundle(), { expectedRevision: 5 });
    expect(saved.revision).toBe(6);
    // The conditional write did proceed.
    expect(runMongoAction.mock.calls.some(([a]) => a === 'updateOne')).toBe(true);
  });

  it('blocks a stale write (expectedRevision mismatch) without overwriting', async () => {
    runMongoAction.mockImplementation(async (action) => {
      if (action === 'findOne') return { document: { revision: 7 } };
      if (action === 'updateOne') return { matchedCount: 1 };
      return {};
    });
    const result = await store.upsertProject('user-a', 'p1', bundle(), { expectedRevision: 5 });
    expect(result).toMatchObject({ conflict: true, currentRevision: 7, id: 'p1' });
    // Crucially, no write happened — the newer server copy is preserved.
    expect(runMongoAction.mock.calls.some(([a]) => a === 'updateOne')).toBe(false);
  });

  it('ignores expectedRevision for a brand-new project (no existing row)', async () => {
    runMongoAction.mockImplementation(async (action) => {
      if (action === 'findOne') return {}; // no existing doc
      if (action === 'updateOne') return { matchedCount: 0, upsertedId: { _id: 'x' } };
      return {};
    });
    const saved = await store.upsertProject('user-a', 'p1', bundle(), { expectedRevision: 3 });
    expect(saved.conflict).toBeUndefined();
    expect(saved.created).toBe(true);
    expect(saved.revision).toBe(1);
  });
});

describe('soft delete / restore / archive', () => {
  it('softDeleteProject sets a tombstone, owner-scoped', async () => {
    runMongoAction.mockImplementation(async (action) => (action === 'updateOne' ? { matchedCount: 1 } : {}));
    const ok = await store.softDeleteProject('user-a', 'p1');
    expect(ok).toBe(true);
    const update = runMongoAction.mock.calls.find(([a]) => a === 'updateOne')[1];
    expect(update.filter).toEqual({ userId: 'user-a', id: 'p1' });
    expect(update.update.$set.deletedAt).toBeInstanceOf(Date);
  });

  it('restoreProject clears the tombstone', async () => {
    runMongoAction.mockImplementation(async (action) => (action === 'updateOne' ? { matchedCount: 1 } : {}));
    const ok = await store.restoreProject('user-a', 'p1');
    expect(ok).toBe(true);
    const update = runMongoAction.mock.calls.find(([a]) => a === 'updateOne')[1];
    expect(update.update.$set.deletedAt).toBeNull();
    expect(update.update.$set.status).toBe('active');
  });

  it('softDeleteProject returns false when nothing matched', async () => {
    runMongoAction.mockImplementation(async (action) => (action === 'updateOne' ? { matchedCount: 0 } : {}));
    expect(await store.softDeleteProject('user-a', 'p1')).toBe(false);
  });
});

describe('importProjects', () => {
  it('upserts each bundle idempotently and reports invalid ids without throwing', async () => {
    runMongoAction.mockImplementation(async (action) =>
      action === 'updateOne' ? { matchedCount: 1, upsertedId: null } : {},
    );
    const result = await store.importProjects('user-a', [
      bundle({ project: { id: 'p1', name: 'A', createdAt: 1 } }),
      { project: { id: 'bad id', name: 'B' } },
    ]);
    expect(result.imported).toEqual([{ id: 'p1', created: false }]);
    expect(result.failed).toEqual([{ id: 'bad id', error: 'invalid_id' }]);
  });
});
