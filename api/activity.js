import { runMongoAction } from './_lib/db.js';
import { json, methodNotAllowed } from './_lib/response.js';
import { parseSessionCookie, verifySessionToken } from './_lib/session.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  const token = parseSessionCookie(req);
  const claims = verifySessionToken(token);
  if (!claims?.recruiterId) return json(res, 401, { error: 'Unauthorized' });

  const { type, metadata } = req.body || {};
  if (!type) return json(res, 400, { error: 'Missing activity type' });

  try {
    const now = new Date();
    await runMongoAction('insertOne', {
      collection: 'recruiter_activity',
      document: {
        recruiterId: claims.recruiterId,
        type,
        metadata: metadata || {},
        createdAt: now,
      },
    });

    await runMongoAction('updateOne', {
      collection: 'recruiters',
      filter: { linkedinId: claims.recruiterId },
      update: { $set: { lastActiveAt: now } },
    });

    return json(res, 200, { ok: true });
  } catch (error) {
    console.error('[Activity logging failed]', error);
    return json(res, 500, { error: 'Failed to track activity' });
  }
}
