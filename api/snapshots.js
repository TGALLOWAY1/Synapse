import crypto from 'crypto';
import { put, list, del } from '@vercel/blob';
import { json, methodNotAllowed } from './_lib/response.js';
import { enforceRateLimit } from './_lib/rateLimit.js';
import { requireOwner } from './_lib/ownerAuth.js';

// Single endpoint for the whole snapshot lifecycle. Vercel Hobby caps a
// deployment at 12 serverless functions, so we dispatch by method + query
// params instead of splitting into per-id and collection files.
//
//   POST   /api/snapshots                     -> save bundle (no image bodies)
//   POST   /api/snapshots?id=...&image=1      -> upload one image blob (owner)
//   GET    /api/snapshots                     -> list summaries (owner)
//   GET    /api/snapshots?id=...              -> load bundle + image refs (owner)
//   GET    /api/snapshots?id=...&image=<key>  -> load one image (owner)
//   DELETE /api/snapshots?id=...              -> remove one snapshot (owner)
//   GET    /api/snapshots?demo=1              -> load the demo snapshot (PUBLIC)
//   GET    /api/snapshots?demo=1&pointer=1    -> read the demo pointer (PUBLIC)
//   GET    /api/snapshots?demo=1&image=<key>  -> load one demo image (PUBLIC)
//   PUT    /api/snapshots?demo=1&id=          -> mark a snapshot as the demo (owner)
//   PUT    /api/snapshots?demo=1              -> clear the demo pointer (owner)
//
// Schema v2 stores mockup images as separate per-image blobs under
// `snapshots/<id>/images/<hash>.json` so a single project with N large
// images doesn't blow past Vercel's ~4.5 MB serverless body cap on either
// the upload or the download side. v1 snapshots (inline images) are still
// readable on GET — the response just preserves the legacy shape.

// Per-request body cap. Vercel's serverless platform enforces its own
// ~4.5 MB limit upstream, so this is a defense-in-depth check and keeps
// `req.on('data')` from buffering an unbounded payload if Vercel ever
// changes that limit.
const MAX_BODY_BYTES = 4 * 1024 * 1024;

const SNAPSHOT_PREFIX = 'snapshots/';
const DEMO_POINTER_PATH = 'snapshots/_demo.json';
const ID_RE = /^[0-9a-f-]{8,64}$/i;
const IMAGE_KEY_MAX = 512;
const CURRENT_SCHEMA_VERSION = 2;

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

// Image keys look like `${versionId}:${screenId}:${quality}`. Hashing to a
// fixed hex digest gives us a URL- and storage-safe filename regardless of
// how the caller composed the key, and avoids any path-traversal foot-guns
// from raw client input.
function hashImageKey(key) {
  return crypto.createHash('sha256').update(String(key)).digest('hex');
}

function imageBlobPath(snapshotId, key) {
  return `${SNAPSHOT_PREFIX}${snapshotId}/images/${hashImageKey(key)}.json`;
}

// Strip dataUrl off an image record so we can store the metadata next to
// the project bundle without inlining the (large) base64 payload.
function imageMetadata(record) {
  if (!record || typeof record !== 'object') return null;
  const meta = { ...record };
  delete meta.dataUrl;
  return meta;
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
  const rawImages = Array.isArray(body?.images) ? body.images : [];
  const rawScreenImages = Array.isArray(body?.screenImages) ? body.screenImages : [];
  if (!project || typeof project !== 'object') {
    return json(res, 400, { error: 'missing_project' });
  }

  // Drop any dataUrl that snuck through — image blobs are uploaded
  // individually via `?id=...&image=1`. Storing dataUrl inline would just
  // bring back the size problem this split was meant to solve.
  const toRefs = (arr) =>
    arr
      .map(imageMetadata)
      .filter((m) => m && typeof m.key === 'string' && m.key.length > 0 && m.key.length <= IMAGE_KEY_MAX);
  const imageRefs = toRefs(rawImages);
  // Screen Inventory images live in a separate client IDB store and travel as
  // their own array, but they reuse the exact same per-image blob channel
  // (keyed by a hash of the image key, which never collides with a mockup key).
  const screenImageRefs = toRefs(rawScreenImages);

  const id = crypto.randomUUID();
  const manifest = {
    id,
    title: sanitizeTitle(body.title),
    projectName: typeof project?.project?.name === 'string' ? project.project.name : 'Untitled',
    createdAt: nowIso(),
    schemaVersion: CURRENT_SCHEMA_VERSION,
    imageCount: imageRefs.length,
    screenImageCount: screenImageRefs.length,
  };

  const data = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    manifest,
    project,
    // v2: images carry metadata only; the dataUrl for each lives in a
    // separate blob under snapshots/<id>/images/<hash>.json so that no
    // single request crosses the 4.5 MB serverless body cap.
    images: imageRefs,
    screenImages: screenImageRefs,
  };
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

// POST /api/snapshots?id=<id>&image=1
// Body: { image: MockupImageRecord }
// Writes one image to snapshots/<id>/images/<hash>.json. The data.json
// already records the metadata (key, screenId, etc.) — the per-image blob
// just carries the dataUrl so it can be fetched on demand at load time.
async function handleImagePost(id, req, res) {
  // Make sure the snapshot exists before writing under it, so a stray
  // image POST doesn't leave orphaned blobs behind.
  const blobs = await findBlobsForId(id);
  const dataBlob = blobs.find((b) => b.pathname.endsWith('/data.json'));
  if (!dataBlob) return json(res, 404, { error: 'not_found' });

  let body;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    if (err?.message === 'payload_too_large') {
      return json(res, 413, { error: 'payload_too_large', limitBytes: MAX_BODY_BYTES });
    }
    return json(res, 400, { error: 'invalid_json' });
  }

  const image = body?.image;
  if (!image || typeof image !== 'object') {
    return json(res, 400, { error: 'missing_image' });
  }
  if (typeof image.key !== 'string' || image.key.length === 0 || image.key.length > IMAGE_KEY_MAX) {
    return json(res, 400, { error: 'invalid_image_key' });
  }
  if (typeof image.dataUrl !== 'string' || !image.dataUrl.startsWith('data:')) {
    return json(res, 400, { error: 'invalid_image_dataurl' });
  }

  const payload = JSON.stringify({ key: image.key, image });
  await put(imageBlobPath(id, image.key), payload, {
    contentType: 'application/json',
    access: 'private',
    addRandomSuffix: false,
    // Allow overwrite so a partial save can be retried by re-running the
    // whole upload loop without first deleting any half-written images.
    allowOverwrite: true,
  });

  return json(res, 201, { id, key: image.key });
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

// Public counterpart to `handleGetImage` — looks up the image via the
// current demo pointer so anonymous viewers can hydrate the demo project's
// mockup images without an owner token.
async function handleGetDemoImage(key, res) {
  const pointer = await readDemoPointer();
  if (!pointer) return json(res, 404, { error: 'no_demo_set' });
  return await handleGetImage(pointer.snapshotId, key, res);
}

// Public, lightweight: return JUST the current demo pointer so clients can
// invalidate a cached demo project without paying the cost of downloading the
// full bundle + per-image blobs. Returns 200 with `{ snapshotId: null }` when
// no demo has been pinned so callers can distinguish "no demo" from a network
// failure without parsing 404s.
async function handleGetDemoPointer(res) {
  const pointer = await readDemoPointer();
  return json(res, 200, {
    snapshotId: pointer?.snapshotId ?? null,
    updatedAt: pointer?.updatedAt ?? null,
  });
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

// GET one per-image blob written by `handleImagePost`. The key is the
// caller-supplied image key (`${versionId}:${screenId}:${quality}`); we
// hash it to find the blob path.
async function handleGetImage(id, key, res) {
  if (typeof key !== 'string' || key.length === 0 || key.length > IMAGE_KEY_MAX) {
    return json(res, 400, { error: 'invalid_image_key' });
  }
  const path = imageBlobPath(id, key);
  const page = await list({ prefix: path });
  const blob = page.blobs.find((b) => b.pathname === path);
  if (!blob) return json(res, 404, { error: 'image_not_found' });
  try {
    const data = await fetchBlobJson(blob.url);
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

  // `image=1` (POST) flags a per-image upload; any other string value of
  // `image` is treated as the image key to fetch on GET.
  const imageQuery = typeof req.query?.image === 'string' ? req.query.image : null;
  const isImageUpload = req.method === 'POST' && imageQuery === '1';
  const imageReadKey = req.method === 'GET' && imageQuery !== null && imageQuery !== '1'
    ? imageQuery
    : null;

  // `pointer=1` is the lightweight demo-pointer probe — see
  // `handleGetDemoPointer`. Only meaningful on the demo channel.
  const isPointerProbe = req.query?.pointer === '1' || req.query?.pointer === 'true';

  try {
    if (isDemoChannel) {
      if (req.method === 'GET') {
        if (isPointerProbe) return await handleGetDemoPointer(res);
        if (imageReadKey !== null) return await handleGetDemoImage(imageReadKey, res);
        return await handleGetDemo(res);
      }
      if (req.method === 'PUT') return await handlePutDemo(id, res);
      return methodNotAllowed(res, ['GET', 'PUT']);
    }
    if (req.method === 'POST') {
      if (isImageUpload) {
        if (id === null) return json(res, 400, { error: 'missing_id' });
        return await handleImagePost(id, req, res);
      }
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
    if (imageReadKey !== null) return await handleGetImage(id, imageReadKey, res);
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
