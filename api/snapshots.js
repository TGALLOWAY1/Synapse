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
//   POST   /api/snapshots             -> save (body: { title, project, images })
//   GET    /api/snapshots             -> list summaries (owner)
//   GET    /api/snapshots?id=...      -> load one (owner)
//   DELETE /api/snapshots?id=...      -> remove one (owner)
//   GET    /api/snapshots?demo=1      -> load the demo snapshot (PUBLIC)
//   PUT    /api/snapshots?demo=1&id=  -> mark a snapshot as the demo (owner)
//   PUT    /api/snapshots?demo=1      -> clear the demo pointer (owner)

// Hard cap on a single snapshot payload — guards against runaway uploads
// (e.g. accidentally bundling a giant project). Vercel's Hobby request
// body cap is ~4.5 MB; this matches.
const MAX_BODY_BYTES = 4 * 1024 * 1024;

const SNAPSHOT_PREFIX = 'snapshots/';
const DEMO_POINTER_PATH = 'snapshots/_demo.json';
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

// Read the demo pointer blob, which holds `{ snapshotId, updatedAt }` and
// indicates which saved snapshot is currently surfaced as "the demo project".
// Returns null when no pointer has ever been written.
async function readDemoPointer() {
  const page = await list({ prefix: DEMO_POINTER_PATH });
  const blob = page.blobs.find((b) => b.pathname === DEMO_POINTER_PATH);
  if (!blob) return null;
  try {
    const body = await fetchBlobJson(blob.url);
    const snapshotId = typeof body?.snapshotId === 'string' ? body.snapshotId : null;
    if (!snapshotId || !ID_RE.test(snapshotId)) return null;
    return { snapshotId, updatedAt: body?.updatedAt ?? null };
  } catch {
    return null;
  }
}

async function writeDemoPointer(snapshotId) {
  const payload = JSON.stringify({ snapshotId, updatedAt: nowIso() });
  await put(DEMO_POINTER_PATH, payload, {
    contentType: 'application/json',
    access: 'private',
    addRandomSuffix: false,
    allowOverwrite: true,
  });
}

async function clearDemoPointer() {
  const page = await list({ prefix: DEMO_POINTER_PATH });
  await Promise.all(
    page.blobs
      .filter((b) => b.pathname === DEMO_POINTER_PATH)
      .map((b) => del(b.url)),
  );
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
    access: 'private',
    addRandomSuffix: false,
    allowOverwrite: false,
  });
  await put(`${SNAPSHOT_PREFIX}${id}/manifest.json`, manifestJson, {
    contentType: 'application/json',
    access: 'private',
    addRandomSuffix: false,
    allowOverwrite: false,
  });

  return json(res, 201, { id, manifest: JSON.parse(manifestJson) });
}

// Private blob URLs require the read/write token in the Authorization header
// — public-store URLs are open by URL, but for a private store we must
// authenticate every fetch. The SDK's `put`/`list`/`del` already do this; the
// raw `fetch(blob.url)` calls below are the only ones we have to wire up.
async function fetchBlobJson(url) {
  const resp = await fetch(url, {
    cache: 'no-store',
    headers: { Authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}` },
  });
  if (!resp.ok) {
    const detail = await resp.text().catch(() => '');
    const err = new Error(`blob_fetch_failed_${resp.status}${detail ? `: ${detail.slice(0, 200)}` : ''}`);
    err.status = resp.status;
    throw err;
  }
  return await resp.json();
}

async function handleList(_req, res) {
  const [summaries, pointer] = await Promise.all([
    (async () => {
      const out = [];
      let cursor;
      do {
        const page = await list({ prefix: SNAPSHOT_PREFIX, cursor });
        for (const blob of page.blobs) {
          if (!blob.pathname.endsWith('/manifest.json')) continue;
          try {
            out.push(await fetchBlobJson(blob.url));
          } catch {
            // skip unreadable manifests
          }
        }
        cursor = page.hasMore ? page.cursor : undefined;
      } while (cursor);
      return out;
    })(),
    readDemoPointer(),
  ]);

  const demoId = pointer?.snapshotId ?? null;
  for (const m of summaries) {
    m.isDemo = m.id === demoId;
  }

  summaries.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
  return json(res, 200, { snapshots: summaries, demoSnapshotId: demoId });
}

// Public: serve whichever snapshot the owner has marked as the demo. No
// auth required so anonymous "View demo project" buttons keep working.
async function handleGetDemo(res) {
  const pointer = await readDemoPointer();
  if (!pointer) return json(res, 404, { error: 'no_demo_set' });
  const blobs = await findBlobsForId(pointer.snapshotId);
  const dataBlob = blobs.find((b) => b.pathname.endsWith('/data.json'));
  if (!dataBlob) {
    // Pointer dangles — the snapshot it referenced was deleted. Treat as
    // "no demo" rather than 500ing so the home page can fall back cleanly.
    return json(res, 404, { error: 'no_demo_set' });
  }
  try {
    const data = await fetchBlobJson(dataBlob.url);
    return json(res, 200, data);
  } catch (err) {
    return json(res, 502, { error: 'blob_fetch_failed', message: err?.message ?? 'unknown' });
  }
}

async function handlePutDemo(id, res) {
  // PUT /api/snapshots?demo=1&id=<id>  -> set pointer
  // PUT /api/snapshots?demo=1          -> clear pointer
  if (id === null) {
    await clearDemoPointer();
    return json(res, 200, { demoSnapshotId: null });
  }
  // Verify the target snapshot exists before we update the pointer, so we
  // don't leave a dangling reference.
  const blobs = await findBlobsForId(id);
  const exists = blobs.some((b) => b.pathname.endsWith('/data.json'));
  if (!exists) return json(res, 404, { error: 'not_found' });
  await writeDemoPointer(id);
  return json(res, 200, { demoSnapshotId: id });
}

async function handleGetOne(id, res) {
  const blobs = await findBlobsForId(id);
  const dataBlob = blobs.find((b) => b.pathname.endsWith('/data.json'));
  if (!dataBlob) return json(res, 404, { error: 'not_found' });

  try {
    const data = await fetchBlobJson(dataBlob.url);
    return json(res, 200, data);
  } catch (err) {
    return json(res, 502, { error: 'blob_fetch_failed', message: err?.message ?? 'unknown' });
  }
}

async function handleDelete(id, res) {
  const blobs = await findBlobsForId(id);
  if (blobs.length === 0) return json(res, 404, { error: 'not_found' });
  await Promise.all(blobs.map((b) => del(b.url)));
  return json(res, 200, { id, deleted: blobs.length });
}

export default async function handler(req, res) {
  if (!['GET', 'POST', 'PUT', 'DELETE'].includes(req.method)) {
    return methodNotAllowed(res, ['GET', 'POST', 'PUT', 'DELETE']);
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

  // `?demo=1` is the public-demo channel. GET is anonymous (so any visitor
  // can load the demo), but PUT (set/clear pointer) is owner-only. Every
  // other route stays owner-gated as before.
  const isDemoChannel = req.query?.demo === '1' || req.query?.demo === 'true';
  const isPublicDemoRead = isDemoChannel && req.method === 'GET';
  if (!isPublicDemoRead && requireOwner(req, res)) return;

  // @vercel/blob reads BLOB_READ_WRITE_TOKEN from the env. Just creating a
  // Blob store in the Vercel dashboard isn't enough — the store has to be
  // connected to this project, which is what populates the token. Fail fast
  // with an actionable message so the owner knows what to fix.
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    console.error('[snapshots] BLOB_READ_WRITE_TOKEN is not set on this deployment.');
    return json(res, 503, {
      error: 'blob_not_configured',
      message:
        'Vercel Blob is not connected to this project. In the Vercel dashboard go to Storage, then connect the Blob store to this project (this adds BLOB_READ_WRITE_TOKEN to the environment), then redeploy.',
    });
  }

  const id = typeof req.query?.id === 'string' ? req.query.id : null;
  if (id !== null && !ID_RE.test(id)) {
    return json(res, 400, { error: 'invalid_id' });
  }

  try {
    if (isDemoChannel) {
      if (req.method === 'GET') return await handleGetDemo(res);
      if (req.method === 'PUT') return await handlePutDemo(id, res);
      return methodNotAllowed(res, ['GET', 'PUT']);
    }
    if (req.method === 'POST') {
      if (id !== null) return json(res, 400, { error: 'unexpected_id' });
      return await handlePost(req, res);
    }
    if (req.method === 'DELETE') {
      if (id === null) return json(res, 400, { error: 'missing_id' });
      return await handleDelete(id, res);
    }
    if (req.method === 'PUT') {
      // PUT is only valid for the demo channel. Reject otherwise.
      return methodNotAllowed(res, ['GET', 'POST', 'DELETE']);
    }
    // GET
    if (id === null) return await handleList(req, res);
    return await handleGetOne(id, res);
  } catch (err) {
    console.error('[snapshots]', err);
    const message = err?.message ?? 'unknown';
    // Surface the most common Blob-specific failure modes with an obviously
    // actionable hint, since the only thing the snapshot panel shows is this
    // message.
    if (/BLOB_READ_WRITE_TOKEN|No token found/i.test(message)) {
      return json(res, 503, {
        error: 'blob_not_configured',
        message:
          'Vercel Blob rejected the call: BLOB_READ_WRITE_TOKEN is missing or invalid. Reconnect the Blob store to this project in the Vercel dashboard and redeploy.',
      });
    }
    return json(res, 500, { error: 'internal_error', message });
  }
}
