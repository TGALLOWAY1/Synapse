import { describe, it, expect } from 'vitest';
import {
    deriveImplementationSummary,
    isImplementationSummaryEmpty,
} from '../derive/implementationSummary';
import type { StructuredPRD, Feature } from '../../types';

const baseFeature = (overrides: Partial<Feature>): Feature => ({
    id: 'f',
    name: 'Feature',
    description: 'd',
    userValue: 'value',
    complexity: 'medium',
    ...overrides,
});

const basePRD = (overrides: Partial<StructuredPRD>): StructuredPRD => ({
    vision: 'v',
    targetUsers: [],
    coreProblem: 'p',
    features: [],
    architecture: 'a',
    risks: [],
    ...overrides,
});

describe('deriveImplementationSummary — feature bucketing', () => {
    it('uses tier when present', () => {
        const prd = basePRD({
            features: [
                baseFeature({ id: 'f1', name: 'F1', tier: 'mvp' }),
                baseFeature({ id: 'f2', name: 'F2', tier: 'v1' }),
                baseFeature({ id: 'f3', name: 'F3', tier: 'later' }),
            ],
        });
        const s = deriveImplementationSummary(prd);
        expect(s.buildFirst.map(f => f.id)).toEqual(['f1']);
        expect(s.buildNext.map(f => f.id)).toEqual(['f2']);
        expect(s.defer.map(f => f.id)).toEqual(['f3']);
    });

    it('falls back to priority when tier is missing', () => {
        const prd = basePRD({
            features: [
                baseFeature({ id: 'f1', name: 'F1', priority: 'must' }),
                baseFeature({ id: 'f2', name: 'F2', priority: 'should' }),
                baseFeature({ id: 'f3', name: 'F3', priority: 'could' }),
            ],
        });
        const s = deriveImplementationSummary(prd);
        expect(s.buildFirst.map(f => f.id)).toEqual(['f1']);
        expect(s.buildNext.map(f => f.id)).toEqual(['f2']);
        expect(s.defer.map(f => f.id)).toEqual(['f3']);
    });

    it('legacy untagged PRDs split features by declaration order', () => {
        const prd = basePRD({
            features: Array.from({ length: 10 }, (_, i) =>
                baseFeature({ id: `f${i}`, name: `F${i}` }),
            ),
        });
        const s = deriveImplementationSummary(prd);
        expect(s.buildFirst).toHaveLength(4);
        expect(s.buildNext).toHaveLength(4);
        expect(s.defer).toHaveLength(2);
    });

    it('orders buckets by feature id so f1, f2, f3… stay in natural order', () => {
        const prd = basePRD({
            features: [
                baseFeature({ id: 'f3', name: 'F3', tier: 'mvp', complexity: 'low' }),
                baseFeature({ id: 'f1', name: 'F1', tier: 'mvp', complexity: 'high' }),
                baseFeature({ id: 'f2', name: 'F2', tier: 'mvp', complexity: 'medium' }),
            ],
        });
        const s = deriveImplementationSummary(prd);
        expect(s.buildFirst.map(f => f.id)).toEqual(['f1', 'f2', 'f3']);
    });

    it('caps each bucket at 5', () => {
        const prd = basePRD({
            features: Array.from({ length: 10 }, (_, i) =>
                baseFeature({ id: `f${i}`, name: `F${i}`, tier: 'mvp' }),
            ),
        });
        const s = deriveImplementationSummary(prd);
        expect(s.buildFirst).toHaveLength(5);
    });
});

describe('deriveImplementationSummary — risks', () => {
    it('prefers high-likelihood detailed risks', () => {
        const prd = basePRD({
            risksDetailed: [
                { risk: 'medium', likelihood: 'med', impact: 'i', mitigation: 'm' },
                { risk: 'high', likelihood: 'high', impact: 'i', mitigation: 'm' },
                { risk: 'low', likelihood: 'low', impact: 'i', mitigation: 'm' },
            ],
        });
        const s = deriveImplementationSummary(prd);
        expect(s.highestRisks[0].risk).toBe('high');
    });

    it('flags impact keywords as high', () => {
        const prd = basePRD({
            risksDetailed: [
                { risk: 'data leak', likelihood: 'low', impact: 'critical breach', mitigation: 'm' },
                { risk: 'minor', likelihood: 'low', impact: 'small', mitigation: 'm' },
            ],
        });
        const s = deriveImplementationSummary(prd);
        expect(s.highestRisks[0].risk).toBe('data leak');
    });

    it('falls back to legacy plain string risks', () => {
        const prd = basePRD({ risks: ['Timezone bugs', 'Latency spikes'] });
        const s = deriveImplementationSummary(prd);
        expect(s.highestRisks.map(r => r.risk)).toEqual(['Timezone bugs', 'Latency spikes']);
    });
});

describe('deriveImplementationSummary — open decisions', () => {
    it('prefers low-confidence assumptions', () => {
        const prd = basePRD({
            assumptions: [
                { id: 'a1', statement: 'high', confidence: 'high' },
                { id: 'a2', statement: 'low', confidence: 'low' },
                { id: 'a3', statement: 'med', confidence: 'med' },
            ],
        });
        const s = deriveImplementationSummary(prd);
        expect(s.openDecisions.map(d => d.id)).toEqual(['a2']);
    });
});

describe('isImplementationSummaryEmpty', () => {
    it('detects an empty summary', () => {
        const prd = basePRD({});
        const s = deriveImplementationSummary(prd);
        expect(isImplementationSummaryEmpty(s)).toBe(true);
    });

    it('returns false when any bucket is populated', () => {
        const prd = basePRD({
            features: [baseFeature({ id: 'f1', name: 'F1', tier: 'mvp' })],
        });
        const s = deriveImplementationSummary(prd);
        expect(isImplementationSummaryEmpty(s)).toBe(false);
    });
});
