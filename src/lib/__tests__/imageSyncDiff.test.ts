import { describe, it, expect } from 'vitest';
import { computeImagesToUpload, computeOrphanedHashes } from '../imageSyncDiff';

describe('computeImagesToUpload', () => {
  it('uploads only keys absent from the server refs', () => {
    const out = computeImagesToUpload(
      ['a', 'b', 'c', 'd'],
      new Set(['b', 'c']), // already on server
    );
    expect(out.sort()).toEqual(['a', 'd']);
  });

  it('dedups repeated local keys', () => {
    expect(computeImagesToUpload(['a', 'a', 'a'], new Set())).toEqual(['a']);
  });

  it('returns nothing when everything is already on the server', () => {
    expect(computeImagesToUpload(['a', 'b'], new Set(['a', 'b']))).toEqual([]);
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
