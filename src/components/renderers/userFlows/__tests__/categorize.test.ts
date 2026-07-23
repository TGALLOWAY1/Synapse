import { describe, expect, it } from 'vitest';
import { CATEGORY_ORDER, categorize, displayNumbers } from '../categorize';
import type { ParsedFlow } from '../types';

function stubFlow(category: ParsedFlow['category']): ParsedFlow {
    return {
        title: category,
        rawTitle: category,
        category,
        steps: [],
        errorPaths: [],
        issues: [],
        entryPoints: [],
        inferredEntryPoints: [],
        inferredSystems: [],
        featureRefs: [],
    };
}

describe('categorize', () => {
    it('falls back to Core Experience when no keyword rule matches', () => {
        expect(categorize('Some generic flow', 'Do a generic thing')).toBe('Core Experience');
    });

    it('matches onboarding keywords', () => {
        expect(categorize('Welcome tour', undefined)).toBe('Onboarding');
    });
});

describe('displayNumbers', () => {
    it('numbers flows 1..N in authored order when categories already match CATEGORY_ORDER', () => {
        const flows = [stubFlow('Onboarding'), stubFlow('Auth & Identity'), stubFlow('Core Experience')];
        expect(displayNumbers(flows)).toEqual([1, 2, 3]);
    });

    it('numbers flows by grouped visual order, not authored order, when categories are out of CATEGORY_ORDER order', () => {
        // Authored order: Other, Core Experience, Onboarding, Auth & Identity —
        // deliberately the reverse of CATEGORY_ORDER, so a naive
        // `originalIndex + 1` would render 1, 2, 3, 4 in an order that doesn't
        // match the grouped sections the sidebar actually renders.
        const flows = [
            stubFlow('Other'),           // originalIndex 0 → group order 4 (last)
            stubFlow('Core Experience'), // originalIndex 1 → group order 3
            stubFlow('Onboarding'),      // originalIndex 2 → group order 1
            stubFlow('Auth & Identity'), // originalIndex 3 → group order 2
        ];
        // CATEGORY_ORDER = Onboarding, Auth & Identity, Core Experience,
        // Sharing & Collaboration, Other.
        expect(CATEGORY_ORDER).toEqual([
            'Onboarding', 'Auth & Identity', 'Core Experience', 'Sharing & Collaboration', 'Other',
        ]);
        expect(displayNumbers(flows)).toEqual([4, 3, 1, 2]);
    });

    it('keeps two flows in the same category in their authored (stable) relative order', () => {
        const flows = [
            stubFlow('Core Experience'), // originalIndex 0
            stubFlow('Onboarding'),      // originalIndex 1
            stubFlow('Core Experience'), // originalIndex 2 — same category as index 0
        ];
        // Onboarding group (originalIndex 1) comes first → 1; then Core
        // Experience group preserves authored order: index 0 → 2, index 2 → 3.
        expect(displayNumbers(flows)).toEqual([2, 1, 3]);
    });
});
