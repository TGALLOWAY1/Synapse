import crypto from 'crypto';
import { put, list, del } from '@vercel/blob';
import { json, methodNotAllowed } from './_lib/response.js';
import { enforceRateLimit } from './_lib/rateLimit.js';
import { requireOwner } from './_lib/ownerAuth.js';

// Single endpoint for the whole snapshot lifecycle. Vercel Hobby caps a
// deployment at 12 serverless functions, so we dispatch by method + the
// optional `?id=<uuid>` query param instead of splitting into per-id and
// collection files.
//
//   POST   /api/snapshots         -> save (body: { title, project, images })
//   GET    /api/snapshots         -> list summaries
//   GET    /api/snapshots?id=...  -> load one
//   DELETE /api/snapshots?id=...  -> remove one

// Hard cap on a single snapshot payload — guards against runaway uploads
// (e.g. accidentally bundling a giant project). Vercel's Hobby request
// body cap is ~4.5 MB; this matches.
const MAX_BODY_BYTES = 4 * 1024 * 1024;

const SNAPSHOT_PREFIX = 'snapshots/';
const ID_RE = /^[0-9a-f-]{8,64}$/i;

async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string' && req.body.length > 0) {
    return JSON.parse(req.body);
  }
  return await new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        reject(new Error('payload_too_large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

const nowIso = () => new Date().toISOString();

function sanitizeTitle(title) {
  if (typeof title !== 'string') return 'Untitled';
  const trimmed = title.trim().slice(0, 200);
  return trimmed.length > 0 ? trimmed : 'Untitled';
}

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

async function handlePost(req, res) {
  let body;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    if (err?.message === 'payload_too_large') {
      return json(res, 413, { error: 'payload_too_large', limitBytes: MAX_BODY_BYTES });
    }
    return json(res, 400, { error: 'invalid_json' });
  }

  const project = body?.project;
  const images = Array.isArray(body?.images) ? body.images : [];
  if (!project || typeof project !== 'object') {
    return json(res, 400, { error: 'missing_project' });
  }

  const id = crypto.randomUUID();
  const manifest = {
    id,
    title: sanitizeTitle(body.title),
    projectName: typeof project?.project?.name === 'string' ? project.project.name : 'Untitled',
    createdAt: nowIso(),
    schemaVersion: 1,
    imageCount: images.length,
  };

  const data = { schemaVersion: 1, manifest, project, images };
  const dataJson = JSON.stringify(data);
  const manifestJson = JSON.stringify({ ...manifest, sizeBytes: dataJson.length });

  await put(`${SNAPSHOT_PREFIX}${id}/data.json`, dataJson, {
    contentType: 'application/json',
    access: 'public',
    addRandomSuffix: false,
    allowOverwrite: false,
  });
  await put(`${SNAPSHOT_PREFIX}${id}/manifest.json`, manifestJson, {
    contentType: 'application/json',
    access: 'public',
    addRandomSuffix: false,
    allowOverwrite: false,
  });

  return json(res, 201, { id, manifest: JSON.parse(manifestJson) });
}

async function handleList(_req, res) {
  const summaries = [];
  let cursor;
  do {
    const page = await list({ prefix: SNAPSHOT_PREFIX, cursor });
    for (const blob of page.blobs) {
      if (!blob.pathname.endsWith('/manifest.json')) continue;
      try {
        const resp = await fetch(blob.url, { cache: 'no-store' });
        if (!resp.ok) continue;
        summaries.push(await resp.json());
      } catch {
        // skip unreadable manifests
      }
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);

  summaries.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
  return json(res, 200, { snapshots: summaries });
}

async function handleGetOne(id, res) {
  const blobs = await findBlobsForId(id);
  const dataBlob = blobs.find((b) => b.pathname.endsWith('/data.json'));
  if (!dataBlob) return json(res, 404, { error: 'not_found' });

  const resp = await fetch(dataBlob.url, { cache: 'no-store' });
  if (!resp.ok) return json(res, 502, { error: 'blob_fetch_failed' });
  return json(res, 200, await resp.json());
}

async function handleDelete(id, res) {
  const blobs = await findBlobsForId(id);
  if (blobs.length === 0) return json(res, 404, { error: 'not_found' });
  await Promise.all(blobs.map((b) => del(b.url)));
  return json(res, 200, { id, deleted: blobs.length });
}

export default async function handler(req, res) {
  if (!['GET', 'POST', 'DELETE'].includes(req.method)) {
    return methodNotAllowed(res, ['GET', 'POST', 'DELETE']);
  }
  if (
    enforceRateLimit(req, res, {
      scope: 'snapshots',
      limit: 60,
      windowMs: 60_000,
      errorBody: { error: 'rate_limited' },
    })
  ) {
    return;
  }
  if (requireOwner(req, res)) return;

  const id = typeof req.query?.id === 'string' ? req.query.id : null;
  if (id !== null && !ID_RE.test(id)) {
    return json(res, 400, { error: 'invalid_id' });
  }

  try {
    if (req.method === 'POST') {
      if (id !== null) return json(res, 400, { error: 'unexpected_id' });
      return await handlePost(req, res);
    }
    if (req.method === 'DELETE') {
      if (id === null) return json(res, 400, { error: 'missing_id' });
      return await handleDelete(id, res);
    }
    // GET
    if (id === null) return await handleList(req, res);
    return await handleGetOne(id, res);
  } catch (err) {
    console.error('[snapshots]', err);
    return json(res, 500, { error: 'internal_error', message: err?.message ?? 'unknown' });
  }
}
