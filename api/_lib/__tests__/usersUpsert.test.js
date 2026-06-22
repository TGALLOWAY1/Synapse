import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Regression guard for the OAuth upsert. The mongodb server rejects an update
// that touches the same field path in two operators (code 40,
// "would create a conflict"). upsertOAuthUser previously seeded loginCount in
// BOTH $setOnInsert and $inc, which blew up every OAuth sign-in once a live DB
// was actually reachable. Assert the update never reintroduces that conflict.

const runMongoAction = vi.fn();
vi.mock('../db.js', () => ({ runMongoAction: (...a) => runMongoAction(...a) }));

let upsertOAuthUser;

beforeEach(async () => {
  vi.resetModules();
  runMongoAction.mockReset();
  ({ upsertOAuthUser } = await import('../users.js'));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('upsertOAuthUser update shape', () => {
  it('does not reference loginCount in more than one update operator', async () => {
    // findUserByProvider (no existing user) then the updateOne upsert.
    runMongoAction.mockResolvedValueOnce({ document: null }); // findUserByProvider
    runMongoAction.mockResolvedValueOnce({ document: null }); // findAnyUserByEmail
    runMongoAction.mockResolvedValueOnce({ matchedCount: 0, modifiedCount: 0, upsertedId: { _id: 'x' } });

    await upsertOAuthUser({
      authProvider: 'github',
      providerUserId: '12345',
      email: 'new@example.com',
      name: 'New User',
    });

    const updateCall = runMongoAction.mock.calls.find(([action]) => action === 'updateOne');
    expect(updateCall).toBeTruthy();
    const [, payload] = updateCall;
    const { update } = payload;

    // loginCount may appear in $inc, but must NOT also be in $setOnInsert/$set.
    const inInc = update.$inc && 'loginCount' in update.$inc;
    const inSetOnInsert = update.$setOnInsert && 'loginCount' in update.$setOnInsert;
    const inSet = update.$set && 'loginCount' in update.$set;

    expect(inInc).toBe(true);
    expect(inSetOnInsert).toBe(false);
    expect(inSet).toBe(false);

    // Collect every field path across all operators — no path may repeat.
    const paths = [];
    for (const op of ['$set', '$setOnInsert', '$inc']) {
      if (update[op]) paths.push(...Object.keys(update[op]));
    }
    const dupes = paths.filter((p, i) => paths.indexOf(p) !== i);
    expect(dupes).toEqual([]);
  });
});
