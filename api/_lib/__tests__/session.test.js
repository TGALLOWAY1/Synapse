import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createSessionToken,
  parseSessionCookie,
  verifySessionToken,
} from '../session.js';

// 30 days in ms — must match MAX_SESSION_AGE_MS in session.js.
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

describe('session token', () => {
  const originalSecret = process.env.SESSION_SECRET;

  beforeEach(() => {
    process.env.SESSION_SECRET = 'test-secret-do-not-use-in-prod';
  });

  afterEach(() => {
    process.env.SESSION_SECRET = originalSecret;
    vi.useRealTimers();
  });

  it('round-trips claims and validates the signature', () => {
    const token = createSessionToken({ userId: 'abc' });
    const claims = verifySessionToken(token);
    expect(claims).toBeTruthy();
    expect(claims.userId).toBe('abc');
    expect(typeof claims.issuedAt).toBe('number');
  });

  it('rejects tokens with a tampered payload', () => {
    const token = createSessionToken({ userId: 'abc' });
    const [, signature] = token.split('.');
    const fakePayload = Buffer.from(JSON.stringify({ userId: 'evil', issuedAt: Date.now() })).toString('base64url');
    expect(verifySessionToken(`${fakePayload}.${signature}`)).toBeNull();
  });

  it('rejects tokens signed with a different secret', () => {
    const token = createSessionToken({ userId: 'abc' });
    process.env.SESSION_SECRET = 'a-completely-different-secret';
    expect(verifySessionToken(token)).toBeNull();
  });

  it('rejects malformed tokens', () => {
    expect(verifySessionToken(null)).toBeNull();
    expect(verifySessionToken('')).toBeNull();
    expect(verifySessionToken('no-dot-here')).toBeNull();
    expect(verifySessionToken('.empty')).toBeNull();
    expect(verifySessionToken('empty.')).toBeNull();
  });

  it('rejects tokens older than the maximum session age', () => {
    const token = createSessionToken({ userId: 'abc' });
    // Advance time beyond MAX_SESSION_AGE_MS.
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + THIRTY_DAYS_MS + 60_000);
    expect(verifySessionToken(token)).toBeNull();
  });

  it('rejects tokens with an issuedAt far in the future', () => {
    // Manually craft a token with a future issuedAt, which a malicious client
    // might try to extend validity. Since our sign() function uses the same
    // secret, we can only exercise this branch by simulating a clock jump.
    const token = createSessionToken({ userId: 'abc' });
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() - 10 * 60_000); // 10 minutes before issuedAt
    expect(verifySessionToken(token)).toBeNull();
  });

  it('parseSessionCookie pulls the named cookie out of the header', () => {
    const req = { headers: { cookie: 'foo=bar; synapse_session=xyz; other=baz' } };
    expect(parseSessionCookie(req)).toBe('xyz');
  });

  it('parseSessionCookie returns null when no cookie header is present', () => {
    expect(parseSessionCookie({ headers: {} })).toBeNull();
  });
});
