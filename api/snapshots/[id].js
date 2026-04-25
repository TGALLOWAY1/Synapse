import { list, del } from '@vercel/blob';
import { json, methodNotAllowed } from '../_lib/response.js';
import { enforceRateLimit } from '../_lib/rateLimit.js';
import { requireOwner } from '../_lib/ownerAuth.js';

const SNAPSHOT_PREFIX = 'snapshots/';
const ID_RE = /^[0-9a-f-]{8,64}$/i;

async function findBlobsForId(id) {
  const out = [];
  let cursor;
  do {
    const page = await list({ prefix: `${SNAPSHOT_PREFIX}${id}/`, cursor });
    for (const blob of page.blobs) out.push(blob);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return out;
}

async function handleGet(id, res) {
  const blobs = await findBlobsForId(id);
  const dataBlob = blobs.find((b) => b.pathname.endsWith('/data.json'));
  if (!dataBlob) return json(res, 404, { error: 'not_found' });

  const resp = await fetch(dataBlob.url, { cache: 'no-store' });
  if (!resp.ok) return json(res, 502, { error: 'blob_fetch_failed' });
  const payload = await resp.json();
  return json(res, 200, payload);
}

async function handleDelete(id, res) {
  const blobs = await findBlobsForId(id);
  if (blobs.length === 0) return json(res, 404, { error: 'not_found' });
  await Promise.all(blobs.map((b) => del(b.url)));
  return json(res, 200, { id, deleted: blobs.length });
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'DELETE') {
    return methodNotAllowed(res, ['GET', 'DELETE']);
  }
  if (
    enforceRateLimit(req, res, {
      scope: 'snapshots_id',
      limit: 60,
      windowMs: 60_000,
      errorBody: { error: 'rate_limited' },
    })
  ) {
    return;
  }
  if (requireOwner(req, res)) return;

  const { id } = req.query ?? {};
  if (typeof id !== 'string' || !ID_RE.test(id)) {
    return json(res, 400, { error: 'invalid_id' });
  }

  try {
    if (req.method === 'GET') return await handleGet(id, res);
    return await handleDelete(id, res);
  } catch (err) {
    console.error('[snapshots/:id]', err);
    return json(res, 500, { error: 'internal_error', message: err?.message ?? 'unknown' });
  }
}
