import crypto from 'crypto';
import { put, list } from '@vercel/blob';
import { json, methodNotAllowed } from '../_lib/response.js';
import { enforceRateLimit } from '../_lib/rateLimit.js';
import { requireOwner } from '../_lib/ownerAuth.js';

// Hard cap on a single snapshot payload — guards against runaway uploads
// (e.g. accidentally bundling a giant project). 60 MB comfortably fits a
// project with ~20 high-quality gpt-image-2 PNGs (~1-3 MB each as base64).
const MAX_BODY_BYTES = 60 * 1024 * 1024;

const SNAPSHOT_PREFIX = 'snapshots/';

async function readJsonBody(req) {
  // Vercel may pre-parse JSON. If req.body is a string/object already, prefer it.
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

function nowIso() {
  return new Date().toISOString();
}

function sanitizeTitle(title) {
  if (typeof title !== 'string') return 'Untitled';
  const trimmed = title.trim().slice(0, 200);
  return trimmed.length > 0 ? trimmed : 'Untitled';
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

  const data = {
    schemaVersion: 1,
    manifest,
    project,
    images,
  };

  const dataJson = JSON.stringify(data);
  const manifestJson = JSON.stringify({ ...manifest, sizeBytes: dataJson.length });

  // Sequential writes: manifest second so a partial failure leaves an orphaned
  // data blob (cleanable) rather than a manifest pointing at nothing.
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
  // Vercel Blob `list` returns up to 1000 entries per page. For a personal
  // portfolio that's effectively unbounded. We page through to be safe.
  const summaries = [];
  let cursor;
  do {
    const page = await list({ prefix: SNAPSHOT_PREFIX, cursor });
    for (const blob of page.blobs) {
      if (!blob.pathname.endsWith('/manifest.json')) continue;
      try {
        const resp = await fetch(blob.url, { cache: 'no-store' });
        if (!resp.ok) continue;
        const manifest = await resp.json();
        summaries.push(manifest);
      } catch {
        // skip unreadable manifests
      }
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);

  summaries.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
  return json(res, 200, { snapshots: summaries });
}

export default async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return methodNotAllowed(res, ['GET', 'POST']);
  }
  if (
    enforceRateLimit(req, res, {
      scope: 'snapshots_index',
      limit: 60,
      windowMs: 60_000,
      errorBody: { error: 'rate_limited' },
    })
  ) {
    return;
  }
  if (requireOwner(req, res)) return;

  try {
    if (req.method === 'POST') return await handlePost(req, res);
    return await handleList(req, res);
  } catch (err) {
    console.error('[snapshots]', err);
    return json(res, 500, { error: 'internal_error', message: err?.message ?? 'unknown' });
  }
}
