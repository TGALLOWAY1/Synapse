import { runMongoAction } from './_lib/db.js';
import { json, methodNotAllowed } from './_lib/response.js';
import { parseSessionCookie, verifySessionToken } from './_lib/session.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res);

  try {
    const token = parseSessionCookie(req);
    const claims = verifySessionToken(token);
    if (!claims?.recruiterId) return json(res, 200, { authenticated: false });

    const result = await runMongoAction('findOne', {
      collection: 'recruiters',
      filter: { linkedinId: claims.recruiterId },
      projection: { _id: 0, linkedinId: 1, name: 1, profileUrl: 1, headline: 1, company: 1, avatarUrl: 1, email: 1, lastActiveAt: 1 },
    });

    if (!result.document) return json(res, 200, { authenticated: false });
    return json(res, 200, { authenticated: true, user: result.document });
  } catch (error) {
    console.error('[Session fetch failed]', error);
    return json(res, 500, { authenticated: false, error: 'Failed to get session.' });
  }
}
