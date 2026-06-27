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

const MAX_BODY_BYTES = 8 * 1024 * 1024; // 8MB — bundles are text-only (no images)

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

export default async function handler(req, res) {
  if (!['GET', 'PUT', 'POST', 'DELETE'].includes(req.method)) {
    return methodNotAllowed(res, ['GET', 'PUT', 'POST', 'DELETE']);
  }

  if (enforceRateLimit(req, res, { scope: 'projects', limit: 120, windowMs: 60_000 })) {
    return; // 429 already sent
  }

  const user = await requireUser(req, res);
  if (!user) return; // 401 already sent

  const userId = user.userId;
  const id = req.query?.id ?? null;
  const action = req.query?.action ?? null;

  try {
    if (req.method === 'GET') {
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
      const saved = await upsertProject(userId, id, bundle);
      return json(res, 200, { project: saved });
    }

    if (req.method === 'POST') {
      if (action === 'import') {
        const body = await readJsonBody(req);
        const bundles = Array.isArray(body?.bundles) ? body.bundles : [];
        const result = await importProjects(userId, bundles);
        return json(res, 200, result);
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
