import crypto from 'crypto';
import { put, list, del } from '@vercel/blob';
import { json, methodNotAllowed } from './_lib/response.js';
import { readJsonBody } from './_lib/body.js';
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
// Project gallery (the multi-project upgrade of the single demo). The owner
// pins up to GALLERY_SIZE snapshots into an ordered list and then flips the
// showcase mode from 'demo' to 'gallery' — the mode toggle is the go-live
// switch, and the server refuses to flip it until every slot is filled:
//
//   GET    /api/snapshots?gallery=1                    -> gallery state + entry summaries (PUBLIC)
//   GET    /api/snapshots?gallery=1&pointer=1          -> raw gallery pointer, no manifest joins (PUBLIC)
//   GET    /api/snapshots?gallery=1&slot=N             -> load one gallery snapshot bundle (PUBLIC)
//   GET    /api/snapshots?gallery=1&slot=N&image=<key> -> load one gallery image (PUBLIC)
//   PUT    /api/snapshots?gallery=1&id=<id>            -> add a snapshot to the gallery (owner)
//   PUT    /api/snapshots?gallery=1&id=<id>&remove=1   -> remove a snapshot from the gallery (owner)
//   PUT    /api/snapshots?gallery=1&mode=<demo|gallery>-> switch showcase mode (owner; 'gallery'
//                                                        requires all GALLERY_SIZE slots filled)
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
const GALLERY_POINTER_PATH = 'snapshots/_gallery.json';
// The public showcase is either the single pinned demo ('demo', the default)
// or the project gallery ('gallery'). Gallery mode only goes live when the
// owner has pinned a full set of GALLERY_SIZE snapshots and explicitly
// toggled the mode — handlePutGalleryMode enforces the "full set" half.
const GALLERY_SIZE = 6;
const GALLERY_MODES = ['demo', 'gallery'];
const ID_RE = /^[0-9a-f-]{8,64}$/i;
const IMAGE_KEY_MAX = 512;
const CURRENT_SCHEMA_VERSION = 2;

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

// Read the gallery pointer blob, which holds the showcase mode plus the
// ordered list of snapshot ids pinned into the gallery. A missing or
// malformed pointer means "gallery never configured": demo mode, no entries.
async function readGalleryPointer() {
  const fallback = { mode: 'demo', snapshotIds: [], updatedAt: null };
  const page = await list({ prefix: GALLERY_POINTER_PATH });
  const blob = page.blobs.find((b) => b.pathname === GALLERY_POINTER_PATH);
  if (!blob) return fallback;
  try {
    const body = await fetchBlobJson(blob.url);
    const mode = GALLERY_MODES.includes(body?.mode) ? body.mode : 'demo';
    const snapshotIds = (Array.isArray(body?.snapshotIds) ? body.snapshotIds : [])
      .filter((id) => typeof id === 'string' && ID_RE.test(id))
      .slice(0, GALLERY_SIZE);
    return { mode, snapshotIds, updatedAt: body?.updatedAt ?? null };
  } catch {
    return fallback;
  }
}

async function writeGalleryPointer(mode, snapshotIds) {
  const payload = JSON.stringify({ mode, snapshotIds, updatedAt: nowIso() });
  await put(GALLERY_POINTER_PATH, payload, {
    contentType: 'application/json',
    access: 'private',
    addRandomSuffix: false,
    allowOverwrite: true,
  });
}

async function handlePost(req, res) {
  let body;
  try {
    body = await readJsonBody(req, { maxBytes: MAX_BODY_BYTES });
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

  // SYN-003: sanitize the client-reported completeness counters to non-negative
  // integers so the pin-time gate (handlePutDemo) can trust them.
  const nonNegInt = (value) => {
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
  };

  const id = crypto.randomUUID();
  const manifest = {
    id,
    title: sanitizeTitle(body.title),
    projectName: typeof project?.project?.name === 'string' ? project.project.name : 'Untitled',
    createdAt: nowIso(),
    schemaVersion: CURRENT_SCHEMA_VERSION,
    imageCount: imageRefs.length,
    screenImageCount: screenImageRefs.length,
    mockupScreenCount: nonNegInt(body.mockupScreenCount),
    variantImageCount: nonNegInt(body.variantImageCount),
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
    body = await readJsonBody(req, { maxBytes: MAX_BODY_BYTES });
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
  const [summaries, pointer, gallery] = await Promise.all([
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
    readGalleryPointer(),
  ]);

  const demoId = pointer?.snapshotId ?? null;
  for (const m of summaries) {
    m.isDemo = m.id === demoId;
  }

  summaries.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
  return json(res, 200, {
    snapshots: summaries,
    demoSnapshotId: demoId,
    gallery: { mode: gallery.mode, snapshotIds: gallery.snapshotIds, size: GALLERY_SIZE },
  });
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

// SYN-003: server backstop for the pin-time completeness gate (the client
// hard-blocks too). A publicly pinned snapshot whose mockup spec claims
// screens but carries zero rendered image blobs would render "Generated"
// cards with no images — refuse to pin it, whether the pin target is the
// single demo or a gallery slot. Count the per-image blobs (under
// `.../images/`) and cross-check the manifest's mockupScreenCount. Legacy
// manifests (no mockupScreenCount) pass here — the client gate covers them.
//
// Returns `{ error: { status, body } }` when the pin must be rejected, or
// `{ error: null }` when the snapshot exists and may be pinned.
async function pinGateError(id) {
  const blobs = await findBlobsForId(id);
  const exists = blobs.some((b) => b.pathname.endsWith('/data.json'));
  if (!exists) return { error: { status: 404, body: { error: 'not_found' } } };

  const imageBlobCount = blobs.filter((b) => b.pathname.includes('/images/')).length;
  if (imageBlobCount === 0) {
    const manifestBlob = blobs.find((b) => b.pathname.endsWith('/manifest.json'));
    if (manifestBlob) {
      let manifest = null;
      try {
        manifest = await fetchBlobJson(manifestBlob.url);
      } catch {
        manifest = null; // unreadable manifest → don't block on a transient read error
      }
      if (manifest && Number(manifest.mockupScreenCount) > 0) {
        return {
          error: {
            status: 422,
            body: {
              error: 'demo_snapshot_incomplete',
              message:
                `This snapshot's mockup spec describes ${Number(manifest.mockupScreenCount)} screen(s) `
                + 'but contains 0 rendered mockup images, so the demo would claim mockups it cannot show. '
                + 'Generate the mockup images, save a new snapshot, and pin that one instead.',
            },
          },
        };
      }
    }
  }
  return { error: null };
}

async function handlePutDemo(id, res) {
  // PUT /api/snapshots?demo=1&id=<id>  -> set pointer
  // PUT /api/snapshots?demo=1          -> clear pointer
  if (id === null) {
    await clearDemoPointer();
    return json(res, 200, { demoSnapshotId: null });
  }
  // Verify the target snapshot exists (and passes the SYN-003 completeness
  // gate) before we update the pointer, so we don't leave a dangling or
  // image-less reference.
  const { error } = await pinGateError(id);
  if (error) return json(res, error.status, error.body);

  await writeDemoPointer(id);
  return json(res, 200, { demoSnapshotId: id });
}

// PUT /api/snapshots?gallery=1&id=<id>          -> add to the gallery
// PUT /api/snapshots?gallery=1&id=<id>&remove=1 -> remove from the gallery
async function handlePutGalleryEntry(id, remove, res) {
  const pointer = await readGalleryPointer();
  const snapshotIds = [...pointer.snapshotIds];

  if (remove) {
    const idx = snapshotIds.indexOf(id);
    if (idx === -1) return json(res, 404, { error: 'not_in_gallery' });
    snapshotIds.splice(idx, 1);
    // Removing a slot can leave the gallery below the go-live threshold. The
    // mode deliberately stays as-is (the owner may be swapping an entry out
    // for a better one); the client surfaces the below-capacity state.
    await writeGalleryPointer(pointer.mode, snapshotIds);
    return json(res, 200, { mode: pointer.mode, snapshotIds, size: GALLERY_SIZE });
  }

  if (snapshotIds.includes(id)) {
    return json(res, 409, { error: 'already_in_gallery' });
  }
  if (snapshotIds.length >= GALLERY_SIZE) {
    return json(res, 409, {
      error: 'gallery_full',
      message: `The gallery already holds ${GALLERY_SIZE} snapshots. Remove one before adding another.`,
    });
  }
  // Same existence + SYN-003 completeness gate as pinning the demo — a
  // gallery slot is just as public as the demo pointer.
  const { error } = await pinGateError(id);
  if (error) return json(res, error.status, error.body);

  snapshotIds.push(id);
  await writeGalleryPointer(pointer.mode, snapshotIds);
  return json(res, 200, { mode: pointer.mode, snapshotIds, size: GALLERY_SIZE });
}

// PUT /api/snapshots?gallery=1&mode=<demo|gallery>
// The go-live switch. Flipping TO 'gallery' is refused until every slot is
// filled with a snapshot that still exists — this is what keeps the gallery
// invisible to visitors until the owner has saved all six snapshots and
// explicitly toggled.
async function handlePutGalleryMode(mode, res) {
  if (!GALLERY_MODES.includes(mode)) {
    return json(res, 400, { error: 'invalid_mode' });
  }
  const pointer = await readGalleryPointer();
  if (mode === 'gallery') {
    if (pointer.snapshotIds.length < GALLERY_SIZE) {
      return json(res, 422, {
        error: 'gallery_not_ready',
        message:
          `Gallery mode needs all ${GALLERY_SIZE} slots filled before it can go live `
          + `(currently ${pointer.snapshotIds.length}/${GALLERY_SIZE}).`,
      });
    }
    // Verify every pinned snapshot still resolves — a slot whose snapshot was
    // deleted since it was added must not go live as an empty card.
    for (const snapshotId of pointer.snapshotIds) {
      const blobs = await findBlobsForId(snapshotId);
      if (!blobs.some((b) => b.pathname.endsWith('/data.json'))) {
        return json(res, 422, {
          error: 'gallery_not_ready',
          message: `Gallery snapshot ${snapshotId} no longer exists. Remove it and pin a replacement before going live.`,
        });
      }
    }
  }
  await writeGalleryPointer(mode, pointer.snapshotIds);
  return json(res, 200, { mode, snapshotIds: pointer.snapshotIds, size: GALLERY_SIZE });
}

// Public, lightweight: the raw gallery pointer with no manifest joins. The
// client uses this both to decide which entry UI to show (demo button vs
// gallery) and as the per-slot freshness probe before reusing a cached
// gallery project — the gallery counterpart of `handleGetDemoPointer`.
async function handleGetGalleryPointer(res) {
  const pointer = await readGalleryPointer();
  return json(res, 200, {
    mode: pointer.mode,
    snapshotIds: pointer.snapshotIds,
    size: GALLERY_SIZE,
    updatedAt: pointer.updatedAt,
  });
}

// Public: gallery state joined with each entry's manifest summary so the
// gallery page can render cards (title, project name, image counts) without
// downloading any bundle. An entry whose manifest can't be read right now is
// kept with its id only — better a sparse card than a vanishing slot.
async function handleGetGallery(res) {
  const pointer = await readGalleryPointer();
  const entries = await Promise.all(pointer.snapshotIds.map(async (snapshotId, slot) => {
    const base = { slot, snapshotId };
    try {
      const page = await list({ prefix: `${SNAPSHOT_PREFIX}${snapshotId}/manifest.json` });
      const blob = page.blobs.find((b) => b.pathname === `${SNAPSHOT_PREFIX}${snapshotId}/manifest.json`);
      if (!blob) return base;
      const manifest = await fetchBlobJson(blob.url);
      return {
        ...base,
        title: manifest?.title,
        projectName: manifest?.projectName,
        createdAt: manifest?.createdAt,
        imageCount: manifest?.imageCount,
        screenImageCount: manifest?.screenImageCount,
        mockupScreenCount: manifest?.mockupScreenCount,
        variantImageCount: manifest?.variantImageCount,
        sizeBytes: manifest?.sizeBytes,
      };
    } catch {
      return base;
    }
  }));
  return json(res, 200, {
    mode: pointer.mode,
    size: GALLERY_SIZE,
    entries,
    updatedAt: pointer.updatedAt,
  });
}

// Resolve a gallery slot number to its pinned snapshot id, or null when the
// slot is out of range / empty. Slots are 0-based positions in the pointer's
// ordered id list.
async function resolveGallerySlot(slotQuery) {
  const slot = Number(slotQuery);
  if (!Number.isInteger(slot) || slot < 0 || slot >= GALLERY_SIZE) return null;
  const pointer = await readGalleryPointer();
  return pointer.snapshotIds[slot] ?? null;
}

// Public: serve one gallery snapshot's bundle by slot. Deliberately NOT gated
// on mode === 'gallery': the owner needs to preview each slot's project
// before flipping the go-live toggle, and slot URLs are only *discoverable*
// once the client surfaces the gallery (which it does gate on mode).
async function handleGetGallerySlot(slotQuery, res) {
  const snapshotId = await resolveGallerySlot(slotQuery);
  if (!snapshotId) return json(res, 404, { error: 'no_gallery_slot' });
  return await handleGetOne(snapshotId, res);
}

// Public counterpart of `handleGetDemoImage` for gallery slots.
async function handleGetGallerySlotImage(slotQuery, key, res) {
  const snapshotId = await resolveGallerySlot(slotQuery);
  if (!snapshotId) return json(res, 404, { error: 'no_gallery_slot' });
  return await handleGetImage(snapshotId, key, res);
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
  // Scrub the deleted snapshot out of the gallery pointer so a slot never
  // dangles. Best-effort: a failed scrub is tolerated because every gallery
  // read path already survives a dangling id (slot loads 404, the go-live
  // toggle re-verifies existence).
  try {
    const gallery = await readGalleryPointer();
    if (gallery.snapshotIds.includes(id)) {
      await writeGalleryPointer(gallery.mode, gallery.snapshotIds.filter((s) => s !== id));
    }
  } catch (err) {
    console.warn('[snapshots] failed to scrub deleted snapshot from gallery pointer', err);
  }
  return json(res, 200, { id, deleted: blobs.length });
}

export default async function handler(req, res) {
  if (!['GET', 'POST', 'PUT', 'DELETE'].includes(req.method)) {
    return methodNotAllowed(res, ['GET', 'POST', 'PUT', 'DELETE']);
  }

  // `?demo=1` is the public-demo channel and `?gallery=1` is the public
  // project-gallery channel. GET is anonymous on both (so any visitor can
  // load the showcase), but PUT (pointer/mode writes) is owner-only. Every
  // other route stays owner-gated as before.
  const isDemoChannel = req.query?.demo === '1' || req.query?.demo === 'true';
  const isGalleryChannel = req.query?.gallery === '1' || req.query?.gallery === 'true';
  const isPublicDemoRead = (isDemoChannel || isGalleryChannel) && req.method === 'GET';

  // The public demo read gets its own, larger budget: one cache-less demo
  // load is a legitimate burst of `2 + imageCount + screenImageCount`
  // requests (pointer + bundle + one fetch per image), so an image-rich demo
  // would trip a 60/min cap on exactly the devices with no cache (mobile) and
  // silently fall back to a stale copy. Owner-token routes keep the tight cap.
  const rateOptions = isPublicDemoRead
    ? { scope: 'snapshots-demo', limit: 300, windowMs: 60_000 }
    : { scope: 'snapshots', limit: 60, windowMs: 60_000 };
  if (enforceRateLimit(req, res, { ...rateOptions, errorBody: { error: 'rate_limited' } })) {
    return;
  }
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
    if (isGalleryChannel) {
      const slotQuery = typeof req.query?.slot === 'string' ? req.query.slot : null;
      if (req.method === 'GET') {
        if (isPointerProbe) return await handleGetGalleryPointer(res);
        if (slotQuery !== null && imageReadKey !== null) {
          return await handleGetGallerySlotImage(slotQuery, imageReadKey, res);
        }
        if (slotQuery !== null) return await handleGetGallerySlot(slotQuery, res);
        return await handleGetGallery(res);
      }
      if (req.method === 'PUT') {
        const mode = typeof req.query?.mode === 'string' ? req.query.mode : null;
        if (mode !== null) return await handlePutGalleryMode(mode, res);
        if (id === null) return json(res, 400, { error: 'missing_id' });
        const remove = req.query?.remove === '1' || req.query?.remove === 'true';
        return await handlePutGalleryEntry(id, remove, res);
      }
      return methodNotAllowed(res, ['GET', 'PUT']);
    }
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
