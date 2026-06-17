import { json } from './response.js';
import { parseSessionCookie, verifySessionToken } from './session.js';
import { findUserByUserId, findUserByLinkedinId } from './users.js';

/**
 * Resolve the authenticated user for a request from the signed session cookie.
 *
 * Returns the public user record on success, or `null` after writing a `401`
 * response — so call sites can simply do:
 *
 *   const user = await requireUser(req, res);
 *   if (!user) return; // 401 already sent
 *
 * This is the single chokepoint every private (non-owner) API route uses to
 * enforce "validate session before reading or writing private data". It never
 * trusts a client-supplied userId — identity comes only from the verified
 * cookie claims.
 */
export async function requireUser(req, res) {
  let claims;
  try {
    const token = parseSessionCookie(req);
    claims = verifySessionToken(token);
  } catch {
    claims = null;
  }

  if (!claims) {
    json(res, 401, { error: 'unauthorized', message: 'Sign in to continue.' });
    return null;
  }

  let user = null;
  try {
    // New tokens carry `userId`; legacy LinkedIn-only tokens carry `recruiterId`.
    if (claims.userId) {
      user = await findUserByUserId(claims.userId);
    }
    if (!user && claims.recruiterId) {
      user = await findUserByLinkedinId(claims.recruiterId);
    }
  } catch (error) {
    console.error('[requireUser] lookup failed', error);
    json(res, 500, { error: 'session_lookup_failed' });
    return null;
  }

  if (!user || !user.userId) {
    json(res, 401, { error: 'unauthorized', message: 'Sign in to continue.' });
    return null;
  }

  return user;
}
