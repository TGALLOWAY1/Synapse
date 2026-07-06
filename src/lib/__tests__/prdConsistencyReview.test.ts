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
    expect(result.rejectionReason).toBe('unparseable');
  });

  it('rejects a revision that empties a required field', async () => {
    const original = basePrd();
    // Model blanks out the vision — the PRD would be unusable.
    const transport = vi.fn(async () =>
      JSON.stringify({ prd: { ...original, vision: '' }, changeLog: 'tightened' }),
    );
    const result = await reviewPrdConsistency(original, { transport });
    expect(result.applied).toBe(false);
    expect(result.rejectionReason).toBe('missing-required');
    expect(result.prd.vision).toBe('A vision');
  });

  it('rejects a revision that renames/drops a feature id', async () => {
    const original = basePrd();
    // Same feature count (passes detail-loss) but the ids are all different.
    const renamed = original.features.map((f, i) => ({ ...f, id: `renamed-${i}` }));
    const transport = vi.fn(async () =>
      JSON.stringify({ prd: { ...original, features: renamed }, changeLog: 'renamed ids' }),
    );
    const result = await reviewPrdConsistency(original, { transport });
    expect(result.applied).toBe(false);
    expect(result.rejectionReason).toBe('feature-ids-changed');
    expect(result.prd.features.map(f => f.id)).toEqual(original.features.map(f => f.id));
  });

  it('rejects a revision that blanks the product name', async () => {
    const original = basePrd();
    const transport = vi.fn(async () =>
      JSON.stringify({ prd: { ...original, productName: '' }, changeLog: 'dropped name' }),
    );
    const result = await reviewPrdConsistency(original, { transport });
    expect(result.applied).toBe(false);
    expect(result.rejectionReason).toBe('product-identity-lost');
    expect(result.prd.productName).toBe('MyApp');
  });

  it('preserves safety-restriction constraints the model omits (merge)', async () => {
    const original: StructuredPRD = { ...basePrd(), constraints: ['No collection of medical data'] };
    // Model returns a revision that omits constraints entirely.
    const transport = vi.fn(async () =>
      JSON.stringify({ prd: { ...original, constraints: undefined }, changeLog: 'reconciled' }),
    );
    const result = await reviewPrdConsistency(original, { transport });
    expect(result.applied).toBe(true);
    // The restriction survives via merge-over-original.
    expect(result.prd.constraints).toEqual(['No collection of medical data']);
  });

  // --- Phase 3 semantic preservation guards ----------------------------------

  it('rejects a revision that keeps the feature id but drops acceptance criteria', async () => {
    const original = basePrd();
    original.features[0].acceptanceCriteria = ['must A', 'must B', 'must C'];
    // Same id, same count of features, but one acceptance criterion removed.
    const revised = original.features.map((f, i) =>
      i === 0 ? { ...f, acceptanceCriteria: ['must A', 'must B'] } : f,
    );
    const transport = vi.fn(async () =>
      JSON.stringify({ prd: { ...original, features: revised }, changeLog: 'trimmed criteria' }),
    );
    const result = await reviewPrdConsistency(original, { transport });
    expect(result.applied).toBe(false);
    expect(result.rejectionReason).toBe('feature-acceptance-criteria-lost');
    expect(result.prd.features[0].acceptanceCriteria).toHaveLength(3);
  });

  it('rejects a revision that removes a feature dependency reference', async () => {
    const original = basePrd();
    original.features[1].dependencies = ['f1', 'f3'];
    // Same feature, but one dependency id dropped.
    const revised = original.features.map((f, i) =>
      i === 1 ? { ...f, dependencies: ['f1'] } : f,
    );
    const transport = vi.fn(async () =>
      JSON.stringify({ prd: { ...original, features: revised }, changeLog: 'removed dep' }),
    );
    const result = await reviewPrdConsistency(original, { transport });
    expect(result.applied).toBe(false);
    expect(result.rejectionReason).toBe('feature-dependencies-lost');
    expect(result.prd.features[1].dependencies).toEqual(['f1', 'f3']);
  });

  it('rejects a revision that removes/weakens a safety restriction', async () => {
    const original: StructuredPRD = {
      ...basePrd(),
      constraints: ['No collection of medical data', 'No third-party data sharing'],
    };
    // Count is preserved (passes detail-loss) but one restriction was reworded
    // into a weaker form — the safety guard must still reject it.
    const transport = vi.fn(async () =>
      JSON.stringify({
        prd: { ...original, constraints: ['Avoid excessive medical data', 'No third-party data sharing'] },
        changeLog: 'reworded constraints',
      }),
    );
    const result = await reviewPrdConsistency(original, { transport });
    expect(result.applied).toBe(false);
    expect(result.rejectionReason).toBe('safety-restriction-lost');
    expect(result.prd.constraints).toEqual([
      'No collection of medical data',
      'No third-party data sharing',
    ]);
  });

  it('rejects a revision that drops an entity field', async () => {
    const original: StructuredPRD = {
      ...basePrd(),
      richDataModel: {
        entities: [
          {
            name: 'Patient',
            description: 'A patient record',
            fields: [
              { name: 'id', type: 'string' },
              { name: 'name', type: 'string' },
              { name: 'dob', type: 'date' },
            ],
            relationships: ['has many Appointment'],
          },
        ],
      },
    };
    // Same entity, but a field removed.
    const transport = vi.fn(async () =>
      JSON.stringify({
        prd: {
          ...original,
          richDataModel: {
            entities: [
              {
                name: 'Patient',
                description: 'A patient record',
                fields: [
                  { name: 'id', type: 'string' },
                  { name: 'name', type: 'string' },
                ],
                relationships: ['has many Appointment'],
              },
            ],
          },
        },
        changeLog: 'dropped field',
      }),
    );
    const result = await reviewPrdConsistency(original, { transport });
    expect(result.applied).toBe(false);
    expect(result.rejectionReason).toBe('entity-detail-lost');
    expect(result.prd.richDataModel?.entities[0].fields).toHaveLength(3);
  });

  it('rejects a revision that drops an entity relationship', async () => {
    const original: StructuredPRD = {
      ...basePrd(),
      richDataModel: {
        entities: [
          {
            name: 'Order',
            description: 'A purchase order',
            fields: [{ name: 'id', type: 'string' }],
            relationships: ['belongs to Customer', 'has many LineItem'],
          },
        ],
      },
    };
    const transport = vi.fn(async () =>
      JSON.stringify({
        prd: {
          ...original,
          richDataModel: {
            entities: [
              {
                name: 'Order',
                description: 'A purchase order',
                fields: [{ name: 'id', type: 'string' }],
                relationships: ['belongs to Customer'],
              },
            ],
          },
        },
        changeLog: 'dropped relationship',
      }),
    );
    const result = await reviewPrdConsistency(original, { transport });
    expect(result.applied).toBe(false);
    expect(result.rejectionReason).toBe('entity-detail-lost');
  });

  it('records a structured diff on an accepted revision', async () => {
    const original = basePrd();
    const transport = vi.fn(async () =>
      JSON.stringify({
        prd: { ...original, productName: 'MyApp (canonical)' },
        changeLog: 'Normalized product name across sections.',
      }),
    );
    const result = await reviewPrdConsistency(original, { transport });
    expect(result.applied).toBe(true);
    expect(result.diff).toBeDefined();
    expect(result.diff?.outcome).toBe('accepted');
    expect(result.diff?.guardsTriggered).toEqual([]);
    expect(result.diff?.sectionsChanged).toContain('productName');
    expect(result.diff?.productNameChange).toEqual({ before: 'MyApp', after: 'MyApp (canonical)' });
  });

  it('records the triggered guard in the diff on a rejected revision', async () => {
    const original = basePrd();
    const renamed = original.features.map((f, i) => ({ ...f, id: `renamed-${i}` }));
    const transport = vi.fn(async () =>
      JSON.stringify({ prd: { ...original, features: renamed }, changeLog: 'renamed ids' }),
    );
    const result = await reviewPrdConsistency(original, { transport });
    expect(result.applied).toBe(false);
    expect(result.diff?.outcome).toBe('rejected');
    expect(result.diff?.guardsTriggered).toContain('feature-ids-changed');
  });
});
