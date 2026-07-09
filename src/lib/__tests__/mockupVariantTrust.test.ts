import { describe, it, expect } from 'vitest';
import type { ScreenItem } from '../../types';
import {
    computeScreenContractHash,
    buildVariantSourceSignature,
    compareVariantFreshness,
    summarizeVariantFreshness,
    type VariantContractInput,
    type MockupVariantSourceSignature,
    type MockupVariantFreshness,
} from '../mockupVariantTrust';

const baseScreen = (overrides: Partial<ScreenItem> = {}): ScreenItem => ({
    id: 'scr-home',
    name: 'Home',
    priority: 'P0',
    purpose: 'The landing screen.',
    userIntent: 'See a summary.',
    coreUIElements: ['Feed', 'Header'],
    exitPaths: [{ label: 'Open settings', target: 'Settings' }],
    acceptanceCriteria: ['Loads under 2s'],
    states: [
        {
            name: 'Empty',
            description: 'No items yet.',
            type: 'empty',
            systemBehavior: 'Show an empty-state CTA.',
            needsMockup: true,
            acceptanceCriteria: ['Empty CTA visible'],
        },
    ],
    ...overrides,
});

const defaultInput = (screen: ScreenItem): VariantContractInput => ({
    screen,
    viewport: 'desktop',
    stateName: 'Default',
    stateType: 'default',
    variantId: 'default',
});

const emptyStateInput = (screen: ScreenItem): VariantContractInput => ({
    screen,
    viewport: 'desktop',
    stateName: 'Empty',
    stateType: 'empty',
    variantId: 'state:empty',
});

describe('computeScreenContractHash', () => {
    it('is deterministic for identical inputs', () => {
        const a = computeScreenContractHash(defaultInput(baseScreen()));
        const b = computeScreenContractHash(defaultInput(baseScreen()));
        expect(a).toBe(b);
    });

    it('changes when a relevant screen-state behavior changes', () => {
        const before = computeScreenContractHash(emptyStateInput(baseScreen()));
        const after = computeScreenContractHash(emptyStateInput(baseScreen({
            states: [{
                name: 'Empty',
                description: 'No items yet.',
                type: 'empty',
                systemBehavior: 'Show a different empty-state layout with onboarding tips.',
                needsMockup: true,
                acceptanceCriteria: ['Empty CTA visible'],
            }],
        })));
        expect(before).not.toBe(after);
    });

    it('changes when acceptance criteria change', () => {
        const before = computeScreenContractHash(defaultInput(baseScreen()));
        const after = computeScreenContractHash(defaultInput(baseScreen({
            acceptanceCriteria: ['Loads under 2s', 'Shows a welcome banner'],
        })));
        expect(before).not.toBe(after);
    });

    it('legacy-default mode ignores user actions / acceptance criteria the legacy prompt never used', () => {
        const input = (screen: ScreenItem): VariantContractInput => ({
            screen, viewport: 'desktop', stateName: 'Default', stateType: 'default',
            variantId: 'default', legacyDefault: true, legacyUIRegions: ['Feed', 'Header'],
        });
        const before = computeScreenContractHash(input(baseScreen()));
        // Changing acceptance criteria / exit paths must NOT move the legacy
        // default hash — the legacy prompt never requested those fields.
        const after = computeScreenContractHash(input(baseScreen({
            acceptanceCriteria: ['Totally different criteria'],
            exitPaths: [{ label: 'A brand new action', target: 'Elsewhere' }],
        })));
        expect(before).toBe(after);
        // But changing the legacy UI regions DOES move it.
        const changedUI = computeScreenContractHash({
            screen: baseScreen(), viewport: 'desktop', stateName: 'Default', stateType: 'default',
            variantId: 'default', legacyDefault: true, legacyUIRegions: ['Feed', 'New Panel'],
        });
        expect(changedUI).not.toBe(before);
    });

    it('does not change for unrelated UI-only metadata', () => {
        // notes / reviewStatus / mockupVariantStatus live on the overlay, never
        // on the ScreenItem the hash reads — so cosmetic fields can't move it.
        const before = computeScreenContractHash(defaultInput(baseScreen()));
        // navigationFrom is a legacy display-only field not in the contract.
        const after = computeScreenContractHash(defaultInput(baseScreen({
            navigationFrom: ['Somewhere'],
            navigationTo: ['Elsewhere'],
        })));
        expect(before).toBe(after);
    });
});

const ctx = {
    prdVersionId: 'prd-1',
    screenVersionId: 'inv-1',
    designSystemVersionId: 'ds-1',
    designSystemHash: 'dshash1',
};

describe('compareVariantFreshness', () => {
    it('is current when stored and current signatures match', () => {
        const screen = baseScreen();
        const sig = buildVariantSourceSignature(defaultInput(screen), ctx, '2026-01-01T00:00:00.000Z');
        const current = buildVariantSourceSignature(defaultInput(screen), ctx, '2026-02-01T00:00:00.000Z');
        const result = compareVariantFreshness(sig, current);
        expect(result.status).toBe('current');
    });

    it('is stale when the screen-contract hash changes', () => {
        const stored = buildVariantSourceSignature(defaultInput(baseScreen()), ctx, '2026-01-01T00:00:00.000Z');
        const current = buildVariantSourceSignature(
            defaultInput(baseScreen({ purpose: 'A completely rewritten purpose.' })),
            ctx,
            '2026-02-01T00:00:00.000Z',
        );
        const result = compareVariantFreshness(stored, current);
        expect(result.status).toBe('stale');
        expect(result.reasons.some(r => /screen spec/i.test(r))).toBe(true);
    });

    it('is stale when the design system hash changes', () => {
        const screen = baseScreen();
        const stored = buildVariantSourceSignature(defaultInput(screen), ctx, '2026-01-01T00:00:00.000Z');
        const current = buildVariantSourceSignature(
            defaultInput(screen),
            { ...ctx, designSystemHash: 'dshash2', designSystemVersionId: 'ds-2' },
            '2026-02-01T00:00:00.000Z',
        );
        const result = compareVariantFreshness(stored, current);
        expect(result.status).toBe('stale');
        expect(result.reasons.some(r => /design system/i.test(r))).toBe(true);
    });

    it('is possibly_stale when version metadata changes but hashes are missing', () => {
        const screen = baseScreen();
        // Neither side carries a design-system hash — only version ids differ.
        const noHashCtx = { prdVersionId: 'prd-1', screenVersionId: 'inv-1', designSystemVersionId: 'ds-1' };
        const stored = buildVariantSourceSignature(defaultInput(screen), noHashCtx, '2026-01-01T00:00:00.000Z');
        const current = buildVariantSourceSignature(
            defaultInput(screen),
            { ...noHashCtx, designSystemVersionId: 'ds-2' },
            '2026-02-01T00:00:00.000Z',
        );
        const result = compareVariantFreshness(stored, current);
        expect(result.status).toBe('possibly_stale');
    });

    it('is unknown for a legacy variant without a source signature', () => {
        const current = buildVariantSourceSignature(defaultInput(baseScreen()), ctx, '2026-02-01T00:00:00.000Z');
        const result = compareVariantFreshness(undefined, current);
        expect(result.status).toBe('unknown');
    });
});

describe('summarizeVariantFreshness', () => {
    it('counts current / review / unknown correctly and never treats unknown as stale', () => {
        const mk = (status: MockupVariantFreshness['status']): MockupVariantFreshness => ({
            status, reasons: [], severity: 'info', estimated: true,
        });
        const rollup = summarizeVariantFreshness([
            mk('current'), mk('current'),
            mk('stale'), mk('possibly_stale'),
            mk('unknown'), mk('unknown'), mk('unknown'),
        ]);
        expect(rollup.current).toBe(2);
        expect(rollup.review).toBe(2);
        expect(rollup.unknown).toBe(3);
        expect(rollup.total).toBe(7);
    });
});

describe('signature provenance', () => {
    it('captures the version context and screen identity', () => {
        const sig: MockupVariantSourceSignature = buildVariantSourceSignature(
            emptyStateInput(baseScreen()), ctx, '2026-01-01T00:00:00.000Z',
        );
        expect(sig.screenId).toBe('scr-home');
        expect(sig.variantId).toBe('state:empty');
        expect(sig.viewport).toBe('desktop');
        expect(sig.designSystemHash).toBe('dshash1');
        expect(sig.prdVersionId).toBe('prd-1');
        expect(sig.createdAt).toBe('2026-01-01T00:00:00.000Z');
    });
});
