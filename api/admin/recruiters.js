import { runMongoAction } from '../_lib/db.js';
import { json, methodNotAllowed } from '../_lib/response.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res);

  const adminKey = process.env.ADMIN_DASHBOARD_KEY;
  if (!adminKey || req.headers['x-admin-key'] !== adminKey) return json(res, 401, { error: 'Unauthorized' });

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
