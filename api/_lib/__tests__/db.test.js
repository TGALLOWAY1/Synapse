import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the MongoDB driver so we can assert that runMongoAction maps each
// "action" onto the right driver call and reshapes the result to match the
// old Atlas Data API response envelope every call site depends on.
const { collection, db, connect } = vi.hoisted(() => {
  const collection = {
    findOne: vi.fn(),
    find: vi.fn(),
    insertOne: vi.fn(),
    updateOne: vi.fn(),
    deleteOne: vi.fn(),
    aggregate: vi.fn(),
  };
  const db = { collection: vi.fn(() => collection) };
  const connect = vi.fn(async () => ({ db: () => db }));
  return { collection, db, connect };
});

vi.mock('mongodb', () => ({
  // A plain function is constructable (arrow functions are not), so
  // `new MongoClient(...)` in db.js returns our stub client.
  MongoClient: function MongoClient() {
    return { connect };
  },
}));

function makeCursor(docs) {
  const cursor = {
    sort: vi.fn(() => cursor),
    skip: vi.fn(() => cursor),
    limit: vi.fn(() => cursor),
    toArray: vi.fn(async () => docs),
  };
  return cursor;
}

let runMongoAction;

beforeEach(async () => {
  vi.resetModules();
  process.env.MONGODB_URI = 'mongodb+srv://example';
  // Reset the cached client promise that db.js stashes on globalThis.
  delete globalThis.__synapseMongoClientPromise;
  Object.values(collection).forEach((fn) => fn.mockReset());
  db.collection.mockClear();
  connect.mockClear();
  ({ runMongoAction } = await import('../db.js'));
});

afterEach(() => {
  delete process.env.MONGODB_URI;
});

describe('runMongoAction', () => {
  it('throws a clear error when MONGODB_URI is unset', async () => {
    delete process.env.MONGODB_URI;
    delete globalThis.__synapseMongoClientPromise;
    vi.resetModules();
    const mod = await import('../db.js');
    await expect(mod.runMongoAction('findOne', { collection: 'c', filter: {} })).rejects.toThrow(
      /MONGODB_URI/,
    );
  });

  it('requires a collection', async () => {
    await expect(runMongoAction('findOne', {})).rejects.toThrow(/collection/);
  });

  it('findOne returns { document } and forwards projection', async () => {
    collection.findOne.mockResolvedValue({ userId: 'u1' });
    const res = await runMongoAction('findOne', {
      collection: 'recruiters',
      filter: { userId: 'u1' },
      projection: { _id: 0 },
    });
    expect(res).toEqual({ document: { userId: 'u1' } });
    expect(collection.findOne).toHaveBeenCalledWith({ userId: 'u1' }, { projection: { _id: 0 } });
  });

  it('findOne returns { document: null } when nothing matches', async () => {
    collection.findOne.mockResolvedValue(null);
    const res = await runMongoAction('findOne', { collection: 'recruiters', filter: {} });
    expect(res).toEqual({ document: null });
  });

  it('find returns { documents } and applies sort/skip/limit', async () => {
    const cursor = makeCursor([{ a: 1 }, { a: 2 }]);
    collection.find.mockReturnValue(cursor);
    const res = await runMongoAction('find', {
      collection: 'provider_keys',
      filter: { userId: 'u1' },
      sort: { a: -1 },
      skip: 5,
      limit: 10,
    });
    expect(res).toEqual({ documents: [{ a: 1 }, { a: 2 }] });
    expect(cursor.sort).toHaveBeenCalledWith({ a: -1 });
    expect(cursor.skip).toHaveBeenCalledWith(5);
    expect(cursor.limit).toHaveBeenCalledWith(10);
  });

  it('insertOne returns { insertedId }', async () => {
    collection.insertOne.mockResolvedValue({ insertedId: 'abc' });
    const res = await runMongoAction('insertOne', {
      collection: 'recruiters',
      document: { userId: 'u1' },
    });
    expect(res).toEqual({ insertedId: 'abc' });
    expect(collection.insertOne).toHaveBeenCalledWith({ userId: 'u1' });
  });

  it('updateOne returns counts + upsertedId and forwards upsert', async () => {
    collection.updateOne.mockResolvedValue({
      matchedCount: 0,
      modifiedCount: 0,
      upsertedId: { _id: 'new' },
    });
    const res = await runMongoAction('updateOne', {
      collection: 'recruiters',
      filter: { userId: 'u1' },
      update: { $set: { name: 'A' } },
      upsert: true,
    });
    expect(res).toEqual({ matchedCount: 0, modifiedCount: 0, upsertedId: { _id: 'new' } });
    expect(collection.updateOne).toHaveBeenCalledWith(
      { userId: 'u1' },
      { $set: { name: 'A' } },
      { upsert: true },
    );
  });

  it('deleteOne returns { deletedCount }', async () => {
    collection.deleteOne.mockResolvedValue({ deletedCount: 1 });
    const res = await runMongoAction('deleteOne', {
      collection: 'provider_keys',
      filter: { userId: 'u1', provider: 'gemini' },
    });
    expect(res).toEqual({ deletedCount: 1 });
  });

  it('aggregate returns { documents }', async () => {
    const cursor = makeCursor([{ name: 'A' }]);
    collection.aggregate.mockReturnValue(cursor);
    const res = await runMongoAction('aggregate', {
      collection: 'recruiters',
      pipeline: [{ $match: {} }],
    });
    expect(res).toEqual({ documents: [{ name: 'A' }] });
    expect(collection.aggregate).toHaveBeenCalledWith([{ $match: {} }]);
  });

  it('rejects an unsupported action', async () => {
    await expect(runMongoAction('replaceOne', { collection: 'c' })).rejects.toThrow(/unsupported/);
  });
});
