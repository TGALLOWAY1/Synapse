import { describe, expect, it } from 'vitest';
import { isStructuredPrdContentEqual } from '../structuredPrdEquality';
import type { StructuredPRD } from '../../types';

const base: StructuredPRD = {
    vision: 'Every parent keeps one small habit going.',
    targetUsers: ['Busy parents', 'Night-shift workers'],
    coreProblem: 'Habit apps punish missed days.',
    features: [{ id: 'f1', name: 'Quick Capture', description: 'd', userValue: 'v', complexity: 'low' }],
    architecture: 'Local-first.',
    risks: [],
};

describe('isStructuredPrdContentEqual', () => {
    it('is true for the same content regardless of whitespace, key order, or undefined keys', () => {
        const reordered = Object.fromEntries(Object.entries(base).reverse()) as StructuredPRD;
        expect(isStructuredPrdContentEqual(base, reordered)).toBe(true);
        expect(isStructuredPrdContentEqual(base, { ...base, vision: `  ${base.vision}\n` })).toBe(true);
        expect(isStructuredPrdContentEqual(base, {
            ...base,
            executiveSummary: undefined,
            features: [{ ...base.features[0], priority: undefined }],
        })).toBe(true);
    });

    it('is false for any real content change, including reordering list items', () => {
        expect(isStructuredPrdContentEqual(base, { ...base, vision: 'A different vision.' })).toBe(false);
        expect(isStructuredPrdContentEqual(base, { ...base, targetUsers: ['Night-shift workers', 'Busy parents'] })).toBe(false);
        expect(isStructuredPrdContentEqual(base, { ...base, risks: ['Churn'] })).toBe(false);
        expect(isStructuredPrdContentEqual(base, {
            ...base,
            features: [{ ...base.features[0], confirmed: true }],
        })).toBe(false);
    });

    it('treats a missing PRD as different from any PRD', () => {
        expect(isStructuredPrdContentEqual(undefined, base)).toBe(false);
        expect(isStructuredPrdContentEqual(base, undefined)).toBe(false);
        expect(isStructuredPrdContentEqual(undefined, undefined)).toBe(true);
    });
});
