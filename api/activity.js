import { runMongoAction } from './_lib/db.js';
import { json, methodNotAllowed } from './_lib/response.js';
import { parseSessionCookie, verifySessionToken } from './_lib/session.js';
import { parseJsonBody } from './_lib/validate.js';
import { enforceRateLimit } from './_lib/rateLimit.js';

// Activity events are structured analytics we log for our own UI — reject
// anything that isn't on this allowlist so clients can't dump arbitrary
// strings into our database.
const ALLOWED_TYPES = new Set([
  'generated_artifact',
  'viewed_mockups',
  'clicked_section',
  'opened_project',
  'exported_project',
  'created_branch',
  'consolidated_branch',
  'regenerated_spine',
]);

const MAX_TYPE_LEN = 64;
const MAX_METADATA_BYTES = 4 * 1024; // 4 KiB
const MAX_METADATA_KEYS = 20;

function validateMetadata(metadata) {
  if (metadata === undefined || metadata === null) return {};
  if (typeof metadata !== 'object' || Array.isArray(metadata)) return null;

  const keys = Object.keys(metadata);
  if (keys.length > MAX_METADATA_KEYS) return null;

  // Only permit primitive leaf values one level deep — reject nested objects
  // and large string payloads so the collection can't be abused as blob storage.
  for (const key of keys) {
    if (typeof key !== 'string' || key.length === 0 || key.length > 64) return null;
    const v = metadata[key];
    if (v === null) continue;
    const t = typeof v;
    if (t === 'string') {
      if (v.length > 512) return null;
    } else if (t === 'number') {
      if (!Number.isFinite(v)) return null;
    } else if (t === 'boolean') {
      // ok
    } else {
      return null;
    }
  }

  const serialized = JSON.stringify(metadata);
  if (Buffer.byteLength(serialized, 'utf8') > MAX_METADATA_BYTES) return null;
  return metadata;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  const token = parseSessionCookie(req);
  const claims = verifySessionToken(token);
  const subjectId = claims?.userId || claims?.recruiterId;
  if (!subjectId) return json(res, 401, { error: 'Unauthorized' });

  // Cap writes per authenticated client to prevent billing/DB abuse.
  if (
    enforceRateLimit(req, res, {
      scope: 'activity_user',
      limit: 120,
      windowMs: 60_000,
      keyFn: () => `u:${subjectId}`,
      errorBody: { error: 'rate_limited' },
    })
  ) {
    return;
  }

  const body = await parseJsonBody(req);
  const rawType = body?.type;
  if (typeof rawType !== 'string' || rawType.length === 0 || rawType.length > MAX_TYPE_LEN) {
    return json(res, 400, { error: 'Missing activity type' });
  }
  if (!ALLOWED_TYPES.has(rawType)) {
    return json(res, 400, { error: 'Invalid activity type' });
  }

  const metadata = validateMetadata(body?.metadata);
  if (metadata === null) {
    return json(res, 400, { error: 'Invalid metadata' });
  }

  try {
    const now = new Date();
    await runMongoAction('insertOne', {
      collection: 'recruiter_activity',
      document: {
        userId: claims?.userId || null,
        recruiterId: claims?.recruiterId || subjectId,
        type: rawType,
        metadata,
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
