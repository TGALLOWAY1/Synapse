import { runMongoAction } from './db.js';

// Server-side store for user-owned PRD projects. One document per project in the
// `projects` collection, keyed by the client-generated UUID (`id`) so the same
// project has the same primary key on every device — this makes upserts
// idempotent and prevents duplicate imports.
//
// ACCESS CONTROL (RLS-equivalent): MongoDB has no row-level security, so every
// function here takes `userId` as its first argument and includes `{ userId }`
// in the filter. There is no code path that reads or writes a project without
// the owner's id in the filter, so one user's query can never match another
// user's row. `userId` always comes from the verified session at the call site
// (requireUser) — never from a client-supplied value.

export const PROJECTS_COLLECTION = 'projects';

// Project ids are client UUIDs (uuidv4) plus a couple of stable constants (the
// demo project, legacy 'v1'-style ids). Keep this permissive but bounded.
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

const MAX_TITLE_LEN = 300;
const MAX_IDEA_LEN = 20000;

export function isValidProjectId(id) {
  return typeof id === 'string' && ID_RE.test(id);
}

// Fields surfaced in list views — deliberately excludes the heavy `data` bundle.
const SUMMARY_PROJECTION = {
  _id: 0,
  id: 1,
  title: 1,
  idea: 1,
  status: 1,
  archived: 1,
  deletedAt: 1,
  createdAt: 1,
  updatedAt: 1,
  revision: 1,
};

let indexPromise = null;

/**
 * Create the project indexes once per warm serverless instance. Idempotent —
 * createIndex is a no-op when an identical index already exists. Never throws
 * out to a request: a transient index-build hiccup must not break CRUD.
 */
export async function ensureProjectIndexes() {
  if (!indexPromise) {
    indexPromise = runMongoAction('createIndexes', {
      collection: PROJECTS_COLLECTION,
      indexes: [
        { key: { userId: 1, id: 1 }, unique: true, name: 'user_project_unique' },
        { key: { userId: 1, updatedAt: -1 }, name: 'user_updatedAt' },
        { key: { userId: 1, status: 1 }, name: 'user_status' },
        { key: { userId: 1, deletedAt: 1 }, name: 'user_deletedAt' },
      ],
    }).catch((error) => {
      // Reset so a later call can retry, but don't surface the failure.
      indexPromise = null;
      console.error('[projectsStore] ensureProjectIndexes failed', error?.name || 'error');
    });
  }
  return indexPromise;
}

function clampString(value, max) {
  if (typeof value !== 'string') return '';
  return value.length > max ? value.slice(0, max) : value;
}

/**
 * Derive the denormalized list/index fields from a bundle. Title comes from the
 * project name; idea from the originating prompt of the most recent spine.
 */
function deriveMeta(bundle) {
  const project = bundle?.project ?? {};
  const spines = Array.isArray(bundle?.spineVersions) ? bundle.spineVersions : [];
  const latest = spines.find((s) => s?.isLatest) || spines[spines.length - 1] || null;
  const idea = latest?.sourcePrompt || latest?.promptText || '';
  return {
    title: clampString(project?.name || 'Untitled project', MAX_TITLE_LEN),
    idea: clampString(idea, MAX_IDEA_LEN),
  };
}

/**
 * List a user's project summaries, newest-updated first. Soft-deleted and
 * archived projects are excluded unless explicitly requested.
 */
export async function listProjects(userId, { includeArchived = false, includeDeleted = false } = {}) {
  if (!userId) throw new Error('listProjects: userId is required');
  await ensureProjectIndexes();

  const filter = { userId };
  if (!includeDeleted) filter.deletedAt = null;
  if (!includeArchived) filter.status = 'active';

  const result = await runMongoAction('find', {
    collection: PROJECTS_COLLECTION,
    filter,
    projection: SUMMARY_PROJECTION,
    sort: { updatedAt: -1 },
  });
  return Array.isArray(result?.documents) ? result.documents : [];
}

/** Fetch one full project (including the bundle) the user owns, or null. */
export async function getProject(userId, projectId) {
  if (!userId) throw new Error('getProject: userId is required');
  if (!isValidProjectId(projectId)) return null;

  const result = await runMongoAction('findOne', {
    collection: PROJECTS_COLLECTION,
    filter: { userId, id: projectId },
    projection: { _id: 0 },
  });
  return result?.document ?? null;
}

/**
 * Create or update (upsert) a project from a client bundle. Covers PRD updates
 * and artifact saves — the whole project state is one bundle. Returns the saved
 * summary (including the new `revision`). The id is owner-scoped, so a client
 * can never overwrite another user's project even by guessing its id (the
 * filter pins `userId`).
 *
 * When `expectedRevision` is supplied and the stored revision has advanced past
 * it (a concurrent save on another device), this does NOT write — it returns
 * `{ conflict: true, currentRevision }` so the caller can surface a conflict
 * instead of clobbering the newer copy.
 */
export async function upsertProject(userId, projectId, bundle, { createdAt, expectedRevision } = {}) {
  if (!userId) throw new Error('upsertProject: userId is required');
  if (!isValidProjectId(projectId)) throw new Error('upsertProject: invalid project id');
  await ensureProjectIndexes();

  const now = new Date();
  const { title, idea } = deriveMeta(bundle);
  const archived = bundle?.project?.archived === true;
  const status = archived ? 'archived' : 'active';

  // Read the prior revision so we can return the new one (Mongo's updateOne
  // doesn't echo the incremented value). Also lets us reject a stale write when
  // the caller supplies the revision it expects to overwrite.
  const existing = await runMongoAction('findOne', {
    collection: PROJECTS_COLLECTION,
    filter: { userId, id: projectId },
    projection: { _id: 0, revision: 1 },
  });
  const priorRevision =
    typeof existing?.document?.revision === 'number' ? existing.document.revision : null;

  // Optimistic-concurrency guard: when the caller passes the revision it last
  // saw and the server has since advanced (another device saved), do NOT
  // overwrite — report the conflict so the client can resolve it. A brand-new
  // project (no existing row) skips the guard.
  if (
    typeof expectedRevision === 'number' &&
    priorRevision !== null &&
    priorRevision !== expectedRevision
  ) {
    return { conflict: true, currentRevision: priorRevision, id: projectId };
  }

  const result = await runMongoAction('updateOne', {
    collection: PROJECTS_COLLECTION,
    filter: { userId, id: projectId },
    update: {
      $set: {
        userId,
        id: projectId,
        title,
        idea,
        status,
        archived,
        deletedAt: null,
        data: bundle,
        updatedAt: now,
      },
      $setOnInsert: {
        createdAt: createdAt ? new Date(createdAt) : now,
      },
      $inc: { revision: 1 },
    },
    upsert: true,
  });

  const created = Boolean(result?.upsertedId);
  const revision = priorRevision === null ? 1 : priorRevision + 1;
  return { id: projectId, title, idea, status, archived, updatedAt: now, revision, created };
}

/**
 * Soft-delete a project (restorable). Sets a tombstone + archived status rather
 * than removing the row, so the data can be recovered. Returns true if a row
 * matched.
 */
export async function softDeleteProject(userId, projectId) {
  if (!userId) throw new Error('softDeleteProject: userId is required');
  if (!isValidProjectId(projectId)) return false;

  const now = new Date();
  const result = await runMongoAction('updateOne', {
    collection: PROJECTS_COLLECTION,
    filter: { userId, id: projectId },
    update: { $set: { deletedAt: now, status: 'archived', archived: true, updatedAt: now } },
  });
  return (result?.matchedCount ?? 0) > 0;
}

/** Restore a soft-deleted project. Returns true if a row matched. */
export async function restoreProject(userId, projectId) {
  if (!userId) throw new Error('restoreProject: userId is required');
  if (!isValidProjectId(projectId)) return false;

  const now = new Date();
  const result = await runMongoAction('updateOne', {
    collection: PROJECTS_COLLECTION,
    filter: { userId, id: projectId },
    update: { $set: { deletedAt: null, status: 'active', archived: false, updatedAt: now } },
  });
  return (result?.matchedCount ?? 0) > 0;
}

/** Toggle archive status without deleting. Returns true if a row matched. */
export async function setArchived(userId, projectId, archived) {
  if (!userId) throw new Error('setArchived: userId is required');
  if (!isValidProjectId(projectId)) return false;

  const now = new Date();
  const result = await runMongoAction('updateOne', {
    collection: PROJECTS_COLLECTION,
    filter: { userId, id: projectId },
    update: {
      $set: { archived: Boolean(archived), status: archived ? 'archived' : 'active', updatedAt: now },
    },
  });
  return (result?.matchedCount ?? 0) > 0;
}

/** Permanently remove a project. Returns true if a row was deleted. */
export async function hardDeleteProject(userId, projectId) {
  if (!userId) throw new Error('hardDeleteProject: userId is required');
  if (!isValidProjectId(projectId)) return false;

  const result = await runMongoAction('deleteOne', {
    collection: PROJECTS_COLLECTION,
    filter: { userId, id: projectId },
  });
  return (result?.deletedCount ?? 0) > 0;
}

/**
 * Bulk import bundles (idempotent on project id). Each bundle is upserted under
 * the owner's id, so re-importing the same local project updates rather than
 * duplicates. Returns per-id results so the client can mark which local
 * projects were migrated. Never throws for one bad bundle — it is skipped and
 * reported as failed.
 */
export async function importProjects(userId, bundles) {
  if (!userId) throw new Error('importProjects: userId is required');
  const list = Array.isArray(bundles) ? bundles : [];
  const imported = [];
  const failed = [];
  for (const bundle of list) {
    const projectId = bundle?.project?.id;
    if (!isValidProjectId(projectId)) {
      failed.push({ id: projectId ?? null, error: 'invalid_id' });
      continue;
    }
    try {
      const saved = await upsertProject(userId, projectId, bundle, {
        createdAt: bundle?.project?.createdAt,
      });
      imported.push({ id: projectId, created: saved.created });
    } catch (error) {
      failed.push({ id: projectId, error: error?.name || 'upsert_failed' });
    }
  }
  return { imported, failed };
}
