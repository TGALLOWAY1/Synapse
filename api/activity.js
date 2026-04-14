import { runMongoAction } from './_lib/db.js';
import { json, methodNotAllowed } from './_lib/response.js';
import { parseSessionCookie, verifySessionToken } from './_lib/session.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  const token = parseSessionCookie(req);
  const claims = verifySessionToken(token);
  const subjectId = claims?.userId || claims?.recruiterId;
  if (!subjectId) return json(res, 401, { error: 'Unauthorized' });

  const { type, metadata } = req.body || {};
  if (!type) return json(res, 400, { error: 'Missing activity type' });

  try {
    const now = new Date();
    await runMongoAction('insertOne', {
      collection: 'recruiter_activity',
      document: {
        userId: claims?.userId || null,
        recruiterId: claims?.recruiterId || subjectId,
        type,
        metadata: metadata || {},
        createdAt: now,
      },
    });

    // Update lastActiveAt on the user record. Prefer userId (works for all
    // providers); fall back to linkedinId for pre-migration tokens.
    const userFilter = claims?.userId
      ? { userId: claims.userId }
      : { linkedinId: claims.recruiterId };
    await runMongoAction('updateOne', {
      collection: 'recruiters',
      filter: userFilter,
      update: { $set: { lastActiveAt: now } },
    });

    return json(res, 200, { ok: true });
  } catch (error) {
    console.error('[Activity logging failed]', error);
    return json(res, 500, { error: 'Failed to track activity' });
  }
}
