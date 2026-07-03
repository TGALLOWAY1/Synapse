// Pure helpers for content-addressing mockup images in Vercel Blob.
//
// Images are addressed by sha256(dataUrl) so identical renders dedup to a single
// blob and the hash → blob path is 1:1 (which makes refcount GC clean). The blob
// path is per-user (`users/<userId>/mockup-images/<hash>.<ext>`) so one user's
// images live under their own prefix. No store / network access here — these are
// unit-testable in isolation.

const EXT_BY_TYPE: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

/** Hex sha256 of a string, via Web Crypto (available in browsers + Node 20+). */
export async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Extract the MIME type from a data URL, defaulting to image/png. */
export function contentTypeFromDataUrl(dataUrl: string): string {
  const m = /^data:([^;,]+)[;,]/.exec(dataUrl);
  return m?.[1] || 'image/png';
}

export function extFromContentType(contentType: string): string {
  return EXT_BY_TYPE[contentType] ?? 'png';
}

/** Per-user, content-addressed blob path. The handler pins uploads to this prefix. */
export function buildImageBlobPath(userId: string, hash: string, contentType: string): string {
  return `users/${userId}/mockup-images/${hash}.${extFromContentType(contentType)}`;
}

/**
 * Decode a base64 data URL into a Blob suitable for a client-direct upload. The
 * bytes go browser → Blob and never traverse a serverless function body.
 */
export function dataUrlToBlob(dataUrl: string): Blob {
  const contentType = contentTypeFromDataUrl(dataUrl);
  const commaIdx = dataUrl.indexOf(',');
  const b64 = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : '';
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: contentType });
}
