import { describe, expect, it } from 'vitest';
import type { MockupPayload, ScreenInventoryContent, ScreenItem } from '../../types';
import { buildScreenIndex } from '../screenExperience';
import {
    buildMockupVariantCoverageSummary,
    buildScreenMockupVariants,
    formatVariantLabel,
    normalizeScreenPriority,
    summarizeScreenVariants,
    viewportFromPlatform,
} from '../mockupVariants';

// --- Fixtures -----------------------------------------------------------------

const p0Screen: ScreenItem = {
    id: 'scr-home',
    name: 'Home Dashboard',
    priority: 'P0',
    purpose: 'Landing surface.',
    states: [
        { name: 'Default', description: 'Shows the feed', type: 'default' },
        { name: 'Empty History', description: 'No activity yet', type: 'empty', needsMockup: true },
        { name: 'Loading', description: 'Fetching', type: 'loading' },
    ],
};

const supportingScreen: ScreenItem = {
    id: 'scr-settings',
    name: 'Settings',
    priority: 'P2',
    purpose: 'Adjust preferences.',
};

function makeInventory(screens: ScreenItem[]): ScreenInventoryContent {
    return { sections: [{ title: 'Main', screens }] };
}

function makeMockupPayload(
    screens: Array<{ id: string; name: string; sourceScreenId?: string; coreUIElements?: string[] }>,
): MockupPayload {
    return {
        version: 'mockup_spec_v1',
        title: 'Mockups',
        summary: 'Test payload',
        screens: screens.map(s => ({ purpose: 'p', ...s })),
    };
}

// --- viewportFromPlatform -----------------------------------------------------

describe('viewportFromPlatform', () => {
    it('maps platforms, defaulting responsive/undefined to desktop', () => {
        expect(viewportFromPlatform('mobile')).toBe('mobile');
        expect(viewportFromPlatform('desktop')).toBe('desktop');
        expect(viewportFromPlatform('responsive')).toBe('desktop');
        expect(viewportFromPlatform(undefined)).toBe('desktop');
    });
});

describe('normalizeScreenPriority', () => {
    it('preserves the P0 distinction for legacy priorities', () => {
        expect(normalizeScreenPriority('core')).toBe('P0');
        expect(normalizeScreenPriority('secondary')).toBe('P1');
        expect(normalizeScreenPriority('supporting')).toBe('P2');
        expect(normalizeScreenPriority('P0')).toBe('P0');
    });
});

describe('formatVariantLabel', () => {
    it('renders "Viewport · State"', () => {
        expect(formatVariantLabel({ viewport: 'desktop', stateName: 'Default' })).toBe('Desktop · Default');
        expect(formatVariantLabel({ viewport: 'mobile', stateName: 'Empty History' })).toBe('Mobile · Empty History');
    });
});

// --- buildScreenMockupVariants ------------------------------------------------

describe('buildScreenMockupVariants', () => {
    it('normalizes a legacy single mockup to Desktop · Default · Generated with unknown coverage', () => {
        const index = buildScreenIndex(
            makeInventory([{ id: 'scr-x', name: 'Screen X', priority: 'P0', purpose: 'p' }]),
            [],
            makeMockupPayload([{ id: 'm1', name: 'Screen X', sourceScreenId: 'scr-x' }]),
        );
        const variants = buildScreenMockupVariants(index.items[0]);
        const dflt = variants.find(v => v.id === 'default')!;
        expect(dflt.viewport).toBe('desktop');
        expect(dflt.stateName).toBe('Default');
        expect(dflt.status).toBe('generated');
        expect(dflt.source).toBe('legacy');
        expect(dflt.coverageStatus).toBe('unknown');
        expect(dflt.coverageEstimated).toBe(true);
        expect(formatVariantLabel(dflt)).toBe('Desktop · Default');
    });

    it('produces a missing Desktop · Default when the screen has no mockup', () => {
        const index = buildScreenIndex(makeInventory([supportingScreen]), [], null);
        const variants = buildScreenMockupVariants(index.items[0]);
        const dflt = variants.find(v => v.id === 'default')!;
        expect(dflt.status).toBe('missing');
        expect(dflt.viewport).toBe('desktop');
        expect(dflt.source).toBe('derived_missing');
    });

    it('recommends a Mobile · Default for P0 screens', () => {
        const index = buildScreenIndex(makeInventory([p0Screen]), [], null);
        const variants = buildScreenMockupVariants(index.items[0]);
        const mobile = variants.find(v => v.id === 'mobile:default');
        expect(mobile).toBeDefined();
        expect(mobile!.viewport).toBe('mobile');
        expect(mobile!.required).toBe(true);
        expect(mobile!.status).toBe('missing');
    });

    it('does NOT recommend Mobile default for a supporting screen unless mobile-relevant', () => {
        const index = buildScreenIndex(makeInventory([supportingScreen]), [], null);
        const noMobile = buildScreenMockupVariants(index.items[0]);
        expect(noMobile.find(v => v.viewport === 'mobile')).toBeUndefined();

        const withMobile = buildScreenMockupVariants(index.items[0], { mobileRelevant: true });
        expect(withMobile.find(v => v.viewport === 'mobile')).toBeDefined();
    });

    it('turns documented important states into recommended state variants', () => {
        const index = buildScreenIndex(makeInventory([p0Screen]), [], null);
        const variants = buildScreenMockupVariants(index.items[0]);
        const stateVariants = variants.filter(v => v.stateType && v.stateType !== 'default');
        const names = stateVariants.map(v => v.stateName).sort();
        expect(names).toEqual(['Empty History', 'Loading']);
        // The explicit default-type state folds into the desktop Default row
        // (not duplicated as a state variant).
        expect(variants.filter(v => v.viewport === 'desktop' && v.stateType === 'default')).toHaveLength(1);
    });

    it('an existing generated variant prevents a duplicate missing placeholder for that slot', () => {
        const index = buildScreenIndex(
            makeInventory([p0Screen]),
            [],
            makeMockupPayload([{ id: 'm1', name: 'Home Dashboard', sourceScreenId: 'scr-home' }]),
        );
        const variants = buildScreenMockupVariants(index.items[0]);
        const defaults = variants.filter(v => v.stateType === 'default' && v.viewport === 'desktop');
        expect(defaults).toHaveLength(1);
        expect(defaults[0].status).toBe('generated');
    });

    it('honors the user overlay (accepted / not_needed)', () => {
        const index = buildScreenIndex(makeInventory([p0Screen]), [], null, {
            'scr-home': { mockupVariantStatus: { 'mobile:default': 'accepted', 'state:loading': 'not_needed' } },
        });
        const variants = buildScreenMockupVariants(index.items[0]);
        expect(variants.find(v => v.id === 'mobile:default')!.status).toBe('accepted');
        expect(variants.find(v => v.id === 'mobile:default')!.userSet).toBe(true);
        expect(variants.find(v => v.id === 'state:loading')!.status).toBe('not_needed');
    });

    it('marks generated mockup coverage from spec-to-spec token overlap when metadata exists', () => {
        const inv = makeInventory([{
            id: 'scr-x', name: 'Screen X', priority: 'P0', purpose: 'p',
            coreUIElements: ['Activity feed', 'Header bar'],
        }]);
        const index = buildScreenIndex(inv, [], makeMockupPayload([
            { id: 'm1', name: 'Screen X', sourceScreenId: 'scr-x', coreUIElements: ['Activity feed', 'Header bar'] },
        ]));
        const variants = buildScreenMockupVariants(index.items[0]);
        expect(variants.find(v => v.id === 'default')!.coverageStatus).toBe('aligned');
    });

    it('does not throw on a screen with no priority / states / spec data', () => {
        const index = buildScreenIndex(
            // deliberately sparse — priority coerced, no states, no purpose
            { sections: [{ title: 'X', screens: [{ name: 'Sparse' } as ScreenItem] }] },
            [],
            null,
        );
        expect(() => buildScreenMockupVariants(index.items[0])).not.toThrow();
        const variants = buildScreenMockupVariants(index.items[0]);
        expect(variants.find(v => v.id === 'default')).toBeDefined();
    });
});

// --- summarizeScreenVariants --------------------------------------------------

describe('summarizeScreenVariants', () => {
    it('counts generated vs missing among recommended variants', () => {
        const index = buildScreenIndex(
            makeInventory([p0Screen]),
            [],
            makeMockupPayload([{ id: 'm1', name: 'Home Dashboard', sourceScreenId: 'scr-home' }]),
        );
        const summary = summarizeScreenVariants(buildScreenMockupVariants(index.items[0]));
        // recommended: desktop default (generated) + mobile default + Empty History + Loading = 4
        expect(summary.recommended).toBe(4);
        expect(summary.generated).toBe(1);
        expect(summary.missing).toBe(3);
        expect(summary.mobileMissing).toBe(true);
        expect(summary.hasMockup).toBe(true);
        expect(summary.coverageUnknown).toBe(true);
    });

    it('reports "No mockup yet" when nothing is generated', () => {
        const index = buildScreenIndex(makeInventory([supportingScreen]), [], null);
        const summary = summarizeScreenVariants(buildScreenMockupVariants(index.items[0]));
        expect(summary.hasMockup).toBe(false);
        expect(summary.label).toBe('No mockup yet');
    });

    it('excludes not_needed variants from the recommended total (resolved gap)', () => {
        const index = buildScreenIndex(makeInventory([p0Screen]), [], null, {
            'scr-home': {
                mockupVariantStatus: {
                    'mobile:default': 'not_needed',
                    'state:empty-history': 'not_needed',
                    'state:loading': 'not_needed',
                },
            },
        });
        const summary = summarizeScreenVariants(buildScreenMockupVariants(index.items[0]));
        // Only the desktop default remains recommended; not-needed rows drop out
        // of both the denominator and the missing count.
        expect(summary.recommended).toBe(1);
        expect(summary.missing).toBe(1); // desktop default has no mockup
        expect(summary.mobileMissing).toBe(false);
    });

    it('keeps hasMockup/coverageUnknown true after the generated default is accepted', () => {
        const index = buildScreenIndex(
            makeInventory([{ id: 'scr-x', name: 'Screen X', priority: 'P0', purpose: 'p' }]),
            [],
            makeMockupPayload([{ id: 'm1', name: 'Screen X', sourceScreenId: 'scr-x' }]),
            { 'scr-x': { mockupVariantStatus: { 'default': 'accepted' } } },
        );
        const summary = summarizeScreenVariants(buildScreenMockupVariants(index.items[0]));
        // Marking the default accepted flips its status off 'generated', but the
        // image still exists — presence must survive.
        expect(summary.hasMockup).toBe(true);
        expect(summary.coverageUnknown).toBe(true);
    });
});

// --- buildMockupVariantCoverageSummary ----------------------------------------

describe('buildMockupVariantCoverageSummary', () => {
    it('rolls up recommended coverage, P0 mobile coverage and legacy-unknown mockups', () => {
        const index = buildScreenIndex(
            makeInventory([p0Screen, supportingScreen]),
            [],
            makeMockupPayload([{ id: 'm1', name: 'Home Dashboard', sourceScreenId: 'scr-home' }]),
        );
        const rollup = buildMockupVariantCoverageSummary(index)!;
        expect(rollup.p0Total).toBe(1);
        expect(rollup.p0WithMobile).toBe(0); // no mobile mockup for the P0 screen
        expect(rollup.legacyUnknownMockups).toBe(1);
        expect(rollup.recommendedGenerated).toBe(1);
        expect(rollup.recommendedTotal).toBeGreaterThan(1);
    });

    it('returns null for an empty index', () => {
        const index = buildScreenIndex(null, [], null);
        expect(buildMockupVariantCoverageSummary(index)).toBeNull();
    });

    it('drops not_needed variants from the recommended total and treats not_needed mobile as handled', () => {
        const index = buildScreenIndex(makeInventory([p0Screen]), [], null, {
            'scr-home': {
                mockupVariantStatus: {
                    'mobile:default': 'not_needed',
                    'state:empty-history': 'not_needed',
                    'state:loading': 'not_needed',
                },
            },
        });
        const rollup = buildMockupVariantCoverageSummary(index)!;
        // Only desktop default counts toward the denominator now.
        expect(rollup.recommendedTotal).toBe(1);
        expect(rollup.recommendedGenerated).toBe(0);
        // A deliberately-skipped mobile default is "handled", not a gap.
        expect(rollup.p0WithMobile).toBe(1);
        expect(rollup.p0Total).toBe(1);
    });
});
