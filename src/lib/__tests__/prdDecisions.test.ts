import { describe, it, expect } from 'vitest';
import {
    sortAssumptionsByConfidence,
    splitAssumptions,
    deriveDecisionLog,
    resolveScopeFeature,
    isDisplayableFeatureId,
} from '../derive/prdDecisions';
import type { Assumption, Feature, StructuredPRD } from '../../types';

const assumption = (overrides: Partial<Assumption>): Assumption => ({
    id: 'a1',
    statement: 'Users have smartphones',
    confidence: 'med',
    ...overrides,
});

const feature = (overrides: Partial<Feature>): Feature => ({
    id: 'f1',
    name: 'Quick Capture',
    description: 'd',
    userValue: 'v',
    complexity: 'low',
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

describe('sortAssumptionsByConfidence', () => {
    it('ranks consequence before plausibility', () => {
        const sorted = sortAssumptionsByConfidence([
            assumption({ id: 'easy', confidence: 'high', materiality: 'low' }),
            assumption({ id: 'product-defining', confidence: 'low', materiality: 'blocking' }),
        ]);
        expect(sorted.map(a => a.id)).toEqual(['product-defining', 'easy']);
    });

    it('orders high → med → low', () => {
        const sorted = sortAssumptionsByConfidence([
            assumption({ id: 'a1', confidence: 'low' }),
            assumption({ id: 'a2', confidence: 'high' }),
            assumption({ id: 'a3', confidence: 'med' }),
        ]);
        expect(sorted.map(a => a.id)).toEqual(['a2', 'a3', 'a1']);
    });

    it('is deterministic and stable within a confidence level', () => {
        const input = [
            assumption({ id: 'a1', confidence: 'high' }),
            assumption({ id: 'a2', confidence: 'high' }),
            assumption({ id: 'a3', confidence: 'high' }),
        ];
        expect(sortAssumptionsByConfidence(input).map(a => a.id)).toEqual(['a1', 'a2', 'a3']);
        // Re-running yields the identical order.
        expect(sortAssumptionsByConfidence(input).map(a => a.id)).toEqual(['a1', 'a2', 'a3']);
    });

    it('handles missing/unknown confidence gracefully (sorts last)', () => {
        const legacy = { id: 'a1', statement: 's' } as Assumption; // no confidence
        const sorted = sortAssumptionsByConfidence([
            legacy,
            assumption({ id: 'a2', confidence: 'low' }),
            assumption({ id: 'a3', confidence: 'high' }),
        ]);
        expect(sorted.map(a => a.id)).toEqual(['a3', 'a2', 'a1']);
    });

    it('does not mutate the input array', () => {
        const input = [
            assumption({ id: 'a1', confidence: 'low' }),
            assumption({ id: 'a2', confidence: 'high' }),
        ];
        sortAssumptionsByConfidence(input);
        expect(input.map(a => a.id)).toEqual(['a1', 'a2']);
    });
});

describe('splitAssumptions', () => {
    it('separates unresolved from decided and sorts unresolved by confidence', () => {
        const { unresolved, decided } = splitAssumptions([
            assumption({ id: 'a1', confidence: 'low' }),
            assumption({ id: 'a2', confidence: 'high', decision: 'confirmed' }),
            assumption({ id: 'a3', confidence: 'high' }),
            assumption({ id: 'a4', confidence: 'med', decision: 'rejected' }),
        ]);
        expect(unresolved.map(a => a.id)).toEqual(['a3', 'a1']);
        expect(decided.map(a => a.id)).toEqual(['a2', 'a4']);
    });

    it('treats undefined input (legacy PRDs) as empty', () => {
        const { unresolved, decided } = splitAssumptions(undefined);
        expect(unresolved).toEqual([]);
        expect(decided).toEqual([]);
    });
});

describe('deriveDecisionLog', () => {
    it('includes decided assumptions and confirmed features, never unresolved items', () => {
        const prd = basePRD({
            assumptions: [
                assumption({ id: 'a1', decision: 'confirmed', decidedAt: 100 }),
                assumption({ id: 'a2' }), // unresolved
                assumption({ id: 'a3', decision: 'rejected', decisionNote: 'Actually offline-first', decidedAt: 50 }),
            ],
            features: [
                feature({ id: 'f1', confirmed: true, confirmedAt: 75 }),
                feature({ id: 'f2' }), // unconfirmed
            ],
        });
        const log = deriveDecisionLog(prd);
        expect(log.map(e => e.id)).toEqual(['a3', 'f1', 'a1']); // chronological
        expect(log.find(e => e.id === 'a3')?.verdict).toBe('rejected');
        expect(log.find(e => e.id === 'a3')?.note).toBe('Actually offline-first');
        expect(log.find(e => e.id === 'f1')?.kind).toBe('feature');
        expect(log.some(e => e.id === 'a2' || e.id === 'f2')).toBe(false);
    });

    it('is empty for legacy PRDs with no decisions', () => {
        const prd = basePRD({
            assumptions: [assumption({ id: 'a1' })],
            features: [feature({ id: 'f1' })],
        });
        expect(deriveDecisionLog(prd)).toEqual([]);
    });

    it('sorts undated entries last, in document order', () => {
        const prd = basePRD({
            assumptions: [
                assumption({ id: 'a1', decision: 'confirmed' }), // undated
                assumption({ id: 'a2', decision: 'confirmed', decidedAt: 10 }),
            ],
        });
        expect(deriveDecisionLog(prd).map(e => e.id)).toEqual(['a2', 'a1']);
    });

    it('records deferred (tier later) features as Deferred entries', () => {
        const prd = basePRD({
            features: [
                feature({ id: 'f1', tier: 'mvp' }),
                feature({ id: 'f10', name: 'Anki CSV Export', description: 'Export flashcards to CSV', tier: 'later' }),
            ],
        });
        const log = deriveDecisionLog(prd);
        expect(log).toHaveLength(1);
        expect(log[0]).toMatchObject({
            id: 'f10',
            kind: 'feature',
            verdict: 'deferred',
            statement: 'Anki CSV Export',
            note: 'Export flashcards to CSV',
        });
    });

    it('records mvpScope.later items as Deferred, resolving and deduping against deferred features', () => {
        const prd = basePRD({
            features: [
                feature({ id: 'f10', name: 'Anki CSV Export', tier: 'later' }),
            ],
            mvpScope: {
                mvp: [],
                v1: [],
                later: [
                    'Anki CSV Export (f10): Utility to export flashcards', // dupes the f10 feature
                    'Team workspaces someday', // plain prose
                ],
            },
        });
        const log = deriveDecisionLog(prd);
        const deferred = log.filter(e => e.verdict === 'deferred');
        expect(deferred).toHaveLength(2); // f10 logged once, prose item kept
        expect(deferred[0].id).toBe('f10');
        expect(deferred[1]).toMatchObject({ kind: 'scope', statement: 'Team workspaces someday', label: '' });
    });

    it('defers an UNTAGGED feature named by mvpScope.later (feature entry, not raw scope)', () => {
        const prd = basePRD({
            features: [feature({ id: 'f9', name: 'Anki Export' })], // no tier
            mvpScope: { mvp: [], v1: [], later: ['Anki Export (f9): CSV utility'] },
        });
        const log = deriveDecisionLog(prd);
        expect(log).toHaveLength(1);
        expect(log[0]).toMatchObject({ id: 'f9', kind: 'feature', verdict: 'deferred' });
    });

    it('logs a later item naming an explicitly mvp-tagged feature as a raw scope record (tier wins)', () => {
        const prd = basePRD({
            features: [feature({ id: 'f1', name: 'Quick Capture', tier: 'mvp' })],
            mvpScope: { mvp: [], v1: [], later: ['Advanced Quick Capture filters'] },
        });
        const log = deriveDecisionLog(prd);
        expect(log).toHaveLength(1);
        expect(log[0]).toMatchObject({
            kind: 'scope',
            verdict: 'deferred',
            statement: 'Advanced Quick Capture filters',
        });
    });

    it('places deferred entries after dated user decisions', () => {
        const prd = basePRD({
            assumptions: [assumption({ id: 'a1', decision: 'confirmed', decidedAt: 10 })],
            features: [feature({ id: 'f3', tier: 'later' })],
        });
        expect(deriveDecisionLog(prd).map(e => e.id)).toEqual(['a1', 'f3']);
    });
});

describe('resolveScopeFeature', () => {
    const features = [
        feature({ id: 'f1', name: 'Quick Capture' }),
        feature({ id: 'f2', name: 'Weekly Review' }),
        feature({ id: 'f12', name: 'Weekly Review Digest' }),
    ];

    it('matches an explicit id token and strips it from the secondary text', () => {
        const m = resolveScopeFeature('F1: Quick Capture — one-tap logging', features);
        expect(m.feature?.id).toBe('f1');
        expect(m.secondary).toBe('one-tap logging');
    });

    it('matches by feature name when no id token is present', () => {
        const m = resolveScopeFeature('Weekly Review for retros', features);
        expect(m.feature?.id).toBe('f2');
        expect(m.secondary).toBe('for retros');
    });

    it('prefers the longest name match', () => {
        const m = resolveScopeFeature('Weekly Review Digest emails', features);
        expect(m.feature?.id).toBe('f12');
    });

    it('never matches a short feature name inside an unrelated word', () => {
        const withAi = [...features, feature({ id: 'f9', name: 'AI' })];
        // "Daily digest" contains "ai" as a substring of "Daily" — a token
        // match must NOT resolve it to the "AI" feature.
        const m = resolveScopeFeature('Daily digest emails', withAi);
        expect(m.feature).toBeUndefined();
        // …while a real whole-token reference still resolves.
        const hit = resolveScopeFeature('AI smart replies', withAi);
        expect(hit.feature?.id).toBe('f9');
        expect(hit.secondary).toBe('smart replies');
    });

    it('returns no match for plain prose items (renders raw string)', () => {
        expect(resolveScopeFeature('Basic auth and onboarding', features).feature).toBeUndefined();
    });

    it('returns no match when the PRD has no features', () => {
        expect(resolveScopeFeature('F1: anything', []).feature).toBeUndefined();
    });

    it('omits secondary when the item is only the feature reference', () => {
        const m = resolveScopeFeature('F2: Weekly Review', features);
        expect(m.feature?.id).toBe('f2');
        expect(m.secondary).toBeUndefined();
    });

    it('strips the empty parens left behind by a bracketed id ("Name (F1): …")', () => {
        const m = resolveScopeFeature('Quick Capture (F1): one-tap logging', features);
        expect(m.feature?.id).toBe('f1');
        // Must not render as "(): one-tap logging".
        expect(m.secondary).toBe('one-tap logging');
    });
});

describe('isDisplayableFeatureId', () => {
    it('accepts short human tokens and rejects uuids', () => {
        expect(isDisplayableFeatureId('f1')).toBe(true);
        expect(isDisplayableFeatureId('F12')).toBe(true);
        expect(isDisplayableFeatureId('a-3')).toBe(true);
        expect(isDisplayableFeatureId('550e8400-e29b-41d4-a716-446655440000')).toBe(false);
        expect(isDisplayableFeatureId(undefined)).toBe(false);
        expect(isDisplayableFeatureId('')).toBe(false);
    });
});
