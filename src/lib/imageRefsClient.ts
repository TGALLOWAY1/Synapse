// Client transport for image refs + the client-direct Blob upload/download.
//
// Refs are small JSON records persisted via /api/projects?action=image-*; the
// image BYTES go browser → Blob directly (upload) and Blob → browser directly
// (download), never through a serverless function body, so neither crosses
// Vercel's ~4.5 MB request/response cap.

import { upload } from '@vercel/blob/client';
import type { ImageRef } from './imageRef';

const API_BASE = '/api/projects';

async function parseError(resp: Response, fallback: string): Promise<Error> {
  let body: { error?: string; message?: string } | null = null;
  try {
    body = (await resp.json()) as { error?: string; message?: string };
  } catch {
    body = null;
  }
  const code = body?.error || `${fallback}_${resp.status}`;
  return new Error(body?.message ? `${code}: ${body.message}` : code);
}

/** List the signed-in user's image refs for one project. */
export async function fetchImageRefs(projectId: string): Promise<ImageRef[]> {
  const resp = await fetch(`${API_BASE}?action=image-refs&id=${encodeURIComponent(projectId)}`, {
    method: 'GET',
    credentials: 'include',
  });
  if (!resp.ok) throw await parseError(resp, 'image_refs_failed');
  const data = (await resp.json()) as { refs?: ImageRef[] };
  return Array.isArray(data.refs) ? data.refs : [];
}

/** Persist one image ref after its bytes have been uploaded to Blob. */
export async function putImageRef(projectId: string, ref: ImageRef): Promise<void> {
  const resp = await fetch(`${API_BASE}?action=image-ref-put&id=${encodeURIComponent(projectId)}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ref }),
  });
  if (!resp.ok) throw await parseError(resp, 'image_ref_put_failed');
}

/** Delete refs by key (the server refcount-GCs any orphaned blobs). */
export async function deleteImageRefsRemote(projectId: string, keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  const resp = await fetch(`${API_BASE}?action=image-ref-delete&id=${encodeURIComponent(projectId)}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ keys }),
  });
  if (!resp.ok && resp.status !== 404) throw await parseError(resp, 'image_ref_delete_failed');
}

/**
 * Upload image bytes directly to Blob. The serverless function only mints a
 * signed, prefix-restricted token (handleUpload); the bytes never pass through
 * it. `clientPayload` carries the routing metadata to the token issuer.
 */
export async function uploadImageToBlob(
  path: string,
  blob: Blob,
  contentType: string,
  clientPayload: string,
): Promise<{ url: string }> {
  const result = await upload(path, blob, {
    access: 'public',
    contentType,
    handleUploadUrl: `${API_BASE}?action=image-upload-token`,
    clientPayload,
  });
  return { url: result.url };
}

/** Download a blob URL directly and decode it back into a data URL for IndexedDB. */
export async function fetchBlobAsDataUrl(blobUrl: string): Promise<string> {
  const resp = await fetch(blobUrl);
  if (!resp.ok) throw new Error(`blob_fetch_failed_${resp.status}`);
  const blob = await resp.blob();
  return await blobToDataUrl(blob);
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error('blob_decode_failed'));
    reader.readAsDataURL(blob);
  });
}
