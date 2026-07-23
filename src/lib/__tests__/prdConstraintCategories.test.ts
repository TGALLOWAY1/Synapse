import { describe, it, expect } from 'vitest';
import { parseConstraintItem, groupConstraintItems } from '../prdConstraintCategories';

describe('parseConstraintItem', () => {
    it('splits a leading category label off the text', () => {
        expect(parseConstraintItem('Performance: The library dashboard must load in under 1000ms (p95).'))
            .toEqual({ category: 'Performance', text: 'The library dashboard must load in under 1000ms (p95).' });
    });

    it('accepts multi-word and ampersand labels up to three words', () => {
        expect(parseConstraintItem('Data Protection: encrypt at rest').category).toBe('Data Protection');
        expect(parseConstraintItem('Quality & Performance: p95 under 2s').category).toBe('Quality & Performance');
    });

    it('leaves a sentence-like prefix alone', () => {
        const raw = 'The team must ship before the fiscal year ends: no exceptions';
        expect(parseConstraintItem(raw)).toEqual({ category: null, text: raw });
    });

    it('does not treat a URL or a bare colon as a label', () => {
        const url = 'Docs live at https://example.com/spec';
        expect(parseConstraintItem(url)).toEqual({ category: null, text: url });
        expect(parseConstraintItem('Security:').category).toBeNull();
    });

    it('returns the whole trimmed line when there is no label', () => {
        expect(parseConstraintItem('  Budget capped at $50k  '))
            .toEqual({ category: null, text: 'Budget capped at $50k' });
    });
});

describe('groupConstraintItems', () => {
    it('files repeat categories under one heading in first-seen order', () => {
        expect(groupConstraintItems([
            'Performance: p95 under 1000ms',
            'Security: URLs expire in 5 minutes',
            'Performance: jobs finish within 45s',
        ])).toEqual([
            { category: 'Performance', items: ['p95 under 1000ms', 'jobs finish within 45s'] },
            { category: 'Security', items: ['URLs expire in 5 minutes'] },
        ]);
    });

    it('matches categories case-insensitively but keeps the first spelling', () => {
        expect(groupConstraintItems(['Cost: cap spend', 'COST: prefer small models']))
            .toEqual([{ category: 'Cost', items: ['cap spend', 'prefer small models'] }]);
    });

    it('collects unlabelled lines into one leading heading-less group', () => {
        expect(groupConstraintItems([
            'Performance: p95 under 1000ms',
            'No native mobile app in the first release',
            'Ship before the end of the fiscal year',
        ])).toEqual([
            { category: null, items: ['No native mobile app in the first release', 'Ship before the end of the fiscal year'] },
            { category: 'Performance', items: ['p95 under 1000ms'] },
        ]);
    });

    it('drops empty lines', () => {
        expect(groupConstraintItems(['   ', ''])).toEqual([]);
    });
});
