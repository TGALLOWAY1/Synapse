import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  __resetRateLimitForTests,
  enforceRateLimit,
  getClientKey,
  rateLimit,
} from '../rateLimit.js';

describe('rateLimit', () => {
  afterEach(() => {
    __resetRateLimitForTests();
    vi.useRealTimers();
  });

  it('allows up to `limit` hits and denies after that', () => {
    for (let i = 0; i < 3; i += 1) {
      const result = rateLimit('k', 3, 1000);
      expect(result.allowed).toBe(true);
    }
    const over = rateLimit('k', 3, 1000);
    expect(over.allowed).toBe(false);
    expect(over.remaining).toBe(0);
  });

  it('resets after the window elapses', () => {
    vi.useFakeTimers();
    for (let i = 0; i < 3; i += 1) rateLimit('k', 3, 1000);
    expect(rateLimit('k', 3, 1000).allowed).toBe(false);
    vi.setSystemTime(Date.now() + 1500);
    expect(rateLimit('k', 3, 1000).allowed).toBe(true);
  });

  it('tracks keys independently', () => {
    rateLimit('a', 1, 1000);
    expect(rateLimit('a', 1, 1000).allowed).toBe(false);
    expect(rateLimit('b', 1, 1000).allowed).toBe(true);
  });
});

describe('getClientKey', () => {
  it('prefers the leftmost x-forwarded-for entry', () => {
    const key = getClientKey({
      headers: { 'x-forwarded-for': '203.0.113.1, 10.0.0.1, 10.0.0.2' },
      socket: { remoteAddress: '10.0.0.99' },
    });
    expect(key).toBe('203.0.113.1');
  });

  it('falls back to socket address when no xff is present', () => {
    expect(getClientKey({ headers: {}, socket: { remoteAddress: '192.0.2.5' } }))
      .toBe('192.0.2.5');
  });

  it('returns "unknown" when there is nothing to key on', () => {
    expect(getClientKey({ headers: {}, socket: {} })).toBe('unknown');
  });
});

describe('enforceRateLimit', () => {
  function makeRes() {
    const headers = {};
    let status = 200;
    let body = null;
    return {
      headers,
      getStatus: () => status,
      getBody: () => body,
      setHeader(key, value) { headers[key] = value; return this; },
      status(code) { status = code; return this; },
      send(payload) { body = payload; return this; },
    };
  }

  it('returns true and writes 429 when over the limit', () => {
    const req = { headers: { 'x-forwarded-for': '198.51.100.1' }, socket: {} };
    const limit = 2;
    for (let i = 0; i < limit; i += 1) {
      const res = makeRes();
      const bailed = enforceRateLimit(req, res, { scope: 'test', limit, windowMs: 1000 });
      expect(bailed).toBe(false);
    }
    const res = makeRes();
    const bailed = enforceRateLimit(req, res, { scope: 'test', limit, windowMs: 1000 });
    expect(bailed).toBe(true);
    expect(res.getStatus()).toBe(429);
    expect(res.headers['Retry-After']).toBeDefined();
  });

  it('scopes are independent', () => {
    const req = { headers: { 'x-forwarded-for': '198.51.100.2' }, socket: {} };
    const res1 = makeRes();
    expect(enforceRateLimit(req, res1, { scope: 'a', limit: 1, windowMs: 1000 })).toBe(false);
    const res2 = makeRes();
    expect(enforceRateLimit(req, res2, { scope: 'b', limit: 1, windowMs: 1000 })).toBe(false);
  });
});
