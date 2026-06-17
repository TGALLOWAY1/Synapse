import { describe, expect, it } from 'vitest';
import { requireUser } from '../requireUser.js';

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

describe('requireUser', () => {
  it('rejects a request with no session cookie (401) and returns null', async () => {
    const res = mockRes();
    const user = await requireUser({ headers: {} }, res);
    expect(user).toBeNull();
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body).error).toBe('unauthorized');
  });

  it('rejects a request with a garbage/forged session token (401)', async () => {
    const res = mockRes();
    const user = await requireUser(
      { headers: { cookie: 'synapse_session=not-a-valid-token' } },
      res,
    );
    expect(user).toBeNull();
    expect(res.statusCode).toBe(401);
  });
});
