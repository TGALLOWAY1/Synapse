import { describe, it, expect } from 'vitest';
import {
    deriveDeferredFeatureIds,
    deriveImplementationSummary,
    isImplementationSummaryEmpty,
    splitFeaturesByTier,
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
    });

    it('exposes no defer bucket (removed from the summary)', () => {
        const prd = basePRD({
            features: [baseFeature({ id: 'f1', name: 'F1', tier: 'later' })],
        });
        const s = deriveImplementationSummary(prd);
        expect('defer' in s).toBe(false);
        expect('openDecisions' in s).toBe(false);
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

    it('lists every tagged feature (no cap — this is THE scope section)', () => {
        const prd = basePRD({
            features: Array.from({ length: 10 }, (_, i) =>
                baseFeature({ id: `f${i}`, name: `F${i}`, tier: 'mvp' }),
            ),
        });
        const s = deriveImplementationSummary(prd);
        expect(s.buildFirst).toHaveLength(10);
    });

    it('uses the feature description as the reason, without the complexity prefix', () => {
        const prd = basePRD({
            features: [
                baseFeature({ id: 'f1', name: 'F1', tier: 'mvp', description: 'Upload pipeline for images', complexity: 'low' }),
                baseFeature({ id: 'f2', name: 'F2', tier: 'v1', description: 'Flashcard generation', complexity: 'high' }),
            ],
        });
        const s = deriveImplementationSummary(prd);
        expect(s.buildFirst[0].reason).toBe('Upload pipeline for images');
        expect(s.buildFirst[0].reason).not.toMatch(/^low/);
        // Build Next carries the description too — both buckets read the same.
        expect(s.buildNext[0].reason).toBe('Flashcard generation');
    });

    it('falls back to user value when a feature has no description', () => {
        const prd = basePRD({
            features: [baseFeature({ id: 'f1', name: 'F1', tier: 'mvp', description: '', userValue: 'Saves time' })],
        });
        expect(deriveImplementationSummary(prd).buildFirst[0].reason).toBe('Saves time');
    });
});

describe('splitFeaturesByTier', () => {
    it('groups mvp/v1/deferred and keeps untiered features visible with mvp', () => {
        const features = [
            baseFeature({ id: 'f1', tier: 'mvp' }),
            baseFeature({ id: 'f2', tier: 'v1' }),
            baseFeature({ id: 'f3', tier: 'later' }),
            baseFeature({ id: 'f4' }), // hand-added, no tier — must stay visible
            baseFeature({ id: 'f5', priority: 'should' }), // legacy priority → v1
        ];
        const groups = splitFeaturesByTier(features);
        expect(groups.mvp.map(f => f.id)).toEqual(['f1', 'f4']);
        expect(groups.v1.map(f => f.id)).toEqual(['f2', 'f5']);
        expect(groups.deferred.map(f => f.id)).toEqual(['f3']);
    });

    it('defers extra ids from the scope-aware deferred set', () => {
        const features = [
            baseFeature({ id: 'f1', tier: 'mvp' }),
            baseFeature({ id: 'f9', name: 'Anki Export' }), // untiered, deferred via scope
        ];
        const groups = splitFeaturesByTier(features, new Set(['f9']));
        expect(groups.mvp.map(f => f.id)).toEqual(['f1']);
        expect(groups.deferred.map(f => f.id)).toEqual(['f9']);
    });
});

describe('deriveDeferredFeatureIds', () => {
    it('includes tier-later features and untagged features named by mvpScope.later', () => {
        const prd = basePRD({
            features: [
                baseFeature({ id: 'f3', tier: 'later' }),
                baseFeature({ id: 'f9', name: 'Anki Export' }), // no tier
            ],
            mvpScope: { mvp: [], v1: [], later: ['Anki Export (f9): CSV utility'] },
        });
        expect([...deriveDeferredFeatureIds(prd)].sort()).toEqual(['f3', 'f9']);
    });

    it('never defers a feature whose explicit mvp/v1 tier tag conflicts with a later item', () => {
        const prd = basePRD({
            features: [baseFeature({ id: 'f1', name: 'Quick Capture', tier: 'mvp' })],
            mvpScope: { mvp: [], v1: [], later: ['Advanced Quick Capture filters'] },
        });
        expect(deriveDeferredFeatureIds(prd).size).toBe(0);
    });
});

describe('deriveImplementationSummary — explicit mvpScope entries', () => {
    it('drives the buckets from mvpScope when features carry no tier/priority tags', () => {
        const prd = basePRD({
            features: [
                baseFeature({ id: 'f1', name: 'Quick Capture', description: 'One-tap logging' }),
                baseFeature({ id: 'f2', name: 'Weekly Review', description: 'Retro view' }),
                baseFeature({ id: 'f3', name: 'Something Else' }),
            ],
            mvpScope: {
                mvp: ['F1: Quick Capture'],
                v1: ['Weekly Review polish'],
                later: [],
            },
        });
        const s = deriveImplementationSummary(prd);
        // No declaration-order guess — the explicit scope decisions win.
        expect(s.buildFirst.map(f => f.id)).toEqual(['f1']);
        expect(s.buildNext.map(f => f.id)).toEqual(['f2']);
    });

    it('preserves free-form scope entries that resolve to no feature', () => {
        const prd = basePRD({
            features: [baseFeature({ id: 'f1', name: 'Quick Capture', tier: 'mvp' })],
            mvpScope: {
                mvp: ['Basic auth and onboarding'],
                v1: ['Billing integration'],
                later: [],
            },
        });
        const s = deriveImplementationSummary(prd);
        expect(s.buildFirst.map(f => f.name)).toEqual(['Quick Capture', 'Basic auth and onboarding']);
        // A missing `id` IS the untraced signal: feature-backed entries always
        // carry the feature id, so the scope UI renders its advisory
        // "not traced to a feature" hint exactly when `id` is undefined.
        expect(s.buildFirst[0].id).toBe('f1');
        expect(s.buildFirst[1].id).toBeUndefined();
        expect(s.buildNext.map(f => f.name)).toEqual(['Billing integration']);
        expect(s.buildNext[0].id).toBeUndefined();
    });

    it('excludes scope-deferred features from the buckets', () => {
        const prd = basePRD({
            features: [
                baseFeature({ id: 'f1', name: 'Quick Capture', priority: 'must' }),
                baseFeature({ id: 'f9', name: 'Anki Export', priority: 'must' }), // untiered but deferred by scope
            ],
            mvpScope: { mvp: [], v1: [], later: ['Anki Export (f9)'] },
        });
        const s = deriveImplementationSummary(prd);
        expect(s.buildFirst.map(f => f.id)).toEqual(['f1']);
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
