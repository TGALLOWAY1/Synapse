import { handleUpload } from '@vercel/blob/client';
import { del } from '@vercel/blob';
import { json, methodNotAllowed } from './_lib/response.js';
import { requireUser } from './_lib/requireUser.js';
import { enforceRateLimit } from './_lib/rateLimit.js';
import {
  isValidProjectId,
  listProjects,
  getProject,
  upsertProject,
  softDeleteProject,
  restoreProject,
  setArchived,
  hardDeleteProject,
  importProjects,
} from './_lib/projectsStore.js';
import {
  isValidImageKey,
  isValidRef,
  listImageRefs,
  upsertImageRef,
  deleteImageRefs,
  deleteRefsForProject,
} from './_lib/imageRefsStore.js';

// Server-side storage for a user's PRD projects. Every route is session-gated
// via requireUser and operates only on the authenticated user's own projects —
// identity comes from the verified session cookie, never a client-supplied id.
//
//   GET    /api/projects                     -> list summaries (?includeArchived, ?includeDeleted)
//   GET    /api/projects?id=<id>             -> one full project (bundle included)
//   PUT    /api/projects?id=<id>             -> create/update from a bundle
//   POST   /api/projects?action=import       -> bulk import bundles (idempotent on id)
//   POST   /api/projects?action=restore&id=  -> restore a soft-deleted project
//   POST   /api/projects?action=archive&id=  -> archive (status only)
//   POST   /api/projects?action=unarchive&id=-> unarchive
//   DELETE /api/projects?id=<id>             -> soft-delete (default) or &hard=1 to remove
//
// Cross-device mockup-image sync (image BYTES live in Vercel Blob, only small
// refs live in Mongo — see api/_lib/imageRefsStore.js). Folded in here via
// ?action= so we don't exceed Vercel Hobby's 12-serverless-function cap:
//   POST   /api/projects?action=image-upload-token  -> mint a client-direct Blob upload token
//   GET    /api/projects?action=image-refs&id=<id>  -> list a project's image refs
//   POST   /api/projects?action=image-ref-put&id=<id>    -> persist one ref after upload
//   POST   /api/projects?action=image-ref-delete&id=<id> -> delete refs (refcount-GCs orphan blobs)

const MAX_BODY_BYTES = 8 * 1024 * 1024; // 8MB — bundles are text-only (no images)

// Client-direct Blob uploads: the PNG bytes go browser -> Blob and never
// traverse this function body, so the request/response stay text-sized. These
// bound the signed token, not the function body.
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

function blobNotConfigured(res) {
  console.error('[projects] BLOB_READ_WRITE_TOKEN is not set on this deployment.');
  return json(res, 503, {
    error: 'blob_not_configured',
    message:
      'Vercel Blob is not connected to this project. In the Vercel dashboard go to Storage, then connect the Blob store to this project (this adds BLOB_READ_WRITE_TOKEN to the environment), then redeploy.',
  });
}

// Derive the mockup routing fields from a composite key so a ref persisted only
// by the (server-to-server) onUploadCompleted callback — which carries no full
// metadata — is still hydratable. Mockup keys are `versionId:screenId:quality`.
function routingFromKey(key) {
  const parts = String(key).split(':');
  if (parts.length < 3) return {};
  const quality = parts[parts.length - 1];
  const screenId = parts[parts.length - 2];
  const versionId = parts.slice(0, parts.length - 2).join(':');
  return { versionId, screenId, quality };
}

// Mint a client-direct upload token (and handle the upload-completed callback).
// This runs BEFORE the global requireUser gate because the completion callback
// is a server-to-server request from Vercel Blob that carries no session
// cookie — handleUpload verifies its signature instead, and the userId is taken
// from the tokenPayload we stamped (from the verified session) at token-gen time.
async function handleImageUploadToken(req, res) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return blobNotConfigured(res);

  let body;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    if (error?.code === 'payload_too_large') {
      return json(res, 413, { error: 'payload_too_large', limitBytes: MAX_BODY_BYTES });
    }
    return json(res, 400, { error: 'invalid_json' });
  }

  // The token-generation request comes from the browser with the session
  // cookie; authenticate it. The completion callback does not — skip auth there.
  let tokenUserId = null;
  if (body?.type === 'blob.generate-client-token') {
    const user = await requireUser(req, res);
    if (!user) return; // 401 already sent
    tokenUserId = user.userId;
  }

  try {
    const result = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        // Pin uploads to the caller's own per-user prefix — a client can never
        // mint a token for another user's path or an arbitrary content type.
        const prefix = `users/${tokenUserId}/mockup-images/`;
        if (!tokenUserId || !pathname.startsWith(prefix)) {
          throw new Error('forbidden_pathname');
        }
        let meta = {};
        try {
          meta = clientPayload ? JSON.parse(clientPayload) : {};
        } catch {
          meta = {};
        }
        return {
          addRandomSuffix: false,
          allowOverwrite: true,
          maximumSizeInBytes: MAX_IMAGE_BYTES,
          allowedContentTypes: ALLOWED_IMAGE_TYPES,
          // Stamp the server-derived identity so the (unauthenticated) callback
          // can attribute the upload. Kept small — the client's image-ref-put
          // persists the full ref; this is only a tab-closed-early backup.
          tokenPayload: JSON.stringify({
            userId: tokenUserId,
            projectId: meta.projectId ?? null,
            key: meta.key ?? null,
            hash: meta.hash ?? null,
            kind: meta.kind ?? 'mockup',
            byteSize: meta.byteSize ?? 0,
          }),
        };
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        // Best-effort backup persistence. The client's image-ref-put is the
        // authoritative path (and the only one that fires on localhost, where
        // Vercel can't reach this callback). Idempotent upsert, so both is fine.
        try {
          const parsed = tokenPayload ? JSON.parse(tokenPayload) : {};
          const { userId, projectId, key, hash, kind, byteSize } = parsed;
          if (userId && projectId && isValidImageKey(key) && hash) {
            await upsertImageRef(userId, projectId, {
              key,
              hash,
              blobUrl: blob.url,
              byteSize: byteSize || 0,
              kind: kind || 'mockup',
              meta: {},
              ...(kind === 'mockup' || !kind ? routingFromKey(key) : {}),
            });
          }
        } catch (error) {
          console.error('[projects] onUploadCompleted failed', error?.name || 'error');
        }
      },
    });
    return json(res, 200, result);
  } catch (error) {
    if (error?.message === 'forbidden_pathname') {
      return json(res, 403, { error: 'forbidden_pathname' });
    }
    console.error('[projects] image-upload-token failed', error?.name || 'error');
    return json(res, 500, { error: 'image_token_failed' });
  }
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    return req.body;
  }
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
    total += buf.length;
    if (total > MAX_BODY_BYTES) {
      const err = new Error('payload_too_large');
      err.code = 'payload_too_large';
      throw err;
    }
    chunks.push(buf);
  }
  if (chunks.length === 0) return {};
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function truthy(value) {
  return value === '1' || value === 'true';
}

// Best-effort Blob deletion for GC. Failures are logged, never fatal — an
// orphaned blob is harmless (just storage), whereas throwing here would break
// the user-facing delete. No-op when Blob isn't configured.
async function deleteBlobs(urls) {
  if (!Array.isArray(urls) || urls.length === 0) return;
  if (!process.env.BLOB_READ_WRITE_TOKEN) return;
  try {
    await del(urls);
  } catch (error) {
    console.error('[projects] blob GC failed', error?.name || 'error');
  }
}

export default async function handler(req, res) {
  if (!['GET', 'PUT', 'POST', 'DELETE'].includes(req.method)) {
    return methodNotAllowed(res, ['GET', 'PUT', 'POST', 'DELETE']);
  }

  if (enforceRateLimit(req, res, { scope: 'projects', limit: 120, windowMs: 60_000 })) {
    return; // 429 already sent
  }

  const id = req.query?.id ?? null;
  const action = req.query?.action ?? null;

  // image-upload-token must run before requireUser: its upload-completed
  // callback is a signed server-to-server request with no session cookie.
  if (req.method === 'POST' && action === 'image-upload-token') {
    return handleImageUploadToken(req, res);
  }

  const user = await requireUser(req, res);
  if (!user) return; // 401 already sent

  const userId = user.userId;

  try {
    if (req.method === 'GET') {
      if (action === 'image-refs') {
        if (!isValidProjectId(id)) return json(res, 400, { error: 'invalid_id' });
        const refs = await listImageRefs(userId, id);
        return json(res, 200, { refs });
      }
      if (id) {
        if (!isValidProjectId(id)) return json(res, 400, { error: 'invalid_id' });
        const project = await getProject(userId, id);
        if (!project) return json(res, 404, { error: 'not_found' });
        return json(res, 200, { project });
      }
      const projects = await listProjects(userId, {
        includeArchived: truthy(req.query?.includeArchived),
        includeDeleted: truthy(req.query?.includeDeleted),
      });
      return json(res, 200, { projects });
    }

    if (req.method === 'PUT') {
      if (!isValidProjectId(id)) return json(res, 400, { error: 'invalid_id' });
      const body = await readJsonBody(req);
      const bundle = body?.bundle ?? body;
      if (!bundle || typeof bundle !== 'object' || !bundle.project) {
        return json(res, 400, { error: 'invalid_bundle' });
      }
      // The project id is owner-scoped on the server; ignore any id in the body
      // that disagrees with the URL.
      //
      // Optimistic concurrency: if the client tells us which server revision it
      // expects to overwrite (its last-seen baseline) and the server has since
      // advanced on another device, reject with 409 instead of clobbering the
      // newer copy. A first-time save (no expectedRevision) is unaffected.
      const expectedRaw = req.query?.expectedRevision;
      const expectedRevision =
        expectedRaw !== undefined && expectedRaw !== '' && Number.isFinite(Number(expectedRaw))
          ? Number(expectedRaw)
          : undefined;
      // Fallback guard for legacy rows that predate the revision counter: the
      // client sends the updatedAt it last saw instead.
      const expectedUpdatedAtRaw = req.query?.expectedUpdatedAt;
      const expectedUpdatedAt =
        typeof expectedUpdatedAtRaw === 'string' && expectedUpdatedAtRaw ? expectedUpdatedAtRaw : undefined;
      const saved = await upsertProject(userId, id, bundle, { expectedRevision, expectedUpdatedAt });
      if (saved?.conflict) {
        return json(res, 409, {
          error: 'revision_conflict',
          currentRevision: saved.currentRevision,
          id,
        });
      }
      return json(res, 200, { project: saved });
    }

    if (req.method === 'POST') {
      if (action === 'import') {
        const body = await readJsonBody(req);
        const bundles = Array.isArray(body?.bundles) ? body.bundles : [];
        const result = await importProjects(userId, bundles);
        return json(res, 200, result);
      }
      if (action === 'image-ref-put') {
        if (!isValidProjectId(id)) return json(res, 400, { error: 'invalid_id' });
        const body = await readJsonBody(req);
        const ref = body?.ref ?? body;
        if (!isValidRef(ref)) return json(res, 400, { error: 'invalid_ref' });
        // The blobUrl must point inside the caller's own per-user prefix — never
        // trust an arbitrary client-supplied URL into the ref store.
        if (!ref.blobUrl.includes(`/users/${userId}/mockup-images/`)) {
          return json(res, 403, { error: 'forbidden_blob_url' });
        }
        const saved = await upsertImageRef(userId, id, ref);
        return json(res, 200, { ref: saved });
      }
      if (action === 'image-ref-delete') {
        if (!isValidProjectId(id)) return json(res, 400, { error: 'invalid_id' });
        const body = await readJsonBody(req);
        const keys = Array.isArray(body?.keys) ? body.keys : [];
        const { deletedCount, orphanedBlobUrls } = await deleteImageRefs(userId, id, keys);
        await deleteBlobs(orphanedBlobUrls);
        return json(res, 200, { deletedCount, orphanedBlobs: orphanedBlobUrls.length });
      }
      if (!isValidProjectId(id)) return json(res, 400, { error: 'invalid_id' });
      if (action === 'restore') {
        const ok = await restoreProject(userId, id);
        return ok ? json(res, 200, { id, restored: true }) : json(res, 404, { error: 'not_found' });
      }
      if (action === 'archive') {
        const ok = await setArchived(userId, id, true);
        return ok ? json(res, 200, { id, archived: true }) : json(res, 404, { error: 'not_found' });
      }
      if (action === 'unarchive') {
        const ok = await setArchived(userId, id, false);
        return ok ? json(res, 200, { id, archived: false }) : json(res, 404, { error: 'not_found' });
      }
      return json(res, 400, { error: 'unknown_action' });
    }

    // DELETE
    if (!isValidProjectId(id)) return json(res, 400, { error: 'invalid_id' });
    if (truthy(req.query?.hard)) {
      const ok = await hardDeleteProject(userId, id);
      // GC the project's image refs + any blobs they orphaned. Best-effort:
      // a GC failure must not fail the project delete.
      try {
        const { orphanedBlobUrls } = await deleteRefsForProject(userId, id);
        await deleteBlobs(orphanedBlobUrls);
      } catch (error) {
        console.error('[projects] image GC on hard-delete failed', error?.name || 'error');
      }
      return ok ? json(res, 200, { id, deleted: true }) : json(res, 404, { error: 'not_found' });
    }
    const ok = await softDeleteProject(userId, id);
    return ok ? json(res, 200, { id, deleted: true, soft: true }) : json(res, 404, { error: 'not_found' });
  } catch (error) {
    if (error?.code === 'payload_too_large') {
      return json(res, 413, { error: 'payload_too_large', limitBytes: MAX_BODY_BYTES });
    }
    // Never echo error detail — it could contain request data.
    console.error('[projects]', error?.name || 'error');
    return json(res, 500, { error: 'projects_failed' });
  }
}
