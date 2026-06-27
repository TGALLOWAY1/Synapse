import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The three email-auth endpoints were merged into one function (api/auth/email.js)
// to stay under the Vercel Hobby 12-function limit, with the original URLs
// preserved by vercel.json rewrites that set ?action=. These tests verify the
// dispatcher routes each action to the right branch and gates correctly.

const users = {
  findEmailUserForLogin: vi.fn(),
  createEmailUser: vi.fn(),
  issueSessionForUser: vi.fn(),
  toPublicUser: vi.fn((u) => ({ userId: u.userId })),
  EmailInUseError: class EmailInUseError extends Error {},
};
const password = { verifyPassword: vi.fn(), hashPassword: vi.fn(() => 'hash') };
const session = { clearSessionCookie: vi.fn() };
const rateLimit = { enforceRateLimit: vi.fn(() => false), getClientKey: vi.fn(() => 'ip') };

vi.mock('../_lib/users.js', () => users);
vi.mock('../_lib/password.js', () => password);
vi.mock('../_lib/session.js', () => session);
vi.mock('../_lib/rateLimit.js', () => rateLimit);

let handler;

function mockRes() {
  return {
    statusCode: 0,
    body: null,
    headers: {},
    status(code) { this.statusCode = code; return this; },
    setHeader(k, v) { this.headers[k] = v; },
    send(b) { this.body = b; },
    json(b) { this.body = JSON.stringify(b); return this; },
  };
}

beforeEach(async () => {
  vi.resetModules();
  Object.values(users).forEach((fn) => typeof fn === 'function' && fn.mockReset?.());
  users.toPublicUser.mockImplementation((u) => ({ userId: u.userId }));
  password.verifyPassword.mockReset();
  password.hashPassword.mockReset().mockReturnValue('hash');
  session.clearSessionCookie.mockReset();
  rateLimit.enforceRateLimit.mockReset().mockReturnValue(false);
  rateLimit.getClientKey.mockReset().mockReturnValue('ip');
  ({ default: handler } = await import('../auth/email.js'));
});

afterEach(() => vi.restoreAllMocks());

describe('api/auth/email dispatcher', () => {
  it('routes action=logout to the logout branch', async () => {
    const res = mockRes();
    await handler({ method: 'POST', query: { action: 'logout' }, headers: {} }, res);
    expect(session.clearSessionCookie).toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
  });

  it('routes action=login and issues a session on valid credentials', async () => {
    users.findEmailUserForLogin.mockResolvedValue({ userId: 'u1', passwordHash: 'h' });
    password.verifyPassword.mockReturnValue(true);
    const res = mockRes();
    await handler(
      { method: 'POST', query: { action: 'login' }, headers: {}, body: { email: 'a@b.com', password: 'pw' } },
      res,
    );
    expect(users.issueSessionForUser).toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
  });

  it('routes action=login and 401s on a bad password', async () => {
    users.findEmailUserForLogin.mockResolvedValue({ userId: 'u1', passwordHash: 'h' });
    password.verifyPassword.mockReturnValue(false);
    const res = mockRes();
    await handler(
      { method: 'POST', query: { action: 'login' }, headers: {}, body: { email: 'a@b.com', password: 'pw' } },
      res,
    );
    expect(res.statusCode).toBe(401);
    expect(users.issueSessionForUser).not.toHaveBeenCalled();
  });

  it('routes action=signup and creates a user', async () => {
    users.createEmailUser.mockResolvedValue({ userId: 'u2' });
    const res = mockRes();
    await handler(
      {
        method: 'POST',
        query: { action: 'signup' },
        headers: {},
        body: { email: 'new@b.com', password: 'password1', name: 'New' },
      },
      res,
    );
    expect(users.createEmailUser).toHaveBeenCalled();
    expect(res.statusCode).toBe(201);
  });

  it('404s an unknown action', async () => {
    const res = mockRes();
    await handler({ method: 'POST', query: { action: 'nope' }, headers: {} }, res);
    expect(res.statusCode).toBe(404);
  });

  it('405s a non-POST on a known action', async () => {
    const res = mockRes();
    await handler({ method: 'GET', query: { action: 'login' }, headers: {} }, res);
    expect(res.statusCode).toBe(405);
  });
});
