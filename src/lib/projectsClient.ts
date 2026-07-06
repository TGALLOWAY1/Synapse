// Client transport for the server-side project store (`/api/projects`).
//
// Every request sends the session cookie (`credentials: 'include'`); identity is
// resolved server-side from that cookie. A non-2xx response throws so the sync
// layer can distinguish a real failure (keep local data, show "Sync failed")
// from a clean empty result — it never silently drops projects.

import type { ProjectBundle } from './projectBundle';

const API_BASE = '/api/projects';

export interface ServerProjectSummary {
  id: string;
  title: string;
  idea: string;
  status: 'active' | 'archived';
  archived: boolean;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
  revision: number;
}

export interface ServerProject extends ServerProjectSummary {
  userId: string;
  data: ProjectBundle;
}

export interface ImportResult {
  imported: Array<{ id: string; created: boolean }>;
  failed: Array<{ id: string | null; error: string }>;
}

async function parseError(resp: Response, fallback: string): Promise<Error> {
  let body: { error?: string; message?: string } | null = null;
  try {
    body = (await resp.json()) as { error?: string; message?: string };
  } catch {
    body = null;
  }
  const code = body?.error || `${fallback}_${resp.status}`;
  const err = new Error(body?.message ? `${code}: ${body.message}` : code);
  (err as Error & { code?: string; status?: number }).code = body?.error || fallback;
  (err as Error & { status?: number }).status = resp.status;
  return err;
}

async function requestJson<T>(url: string, init: RequestInit, fallback: string): Promise<T> {
  const resp = await fetch(url, { credentials: 'include', ...init });
  if (!resp.ok) throw await parseError(resp, fallback);
  return (await resp.json()) as T;
}

/** List the signed-in user's project summaries (no heavy bundle). */
export async function fetchProjectList(
  opts: { includeArchived?: boolean; includeDeleted?: boolean } = {},
): Promise<ServerProjectSummary[]> {
  const params = new URLSearchParams();
  if (opts.includeArchived) params.set('includeArchived', '1');
  if (opts.includeDeleted) params.set('includeDeleted', '1');
  const qs = params.toString();
  const data = await requestJson<{ projects: ServerProjectSummary[] }>(
    qs ? `${API_BASE}?${qs}` : API_BASE,
    { method: 'GET' },
    'list_failed',
  );
  return Array.isArray(data.projects) ? data.projects : [];
}

/** Fetch one full project (bundle included), or null if it isn't the user's. */
export async function fetchProject(id: string): Promise<ServerProject | null> {
  const resp = await fetch(`${API_BASE}?id=${encodeURIComponent(id)}`, {
    method: 'GET',
    credentials: 'include',
  });
  if (resp.status === 404) return null;
  if (!resp.ok) throw await parseError(resp, 'fetch_failed');
  const data = (await resp.json()) as { project: ServerProject };
  return data.project ?? null;
}

/** Raised when a conditional save is rejected because the server copy advanced
 *  on another device. Carries the current server revision so the client can
 *  mark the project as conflicted. */
export class RevisionConflictError extends Error {
  code = 'revision_conflict' as const;
  currentRevision?: number;
  constructor(currentRevision?: number) {
    super('revision_conflict');
    this.name = 'RevisionConflictError';
    this.currentRevision = currentRevision;
  }
}

/**
 * Create-or-update (upsert) a project from a bundle. When `expectedRevision` is
 * supplied, the save is conditional: the server rejects it (throwing
 * `RevisionConflictError`) if the stored revision no longer matches, so a stale
 * client can't blindly overwrite a newer copy saved on another device.
 */
export async function saveProject(
  id: string,
  bundle: ProjectBundle,
  opts: { expectedRevision?: number } = {},
): Promise<ServerProjectSummary> {
  const params = new URLSearchParams({ id });
  if (typeof opts.expectedRevision === 'number') {
    params.set('expectedRevision', String(opts.expectedRevision));
  }
  const resp = await fetch(`${API_BASE}?${params.toString()}`, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bundle }),
  });
  if (resp.status === 409) {
    let body: { currentRevision?: number } | null = null;
    try {
      body = (await resp.json()) as { currentRevision?: number };
    } catch {
      body = null;
    }
    throw new RevisionConflictError(body?.currentRevision);
  }
  if (!resp.ok) throw await parseError(resp, 'save_failed');
  const data = (await resp.json()) as { project: ServerProjectSummary };
  return data.project;
}

/** Soft-delete (default) or permanently remove (`hard`) a project. */
export async function deleteProject(id: string, opts: { hard?: boolean } = {}): Promise<void> {
  const url = `${API_BASE}?id=${encodeURIComponent(id)}${opts.hard ? '&hard=1' : ''}`;
  const resp = await fetch(url, { method: 'DELETE', credentials: 'include' });
  // 404 is fine — the project is already gone server-side.
  if (!resp.ok && resp.status !== 404) throw await parseError(resp, 'delete_failed');
}

/** Restore a soft-deleted project. */
export async function restoreProject(id: string): Promise<void> {
  await requestJson(
    `${API_BASE}?action=restore&id=${encodeURIComponent(id)}`,
    { method: 'POST' },
    'restore_failed',
  );
}

/** Set/clear a project's archived status without deleting it. */
export async function setProjectArchived(id: string, archived: boolean): Promise<void> {
  await requestJson(
    `${API_BASE}?action=${archived ? 'archive' : 'unarchive'}&id=${encodeURIComponent(id)}`,
    { method: 'POST' },
    'archive_failed',
  );
}

/** Bulk import bundles (idempotent on project id). */
export async function importProjects(bundles: ProjectBundle[]): Promise<ImportResult> {
  return requestJson<ImportResult>(
    `${API_BASE}?action=import`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bundles }),
    },
    'import_failed',
  );
}
