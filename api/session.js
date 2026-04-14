import { json, methodNotAllowed } from './_lib/response.js';
import { parseSessionCookie, verifySessionToken } from './_lib/session.js';
import {
  findUserByUserId,
  findUserByLinkedinId,
  toPublicUser,
} from './_lib/users.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res);

  try {
    const token = parseSessionCookie(req);
    const claims = verifySessionToken(token);
    if (!claims) return json(res, 200, { authenticated: false });

    // New tokens carry `userId`; legacy tokens only have `recruiterId` which
    // was the LinkedIn sub. Try the new path first, fall back to legacy.
    let user = null;
    if (claims.userId) {
      user = await findUserByUserId(claims.userId);
    }
    if (!user && claims.recruiterId) {
      user = await findUserByLinkedinId(claims.recruiterId);
    }

    if (!user) return json(res, 200, { authenticated: false });
    return json(res, 200, { authenticated: true, user: toPublicUser(user) });
  } catch (error) {
    console.error('[Session fetch failed]', error);
    return json(res, 500, { authenticated: false, error: 'Failed to get session.' });
  }
}
