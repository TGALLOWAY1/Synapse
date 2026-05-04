import { describe, it, expect } from 'vitest';
import { mergeSectionsToStructuredPrd, parseSectionResults, type SectionResults } from '../services/prdSectionMerge';

// Helper: build SectionResults from plain partial objects
const sr = (map: Record<string, object | null>): SectionResults =>
    Object.fromEntries(
        Object.entries(map).map(([k, v]) => [k, { value: v as object | null, ok: v !== null }]),
    ) as SectionResults;

describe('mergeSectionsToStructuredPrd', () => {
    it('merges product_basics fields into the output', () => {
        const merged = mergeSectionsToStructuredPrd(sr({
            product_basics: { vision: 'Be the best', targetUsers: ['Developers'], coreProblem: 'Too slow' },
        }));
        expect(merged.vision).toBe('Be the best');
        expect(merged.targetUsers).toEqual(['Developers']);
        expect(merged.coreProblem).toBe('Too slow');
    });

    it('stubs required fields when all sections fail or are absent', () => {
        const merged = mergeSectionsToStructuredPrd({});
        expect(merged.vision).toBe('');
        expect(merged.targetUsers).toEqual([]);
        expect(merged.coreProblem).toBe('');
        expect(merged.features).toEqual([]);
    });

    it('later section fields are merged alongside earlier ones', () => {
        const merged = mergeSectionsToStructuredPrd(sr({
            product_basics: { vision: 'Great vision', targetUsers: ['PM'], coreProblem: 'Slow' },
            product_thesis: { productThesis: { whyExist: 'X', whyNow: 'Y', differentiation: 'Z', intentionalTradeoffs: [], nonGoals: [] } },
        }));
        expect(merged.vision).toBe('Great vision');
        expect(merged.productThesis?.whyExist).toBe('X');
    });

    it('handles null section results gracefully', () => {
        const merged = mergeSectionsToStructuredPrd(sr({ product_basics: null, features: null }));
        expect(merged.features).toEqual([]);
    });
});

describe('parseSectionResults', () => {
    it('passes through already-parsed objects', () => {
        const result = parseSectionResults({ product_basics: { vision: 'v' } });
        expect(result.product_basics.ok).toBe(true);
        expect(result.product_basics.value?.vision).toBe('v');
    });

    it('marks null sections as not ok', () => {
        const result = parseSectionResults({ product_basics: null });
        expect(result.product_basics.ok).toBe(false);
        expect(result.product_basics.value).toBeNull();
    });

    it('parses JSON string values', () => {
        const raw = { features: '{"features":[{"id":"f1","title":"Login"}]}' } as unknown as Record<string, object | null>;
        const result = parseSectionResults(raw as Record<string, object | null>);
        expect(result.features.ok).toBe(true);
        expect(Array.isArray((result.features.value as { features?: unknown[] })?.features)).toBe(true);
    });

    it('returns not-ok on unparseable string', () => {
        const raw = { features: 'not json at all <<<' } as unknown as Record<string, object | null>;
        const result = parseSectionResults(raw as Record<string, object | null>);
        expect(result.features.ok).toBe(false);
    });
});
