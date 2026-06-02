import { describe, expect, it, vi } from 'vitest';
import { reviewPrdConsistency } from '../services/prdConsistencyReview';
import type { StructuredPRD, Feature } from '../../types';

const makeFeatures = (n: number): Feature[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `f${i + 1}`,
    name: `Feature ${i + 1}`,
    description: `desc ${i + 1}`,
    userValue: `value ${i + 1}`,
    complexity: 'low' as const,
  }));

const basePrd = (): StructuredPRD => ({
  vision: 'A vision',
  targetUsers: ['users a', 'users b'],
  coreProblem: 'the problem',
  features: makeFeatures(6),
  architecture: 'arch',
  risks: ['r1', 'r2'],
  productName: 'MyApp',
});

describe('reviewPrdConsistency', () => {
  it('applies a revision that preserves detail', async () => {
    const original = basePrd();
    const transport = vi.fn(async () =>
      JSON.stringify({
        prd: { ...original, productName: 'MyApp (canonical)' },
        changeLog: 'Normalized product name across sections.',
      }),
    );
    const result = await reviewPrdConsistency(original, { transport });
    expect(transport).toHaveBeenCalledOnce();
    expect(result.applied).toBe(true);
    expect(result.prd.productName).toBe('MyApp (canonical)');
    expect(result.prd.features).toHaveLength(6);
    expect(result.changeLog).toMatch(/normalized/i);
  });

  it('discards a revision that drops substantive detail (guard)', async () => {
    const original = basePrd();
    // Model returns only 2 of 6 features — a lossy "summary".
    const transport = vi.fn(async () =>
      JSON.stringify({ prd: { ...original, features: makeFeatures(2) }, changeLog: 'shortened' }),
    );
    const result = await reviewPrdConsistency(original, { transport });
    expect(result.applied).toBe(false);
    // Original is returned untouched.
    expect(result.prd.features).toHaveLength(6);
  });

  it('merges over the original so omitted fields are preserved', async () => {
    const original = basePrd();
    // Model omits features entirely (returns only a tweaked vision).
    const transport = vi.fn(async () =>
      JSON.stringify({ prd: { vision: 'Sharper vision' }, changeLog: 'tightened vision' }),
    );
    const result = await reviewPrdConsistency(original, { transport });
    expect(result.applied).toBe(true);
    expect(result.prd.vision).toBe('Sharper vision');
    expect(result.prd.features).toHaveLength(6); // preserved via merge
  });

  it('returns the original (no-op) when the response is unparseable', async () => {
    const original = basePrd();
    const transport = vi.fn(async () => 'not json');
    const result = await reviewPrdConsistency(original, { transport });
    expect(result.applied).toBe(false);
    expect(result.prd).toEqual(original);
  });
});
