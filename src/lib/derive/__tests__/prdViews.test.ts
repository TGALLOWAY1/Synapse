import { describe, it, expect } from 'vitest';
import type { StructuredPRD, Feature } from '../../../types';
import {
    coercePrdView,
    groupFeaturesBySystem,
    filterFeatures,
    featureFilterCounts,
    deriveFeatureTrace,
    splitDecisionInputs,
    deriveRisks,
    hasDecisionContent,
} from '../prdViews';
import { deriveDeferredFeatureIds } from '../implementationSummary';

const feature = (over: Partial<Feature> & { id: string; name: string }): Feature => ({
    description: 'd',
    userValue: 'v',
    complexity: 'low',
    ...over,
});

const basePrd = (over: Partial<StructuredPRD> = {}): StructuredPRD => ({
    vision: 'v',
    targetUsers: ['u'],
    coreProblem: 'p',
    architecture: 'a',
    risks: [],
    features: [],
    ...over,
});

describe('coercePrdView', () => {
    it('defaults unknown/empty to overview', () => {
        expect(coercePrdView(null)).toBe('overview');
        expect(coercePrdView('nope')).toBe('overview');
        expect(coercePrdView('overview')).toBe('overview');
    });
    it('accepts features and decisions', () => {
        expect(coercePrdView('features')).toBe('features');
        expect(coercePrdView('decisions')).toBe('decisions');
    });
});

describe('groupFeaturesBySystem', () => {
    it('groups by featureIds and buckets ungrouped features', () => {
        const f1 = feature({ id: 'f1', name: 'Capture', tier: 'mvp' });
        const f2 = feature({ id: 'f2', name: 'Review', tier: 'v1' });
        const f3 = feature({ id: 'f3', name: 'Solo', tier: 'mvp' });
        const prd = basePrd({
            features: [f1, f2, f3],
            featureSystems: [{ id: 's1', name: 'Capture System', purpose: 'sp', featureIds: ['f1', 'f2'] }],
        });
        const groups = groupFeaturesBySystem([f1, f2, f3], prd);
        expect(groups).toHaveLength(2);
        expect(groups[0].name).toBe('Capture System');
        expect(groups[0].features.map(f => f.id)).toEqual(['f1', 'f2']);
        expect(groups[0].mvpCount).toBe(1);
        expect(groups[0].v1CountAll).toBe(1);
        // ungrouped bucket
        expect(groups[1].ungrouped).toBe(true);
        expect(groups[1].name).toBe('Other features');
        expect(groups[1].features.map(f => f.id)).toEqual(['f3']);
    });

    it('falls back to feature.system membership', () => {
        const f1 = feature({ id: 'f1', name: 'A', system: 's1' });
        const prd = basePrd({
            features: [f1],
            featureSystems: [{ id: 's1', name: 'Sys', purpose: 'p', featureIds: [] }],
        });
        const groups = groupFeaturesBySystem([f1], prd);
        expect(groups).toHaveLength(1);
        expect(groups[0].features.map(f => f.id)).toEqual(['f1']);
    });

    it('names the single bucket "All features" when there are no systems', () => {
        const f1 = feature({ id: 'f1', name: 'A' });
        const groups = groupFeaturesBySystem([f1], basePrd({ features: [f1] }));
        expect(groups).toHaveLength(1);
        expect(groups[0].name).toBe('All features');
        expect(groups[0].ungrouped).toBe(true);
    });

    it('does not duplicate a feature listed in both featureIds and system field', () => {
        const f1 = feature({ id: 'f1', name: 'A', system: 's1' });
        const prd = basePrd({
            features: [f1],
            featureSystems: [{ id: 's1', name: 'Sys', purpose: 'p', featureIds: ['f1'] }],
        });
        const groups = groupFeaturesBySystem([f1], prd);
        expect(groups[0].features).toHaveLength(1);
    });
});

describe('filterFeatures / featureFilterCounts', () => {
    const f1 = feature({ id: 'f1', name: 'A', tier: 'mvp', confirmed: true });
    const f2 = feature({ id: 'f2', name: 'B', tier: 'v1' });
    const f3 = feature({ id: 'f3', name: 'C', tier: 'later' });
    const prd = basePrd({ features: [f1, f2, f3] });
    const deferred = deriveDeferredFeatureIds(prd);

    it('all excludes deferred', () => {
        expect(filterFeatures([f1, f2, f3], 'all', deferred).map(f => f.id)).toEqual(['f1', 'f2']);
    });
    it('mvp returns only mvp in-scope', () => {
        expect(filterFeatures([f1, f2, f3], 'mvp', deferred).map(f => f.id)).toEqual(['f1']);
    });
    it('later returns only deferred', () => {
        expect(filterFeatures([f1, f2, f3], 'later', deferred).map(f => f.id)).toEqual(['f3']);
    });
    it('needs_review vs confirmed partition in-scope', () => {
        expect(filterFeatures([f1, f2, f3], 'needs_review', deferred).map(f => f.id)).toEqual(['f2']);
        expect(filterFeatures([f1, f2, f3], 'confirmed', deferred).map(f => f.id)).toEqual(['f1']);
    });
    it('counts are consistent', () => {
        const counts = featureFilterCounts([f1, f2, f3], deferred);
        expect(counts).toEqual({ all: 2, mvp: 1, later: 1, needs_review: 1, confirmed: 1 });
    });
});

describe('deriveFeatureTrace', () => {
    it('resolves dependency ids to features and drops unresolved ones', () => {
        const f1 = feature({ id: 'f1', name: 'A' });
        const f2 = feature({ id: 'f2', name: 'B', dependencies: ['f1', 'ghost'] });
        const prd = basePrd({
            features: [f1, f2],
            featureSystems: [{ id: 's1', name: 'Sys', purpose: 'p', featureIds: ['f2'] }],
        });
        const trace = deriveFeatureTrace(f2, prd);
        expect(trace.dependencies).toEqual([{ id: 'f1', name: 'A' }]);
        expect(trace.system).toEqual({ id: 's1', name: 'Sys' });
    });

    it('returns no system when unowned', () => {
        const f1 = feature({ id: 'f1', name: 'A' });
        const trace = deriveFeatureTrace(f1, basePrd({ features: [f1] }));
        expect(trace.system).toBeUndefined();
        expect(trace.dependencies).toEqual([]);
    });
});

describe('splitDecisionInputs', () => {
    it('routes low confidence to needsInput, others to toValidate, never both', () => {
        const prd = basePrd({
            assumptions: [
                { id: 'a1', statement: 'uncertain', confidence: 'low' },
                { id: 'a2', statement: 'likely', confidence: 'high' },
                { id: 'a3', statement: 'maybe', confidence: 'med' },
                { id: 'a4', statement: 'decided', confidence: 'low', decision: 'confirmed' },
            ],
        });
        const { needsInput, toValidate } = splitDecisionInputs(prd.assumptions);
        expect(needsInput.map(a => a.id)).toEqual(['a1']);
        expect(toValidate.map(a => a.id).sort()).toEqual(['a2', 'a3']);
    });
});

describe('deriveRisks', () => {
    it('prefers detailed risks', () => {
        const prd = basePrd({
            risks: ['legacy'],
            risksDetailed: [{ risk: 'r1', likelihood: 'high', impact: 'i', mitigation: 'm' }],
        });
        expect(deriveRisks(prd)).toEqual([
            { risk: 'r1', likelihood: 'high', impact: 'i', mitigation: 'm', owner: undefined },
        ]);
    });
    it('falls back to legacy string risks', () => {
        expect(deriveRisks(basePrd({ risks: ['a', 'b'] }))).toEqual([{ risk: 'a' }, { risk: 'b' }]);
    });
});

describe('hasDecisionContent', () => {
    it('is false for a bare PRD', () => {
        expect(hasDecisionContent(basePrd())).toBe(false);
    });
    it('is true when there are unresolved assumptions', () => {
        expect(hasDecisionContent(basePrd({ assumptions: [{ id: 'a', statement: 's', confidence: 'low' }] }))).toBe(true);
    });
    it('is true when there are deferred features', () => {
        expect(hasDecisionContent(basePrd({ features: [feature({ id: 'f', name: 'x', tier: 'later' })] }))).toBe(true);
    });
    it('is true when there are risks', () => {
        expect(hasDecisionContent(basePrd({ risks: ['r'] }))).toBe(true);
    });
});
