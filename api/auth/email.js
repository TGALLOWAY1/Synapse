import { verifyPassword, hashPassword } from '../_lib/password.js';
import { json, methodNotAllowed } from '../_lib/response.js';
import {
  parseJsonBody,
  validateEmail,
  validateName,
  validatePassword,
} from '../_lib/validate.js';
import {
  findEmailUserForLogin,
  createEmailUser,
  issueSessionForUser,
  toPublicUser,
  EmailInUseError,
} from '../_lib/users.js';
import { clearSessionCookie } from '../_lib/session.js';
import { enforceRateLimit, getClientKey } from '../_lib/rateLimit.js';

// Email/password auth + session lifecycle, consolidated into ONE serverless
// function to stay under the Vercel Hobby plan's 12-function limit. The original
// public URLs are preserved by vercel.json rewrites:
//
//   /api/auth/login  -> /api/auth/email?action=login
//   /api/auth/signup -> /api/auth/email?action=signup
//   /api/auth/logout -> /api/auth/email?action=logout
//
// Each branch's behavior (validation, rate-limit scopes, status codes, response
// shapes) is unchanged from when these were three separate files.

async function handleLogin(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  // Per-IP throttle on login attempts to blunt online password brute force.
  if (
    enforceRateLimit(req, res, {
      scope: 'auth_login_ip',
      limit: 10,
      windowMs: 60_000,
      errorBody: { error: 'rate_limited' },
    })
  ) {
    return;
  }

  try {
    const body = await parseJsonBody(req);

    const emailCheck = validateEmail(body?.email);
    if (!emailCheck.ok) {
      return json(res, 401, { error: 'invalid_credentials' });
    }
    if (typeof body?.password !== 'string' || body.password.length === 0) {
      return json(res, 401, { error: 'invalid_credentials' });
    }

    // Extra per-email throttle to make targeted attacks harder even from
    // rotating IPs (doesn't defeat distributed attackers but raises cost).
    if (
      enforceRateLimit(req, res, {
        scope: 'auth_login_email',
        limit: 10,
        windowMs: 10 * 60_000,
        keyFn: () => `${getClientKey(req)}|${emailCheck.value}`,
        errorBody: { error: 'rate_limited' },
      })
    ) {
      return;
    }

    const user = await findEmailUserForLogin(emailCheck.value);
    if (!user || !user.passwordHash) {
      return json(res, 401, { error: 'invalid_credentials' });
    }

    const match = verifyPassword(body.password, user.passwordHash);
    if (!match) {
      return json(res, 401, { error: 'invalid_credentials' });
    }

    await issueSessionForUser(req, res, user);
    return json(res, 200, { user: toPublicUser(user) });
  } catch (error) {
    console.error('[Login failed]', error);
    return json(res, 500, { error: 'login_failed' });
  }
}

async function handleSignup(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  // Throttle account creation so a single host can't flood the user table.
  if (
    enforceRateLimit(req, res, {
      scope: 'auth_signup_ip',
      limit: 5,
      windowMs: 10 * 60_000,
      errorBody: { error: 'rate_limited' },
    })
  ) {
    return;
  }

  try {
    const body = await parseJsonBody(req);

    const emailCheck = validateEmail(body?.email);
    if (!emailCheck.ok) return json(res, 400, { error: 'invalid_email', field: 'email', message: emailCheck.error });

    const passwordCheck = validatePassword(body?.password);
    if (!passwordCheck.ok) return json(res, 400, { error: 'weak_password', field: 'password', message: passwordCheck.error });

    const nameCheck = validateName(body?.name);
    if (!nameCheck.ok) return json(res, 400, { error: 'invalid_name', field: 'name', message: nameCheck.error });

    const passwordHash = hashPassword(passwordCheck.value);

    let user;
    try {
      user = await createEmailUser({
        email: emailCheck.value,
        name: nameCheck.value,
        passwordHash,
      });
    } catch (error) {
      if (error instanceof EmailInUseError) {
        return json(res, 409, { error: 'email_in_use', field: 'email' });
      }
      throw error;
    }

    await issueSessionForUser(req, res, user);
    return json(res, 201, { user: toPublicUser(user) });
  } catch (error) {
    console.error('[Signup failed]', error);
    return json(res, 500, { error: 'signup_failed' });
  }
}

function handleLogout(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  clearSessionCookie(res);
  return res.status(200).json({ ok: true });
}

export default async function handler(req, res) {
  const action = req.query?.action;
  if (action === 'login') return handleLogin(req, res);
  if (action === 'signup') return handleSignup(req, res);
  if (action === 'logout') return handleLogout(req, res);
  return json(res, 404, { error: 'unknown_action' });
}
