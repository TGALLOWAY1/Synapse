import { describe, it, expect } from 'vitest';
import { computeImagesToUpload, computeOrphanedHashes } from '../imageSyncDiff';

describe('computeImagesToUpload', () => {
  it('uploads only keys absent from BOTH the server and the uploaded markers', () => {
    const out = computeImagesToUpload(
      ['a', 'b', 'c', 'd'],
      new Set(['b']), // already on server
      new Set(['c']), // already marked uploaded
    );
    expect(out.sort()).toEqual(['a', 'd']);
  });

  it('dedups repeated local keys', () => {
    expect(computeImagesToUpload(['a', 'a', 'a'], new Set(), new Set())).toEqual(['a']);
  });

  it('returns nothing when everything is already synced', () => {
    expect(computeImagesToUpload(['a', 'b'], new Set(['a', 'b']), new Set())).toEqual([]);
  });
});

describe('computeOrphanedHashes', () => {
  it('orphans a hash only when no remaining ref points at it (refcount)', () => {
    const deleted = [{ hash: 'h1' }, { hash: 'h2' }];
    const remaining = [{ hash: 'h2' }]; // h2 still referenced elsewhere
    expect(computeOrphanedHashes(deleted, remaining)).toEqual(['h1']);
  });

  it('orphans every deleted hash when nothing remains', () => {
    expect(computeOrphanedHashes([{ hash: 'h1' }, { hash: 'h2' }], [])).toEqual(['h1', 'h2']);
  });

  it('orphans nothing when all hashes are still referenced', () => {
    expect(computeOrphanedHashes([{ hash: 'h1' }], [{ hash: 'h1' }])).toEqual([]);
  });
});
