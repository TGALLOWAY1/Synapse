import { describe, it, expect } from 'vitest';
import {
  sha256Hex,
  contentTypeFromDataUrl,
  extFromContentType,
  buildImageBlobPath,
  dataUrlToBlob,
} from '../imageBlobHash';

describe('sha256Hex', () => {
  it('matches the known SHA-256 vector for the empty string', async () => {
    expect(await sha256Hex('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('is deterministic — identical input dedups to the same hash', async () => {
    const a = await sha256Hex('data:image/png;base64,AAAA');
    const b = await sha256Hex('data:image/png;base64,AAAA');
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('different input → different hash', async () => {
    expect(await sha256Hex('a')).not.toBe(await sha256Hex('b'));
  });
});

describe('contentTypeFromDataUrl / extFromContentType', () => {
  it('extracts the mime type, defaulting to png', () => {
    expect(contentTypeFromDataUrl('data:image/png;base64,AAAA')).toBe('image/png');
    expect(contentTypeFromDataUrl('data:image/jpeg;base64,AAAA')).toBe('image/jpeg');
    expect(contentTypeFromDataUrl('not-a-data-url')).toBe('image/png');
  });

  it('maps mime to extension with a png fallback', () => {
    expect(extFromContentType('image/png')).toBe('png');
    expect(extFromContentType('image/jpeg')).toBe('jpg');
    expect(extFromContentType('image/webp')).toBe('webp');
    expect(extFromContentType('image/gif')).toBe('png');
  });
});

describe('buildImageBlobPath', () => {
  it('namespaces under the user and content-addresses by hash', () => {
    expect(buildImageBlobPath('u1', 'abc123', 'image/png')).toBe('users/u1/mockup-images/abc123.png');
    expect(buildImageBlobPath('u1', 'abc123', 'image/jpeg')).toBe('users/u1/mockup-images/abc123.jpg');
  });
});

describe('dataUrlToBlob', () => {
  it('decodes a base64 data URL into a typed Blob', () => {
    const dataUrl = `data:image/png;base64,${btoa('hello')}`;
    const blob = dataUrlToBlob(dataUrl);
    expect(blob.type).toBe('image/png');
    expect(blob.size).toBe(5);
  });
});
