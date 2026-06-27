import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Unit tests for the account-linking identity logic (R3): one human → one stable
// userId across sign-in methods. The DB layer is mocked; we assert which
// account a sign-in resolves to and the shape of the writes.

const runMongoAction = vi.fn();
vi.mock('../db.js', () => ({ runMongoAction: (...a) => runMongoAction(...a) }));

let users;

beforeEach(async () => {
  vi.resetModules();
  runMongoAction.mockReset();
  users = await import('../users.js');
});

afterEach(() => vi.restoreAllMocks());

const findOneResult = (doc) => ({ document: doc });

describe('upsertOAuthUser — auto-link by verified email', () => {
  it('reuses the existing verified account userId instead of minting a new one', async () => {
    const existingLinkedIn = {
      userId: 'acct-1',
      authProvider: 'linkedin',
      providerUserId: 'li-1',
      email: 'same@example.com',
      emailVerified: true,
    };
    runMongoAction
      .mockResolvedValueOnce(findOneResult(null)) // findUserByProviderIdentity(github, gh-1)
      .mockResolvedValueOnce(findOneResult(existingLinkedIn)) // findAnyUserByEmail
      .mockResolvedValueOnce({ matchedCount: 1 }); // attach updateOne

    const result = await users.upsertOAuthUser({
      authProvider: 'github',
      providerUserId: 'gh-1',
      email: 'same@example.com',
      name: 'Same Person',
    });

    expect(result.userId).toBe('acct-1'); // SAME account, not a new userId
    expect(result.authProvider).toBe('github'); // active provider reflects this sign-in

    const update = runMongoAction.mock.calls.find(([a]) => a === 'updateOne')[1];
    expect(update.filter).toEqual({ userId: 'acct-1' });
    expect(update.update.$addToSet.linkedIdentities).toMatchObject({
      authProvider: 'github',
      providerUserId: 'gh-1',
    });
  });

  it('refuses to auto-link into an UNVERIFIED account (takeover guard)', async () => {
    const unverifiedEmailAcct = {
      userId: 'acct-pw',
      authProvider: 'email',
      providerUserId: 'same@example.com',
      email: 'same@example.com',
      emailVerified: false,
    };
    runMongoAction
      .mockResolvedValueOnce(findOneResult(null)) // findUserByProviderIdentity
      .mockResolvedValueOnce(findOneResult(unverifiedEmailAcct)); // findAnyUserByEmail

    await expect(
      users.upsertOAuthUser({ authProvider: 'github', providerUserId: 'gh-9', email: 'same@example.com', name: 'X' }),
    ).rejects.toThrow();
  });
});

describe('upsertOAuthUser — sign-in via an already-linked identity', () => {
  it('resolves to the canonical account without creating a second doc', async () => {
    const canonical = {
      userId: 'acct-1',
      authProvider: 'linkedin',
      providerUserId: 'li-1',
      linkedIdentities: [{ authProvider: 'github', providerUserId: 'gh-1', email: 'same@example.com' }],
    };
    runMongoAction
      .mockResolvedValueOnce(findOneResult(canonical)) // findUserByProviderIdentity(github, gh-1) → canonical
      .mockResolvedValueOnce({ matchedCount: 1 }); // touchLinkedSignIn updateOne

    const result = await users.upsertOAuthUser({ authProvider: 'github', providerUserId: 'gh-1', name: 'X' });

    expect(result.userId).toBe('acct-1');
    expect(result.authProvider).toBe('github');
    // Only a touch-by-userId update — never an upsert that would fork a new doc.
    const updates = runMongoAction.mock.calls.filter(([a]) => a === 'updateOne');
    expect(updates).toHaveLength(1);
    expect(updates[0][1].filter).toEqual({ userId: 'acct-1' });
    expect(updates[0][1].upsert).toBeFalsy();
  });
});

describe('linkProviderIdentity — explicit linking while signed in', () => {
  it('attaches a brand-new identity to the current account', async () => {
    const account = { userId: 'acct-1', authProvider: 'email', providerUserId: 'a@x.com', email: 'a@x.com' };
    runMongoAction
      .mockResolvedValueOnce(findOneResult(null)) // findUserByProviderIdentity(github, gh-2) → unowned
      .mockResolvedValueOnce({ matchedCount: 1 }); // attach updateOne

    const result = await users.linkProviderIdentity(account, {
      authProvider: 'github',
      providerUserId: 'gh-2',
      email: 'a@x.com',
    });

    expect(result.userId).toBe('acct-1');
    const update = runMongoAction.mock.calls.find(([a]) => a === 'updateOne')[1];
    expect(update.filter).toEqual({ userId: 'acct-1' });
    expect(update.update.$addToSet.linkedIdentities).toMatchObject({ authProvider: 'github', providerUserId: 'gh-2' });
  });

  it('non-destructively merges another account that already owns the identity', async () => {
    const survivor = { userId: 'acct-1', authProvider: 'email', providerUserId: 'a@x.com', email: 'a@x.com' };
    const absorbed = { userId: 'acct-2', authProvider: 'github', providerUserId: 'gh-3', email: 'b@y.com' };
    runMongoAction
      .mockResolvedValueOnce(findOneResult(absorbed)) // findUserByProviderIdentity(github, gh-3) → absorbed
      .mockResolvedValueOnce({ matchedCount: 1 }) // survivor updateOne
      .mockResolvedValueOnce({ matchedCount: 1 }); // absorbed tombstone updateOne

    const result = await users.linkProviderIdentity(survivor, {
      authProvider: 'github',
      providerUserId: 'gh-3',
      email: 'b@y.com',
    });

    expect(result.userId).toBe('acct-1');
    expect(result.mergedUserIds).toContain('acct-2');

    const updates = runMongoAction.mock.calls.filter(([a]) => a === 'updateOne');
    expect(updates).toHaveLength(2);
    // Survivor gets the absorbed identity + mergedUserIds.
    const survivorUpdate = updates.find(([, p]) => p.filter.userId === 'acct-1')[1];
    expect(survivorUpdate.update.$addToSet.mergedUserIds).toBe('acct-2');
    // Absorbed is tombstoned, not deleted.
    const tombstone = updates.find(([, p]) => p.filter.userId === 'acct-2')[1];
    expect(tombstone.update.$set.mergedInto).toBe('acct-1');
  });
});

describe('toPublicUser — linking surface', () => {
  it('exposes linkedProviders and mergedUserIds', () => {
    const pub = users.toPublicUser({
      userId: 'acct-1',
      authProvider: 'linkedin',
      email: 'a@x.com',
      linkedIdentities: [{ authProvider: 'github', email: 'a@x.com' }],
      mergedUserIds: ['acct-2'],
    });
    expect(pub.linkedProviders.map((p) => p.authProvider).sort()).toEqual(['github', 'linkedin']);
    expect(pub.mergedUserIds).toEqual(['acct-2']);
  });
});
