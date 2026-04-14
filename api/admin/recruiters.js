import crypto from 'crypto';
import { runMongoAction } from '../_lib/db.js';
import { json, methodNotAllowed } from '../_lib/response.js';
import { enforceRateLimit } from '../_lib/rateLimit.js';

// Minimum length for the admin shared secret so we never accept a trivially
// guessable key. Enforced both on-reject (constant-time compare) and here.
const MIN_ADMIN_KEY_LEN = 24;

function constantTimeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  try {
    return crypto.timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res);

  // Throttle failed admin-key attempts aggressively.
  if (
    enforceRateLimit(req, res, {
      scope: 'admin_recruiters',
      limit: 20,
      windowMs: 60_000,
      errorBody: { error: 'rate_limited' },
    })
  ) {
    return;
  }

  const adminKey = process.env.ADMIN_DASHBOARD_KEY;
  const provided = req.headers['x-admin-key'];

  // Refuse to authenticate if the server-side key is missing or too short —
  // prevents an unset/empty env var from silently accepting a blank header.
  if (!adminKey || adminKey.length < MIN_ADMIN_KEY_LEN) {
    console.warn('[admin] ADMIN_DASHBOARD_KEY is unset or too short; rejecting admin request.');
    return json(res, 401, { error: 'Unauthorized' });
  }
  if (typeof provided !== 'string' || !constantTimeEqual(provided, adminKey)) {
    return json(res, 401, { error: 'Unauthorized' });
  }

  try {
    const result = await runMongoAction('aggregate', {
      collection: 'recruiters',
      pipeline: [
        {
          $lookup: {
            from: 'recruiter_activity',
            localField: 'linkedinId',
            foreignField: 'recruiterId',
            as: 'activity',
          },
        },
        {
          $project: {
            _id: 0,
            linkedinId: 1,
            name: 1,
            profileUrl: 1,
            headline: 1,
            company: 1,
            avatarUrl: 1,
            email: 1,
            createdAt: 1,
            lastActiveAt: 1,
            loginCount: 1,
            sessions: '$loginCount',
            artifactGenerations: {
              $size: { $filter: { input: '$activity', as: 'item', cond: { $eq: ['$$item.type', 'generated_artifact'] } } },
            },
            viewedMockups: {
              $size: { $filter: { input: '$activity', as: 'item', cond: { $eq: ['$$item.type', 'viewed_mockups'] } } },
            },
            clickedSections: {
              $size: { $filter: { input: '$activity', as: 'item', cond: { $eq: ['$$item.type', 'clicked_section'] } } },
            },
          },
        },
        { $sort: { lastActiveAt: -1 } },
      ],
    });

    return json(res, 200, { recruiters: result.documents || [] });
  } catch (error) {
    console.error('[Recruiter dashboard query failed]', error);
    return json(res, 500, { error: 'Failed to load recruiters' });
  }
}
