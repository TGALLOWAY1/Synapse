import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  createLinkIntentToken,
  verifyLinkIntentToken,
} from '../linkState.js';

beforeEach(() => {
  process.env.SESSION_SECRET = 'test-secret-for-link-state';
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('link-intent token', () => {
  it('round-trips a valid token', () => {
    const token = createLinkIntentToken({ userId: 'acct-1', provider: 'github' });
    const claims = verifyLinkIntentToken(token);
    expect(claims).toMatchObject({ userId: 'acct-1', provider: 'github' });
  });

  it('rejects a tampered token', () => {
    const token = createLinkIntentToken({ userId: 'acct-1', provider: 'github' });
    const [payload] = token.split('.');
    expect(verifyLinkIntentToken(`${payload}.deadbeef`)).toBeNull();
  });

  it('rejects an expired token', () => {
    const token = createLinkIntentToken({ userId: 'acct-1', provider: 'github' });
    // 11 minutes later (max age is 10).
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 11 * 60 * 1000);
    expect(verifyLinkIntentToken(token)).toBeNull();
  });

  it('rejects garbage', () => {
    expect(verifyLinkIntentToken('')).toBeNull();
    expect(verifyLinkIntentToken('no-dot')).toBeNull();
    expect(verifyLinkIntentToken(null)).toBeNull();
  });
});
