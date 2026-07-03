import { describe, it, expect } from 'vitest';
import { buildMockupImageRef, mockupRecordFromRef, refVersionId, type ImageRef } from '../imageRef';
import type { MockupImageRecord } from '../../types';

const record: MockupImageRecord = {
  key: 'v1:s1:low',
  projectId: 'p1',
  artifactId: 'a1',
  versionId: 'v1',
  screenId: 's1',
  dataUrl: 'data:image/png;base64,AAAA',
  quality: 'low',
  prompt: 'draw a login screen',
  generatedAt: 123,
};

describe('buildMockupImageRef', () => {
  it('strips the dataUrl into meta and carries hash/blobUrl/byteSize + routing', () => {
    const ref = buildMockupImageRef(record, 'hash123', 'https://blob/u1/x.png', 42);
    expect(ref).toMatchObject({
      projectId: 'p1',
      key: 'v1:s1:low',
      hash: 'hash123',
      blobUrl: 'https://blob/u1/x.png',
      byteSize: 42,
      kind: 'mockup',
      versionId: 'v1',
      screenId: 's1',
      quality: 'low',
    });
    // The big payload never lands in the ref.
    expect((ref.meta as Record<string, unknown>).dataUrl).toBeUndefined();
    expect((ref.meta as Record<string, unknown>).prompt).toBe('draw a login screen');
  });
});

describe('mockupRecordFromRef', () => {
  it('reconstructs a full record from the rich meta + fetched dataUrl', () => {
    const ref = buildMockupImageRef(record, 'h', 'https://blob/x.png', 10);
    const out = mockupRecordFromRef(ref, 'data:image/png;base64,BBBB');
    expect(out).toEqual({ ...record, dataUrl: 'data:image/png;base64,BBBB' });
  });

  it('degrades to top-level routing fields when only a backup ref exists (empty meta)', () => {
    const ref: ImageRef = {
      projectId: 'p1',
      key: 'v9:s9:high',
      hash: 'h',
      blobUrl: 'https://blob/x.png',
      byteSize: 0,
      kind: 'mockup',
      versionId: 'v9',
      screenId: 's9',
      quality: 'high',
      meta: {},
    };
    const out = mockupRecordFromRef(ref, 'data:image/png;base64,CCCC');
    expect(out).toMatchObject({
      key: 'v9:s9:high',
      projectId: 'p1',
      versionId: 'v9',
      screenId: 's9',
      quality: 'high',
      dataUrl: 'data:image/png;base64,CCCC',
      artifactId: '',
      prompt: '',
    });
  });
});

describe('refVersionId', () => {
  it('prefers meta.versionId, falling back to the top-level field', () => {
    expect(refVersionId(buildMockupImageRef(record, 'h', 'u', 1))).toBe('v1');
    expect(
      refVersionId({
        projectId: 'p',
        key: 'k',
        hash: 'h',
        blobUrl: 'u',
        byteSize: 0,
        kind: 'mockup',
        versionId: 'vTop',
        meta: {},
      }),
    ).toBe('vTop');
  });
});
