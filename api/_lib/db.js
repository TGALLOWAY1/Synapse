import { MongoClient } from 'mongodb';

const DEFAULT_DB_NAME = 'synapse';

// The recruiter-portal backend used to talk to the MongoDB Atlas *Data API*
// (a REST gateway). MongoDB retired the Data API on 2025-09-30, so that
// transport no longer exists and every auth/session/provider-key write was
// failing. We now use the official MongoDB Node driver directly while keeping
// the exact `runMongoAction(action, payload)` call signature and Data-API-shaped
// return values, so every existing call site (users.js, providerKeys.js,
// session rows, activity, admin dashboard) keeps working unchanged.

// Cache the connecting client on the module/global scope so warm serverless
// invocations reuse one connection pool instead of opening a new one per
// request (the standard Vercel + MongoDB pattern).
let clientPromise = globalThis.__synapseMongoClientPromise || null;

function getUri() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error(
      'Missing MongoDB configuration. Set MONGODB_URI to your Atlas connection string ' +
        '(mongodb+srv://…). The retired MONGODB_DATA_API_* variables are no longer used.',
    );
  }
  return uri;
}

async function getDb() {
  if (!clientPromise) {
    const client = new MongoClient(getUri(), {
      // Serverless functions are short-lived and concurrency-capped; a small
      // pool avoids exhausting Atlas connections under burst traffic.
      maxPoolSize: 5,
    });
    clientPromise = client.connect();
    globalThis.__synapseMongoClientPromise = clientPromise;
  }
  const client = await clientPromise;
  return client.db(process.env.MONGODB_DB_NAME || DEFAULT_DB_NAME);
}

/**
 * Compatibility shim preserving the old Atlas Data API surface
 * (`runMongoAction(action, payload)`) on top of the official MongoDB driver.
 *
 * Supported actions and their Data-API-compatible return shapes:
 *   - findOne   → { document }
 *   - find      → { documents }
 *   - insertOne → { insertedId }
 *   - updateOne → { matchedCount, modifiedCount, upsertedId }
 *   - deleteOne → { deletedCount }
 *   - aggregate → { documents }
 *   - createIndexes → { ok: true } (idempotent; payload.indexes is a list of
 *                      driver index specs: { key, ...options })
 */
export async function runMongoAction(action, payload = {}) {
  const collectionName = payload.collection;
  if (!collectionName) {
    throw new Error(`runMongoAction(${action}): missing "collection".`);
  }

  const db = await getDb();
  const collection = db.collection(collectionName);

  switch (action) {
    case 'findOne': {
      const document = await collection.findOne(payload.filter || {}, {
        projection: payload.projection,
      });
      return { document: document || null };
    }
    case 'find': {
      let cursor = collection.find(payload.filter || {}, {
        projection: payload.projection,
      });
      if (payload.sort) cursor = cursor.sort(payload.sort);
      if (typeof payload.skip === 'number') cursor = cursor.skip(payload.skip);
      if (typeof payload.limit === 'number') cursor = cursor.limit(payload.limit);
      const documents = await cursor.toArray();
      return { documents };
    }
    case 'insertOne': {
      const result = await collection.insertOne(payload.document);
      return { insertedId: result.insertedId };
    }
    case 'updateOne': {
      const result = await collection.updateOne(payload.filter || {}, payload.update, {
        upsert: Boolean(payload.upsert),
      });
      return {
        matchedCount: result.matchedCount,
        modifiedCount: result.modifiedCount,
        upsertedId: result.upsertedId || null,
      };
    }
    case 'deleteOne': {
      const result = await collection.deleteOne(payload.filter || {});
      return { deletedCount: result.deletedCount };
    }
    case 'aggregate': {
      const documents = await collection.aggregate(payload.pipeline || []).toArray();
      return { documents };
    }
    case 'createIndexes': {
      // Idempotent: createIndex is a no-op when an identical index already
      // exists, so callers can run this lazily on every warm instance.
      const indexes = Array.isArray(payload.indexes) ? payload.indexes : [];
      for (const spec of indexes) {
        const { key, ...options } = spec;
        await collection.createIndex(key, options);
      }
      return { ok: true };
    }
    default:
      throw new Error(`runMongoAction: unsupported action "${action}".`);
  }
}
