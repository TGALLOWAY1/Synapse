import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// upload() from the Blob client SDK does a real network handshake; mock it.
const uploadMock = vi.fn((...args: unknown[]): Promise<{ url: string }> => {
  void args;
  return Promise.resolve({ url: 'https://blob/users/u1/mockup-images/h.png' });
});
vi.mock('@vercel/blob/client', () => ({ upload: (...a: unknown[]) => uploadMock(...a) }));

import {
  fetchImageRefs,
  putImageRef,
  deleteImageRefsRemote,
  uploadImageToBlob,
  fetchBlobAsDataUrl,
} from '../imageRefsClient';
import type { ImageRef } from '../imageRef';

function okJson(body: unknown) {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}
function errJson(status: number, body: unknown) {
  return { ok: false, status, json: async () => body } as unknown as Response;
}

const ref: ImageRef = {
  projectId: 'p1',
  key: 'v1:s1:low',
  hash: 'h',
  blobUrl: 'https://blob/users/u1/mockup-images/h.png',
  byteSize: 10,
  kind: 'mockup',
  versionId: 'v1',
  meta: {},
};

beforeEach(() => {
  vi.restoreAllMocks();
  uploadMock.mockClear();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('imageRefsClient', () => {
  it('fetchImageRefs GETs the project refs with the session cookie', async () => {
    const fetchMock = vi.fn(async () => okJson({ refs: [ref] }));
    vi.stubGlobal('fetch', fetchMock);
    const out = await fetchImageRefs('p1');
    expect(out).toEqual([ref]);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/projects?action=image-refs&id=p1');
    expect(init.credentials).toBe('include');
  });

  it('putImageRef POSTs the ref to the image-ref-put action', async () => {
    const fetchMock = vi.fn(async () => okJson({ ref }));
    vi.stubGlobal('fetch', fetchMock);
    await putImageRef('p1', ref);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/projects?action=image-ref-put&id=p1');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ ref });
  });

  it('putImageRef throws on a non-2xx so a failure never silently drops the ref', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => errJson(403, { error: 'forbidden_blob_url' })));
    await expect(putImageRef('p1', ref)).rejects.toThrow(/forbidden_blob_url/);
  });

  it('deleteImageRefsRemote no-ops on an empty key list', async () => {
    const fetchMock = vi.fn(async () => okJson({}));
    vi.stubGlobal('fetch', fetchMock);
    await deleteImageRefsRemote('p1', []);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('deleteImageRefsRemote tolerates a 404 (already gone)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => errJson(404, { error: 'not_found' })));
    await expect(deleteImageRefsRemote('p1', ['k1'])).resolves.toBeUndefined();
  });

  it('uploadImageToBlob routes bytes through the SDK to the token endpoint', async () => {
    const blob = new Blob(['x'], { type: 'image/png' });
    const out = await uploadImageToBlob('users/u1/mockup-images/h.png', blob, 'image/png', '{"k":1}');
    expect(out).toEqual({ url: 'https://blob/users/u1/mockup-images/h.png' });
    const [path, body, opts] = uploadMock.mock.calls[0] as unknown as [string, Blob, Record<string, unknown>];
    expect(path).toBe('users/u1/mockup-images/h.png');
    expect(body).toBe(blob);
    expect(opts.access).toBe('public');
    expect(opts.handleUploadUrl).toBe('/api/projects?action=image-upload-token');
    expect(opts.clientPayload).toBe('{"k":1}');
  });

  it('fetchBlobAsDataUrl downloads the blob directly and decodes it', async () => {
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, blob: async () => blob }) as unknown as Response));
    const dataUrl = await fetchBlobAsDataUrl('https://blob/x.png');
    expect(dataUrl.startsWith('data:image/png;base64,')).toBe(true);
  });
});
