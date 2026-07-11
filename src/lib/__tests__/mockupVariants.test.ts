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

    it('recommends a Mobile · Default for P0 screens on a mobile-relevant project', () => {
        const index = buildScreenIndex(makeInventory([p0Screen]), [], null);
        const variants = buildScreenMockupVariants(index.items[0], { mobileRelevant: true });
        const mobile = variants.find(v => v.id === 'mobile:default');
        expect(mobile).toBeDefined();
        expect(mobile!.viewport).toBe('mobile');
        expect(mobile!.required).toBe(true);
        expect(mobile!.status).toBe('missing');
    });

    it('does NOT recommend a Mobile default for a P0 screen on a web/desktop project', () => {
        // Regression: a web/desktop project (mobileRelevant false) must never
        // surface a Mobile variant — not even for its P0 screens — so it does
        // not warn about mobile coverage it will never ship.
        const index = buildScreenIndex(makeInventory([p0Screen]), [], null);
        const variants = buildScreenMockupVariants(index.items[0]);
        expect(variants.find(v => v.viewport === 'mobile')).toBeUndefined();
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
        const variants = buildScreenMockupVariants(index.items[0], { mobileRelevant: true });
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
        const summary = summarizeScreenVariants(buildScreenMockupVariants(index.items[0], { mobileRelevant: true }));
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
        const rollup = buildMockupVariantCoverageSummary(index, { mobileRelevant: true })!;
        expect(rollup.p0Total).toBe(1);
        expect(rollup.p0WithMobile).toBe(0); // no mobile mockup for the P0 screen
        expect(rollup.legacyUnknownMockups).toBe(1);
        expect(rollup.recommendedGenerated).toBe(1);
        expect(rollup.recommendedTotal).toBeGreaterThan(1);
    });

    it('does not track P0 mobile coverage for a web/desktop project', () => {
        // Regression: no Mobile variant is recommended for a non-mobile project,
        // so p0Total is 0 and the "Mobile coverage (P0)" panel row stays hidden.
        const index = buildScreenIndex(
            makeInventory([p0Screen, supportingScreen]),
            [],
            makeMockupPayload([{ id: 'm1', name: 'Home Dashboard', sourceScreenId: 'scr-home' }]),
        );
        const rollup = buildMockupVariantCoverageSummary(index)!;
        expect(rollup.p0Total).toBe(0);
        expect(rollup.p0WithMobile).toBe(0);
    });

    it('returns null for an empty index', () => {
        const index = buildScreenIndex(null, [], null);
        expect(buildMockupVariantCoverageSummary(index)).toBeNull();
    });

    it('counts manifest-backed generated variants separately from legacy-unknown coverage', () => {
        const index = buildScreenIndex(
            makeInventory([p0Screen]),
            [],
            makeMockupPayload([{ id: 'm1', name: 'Home Dashboard', sourceScreenId: 'scr-home' }]),
        );
        // The Mobile · Default variant is generated with an "aligned" manifest.
        const rollup = buildMockupVariantCoverageSummary(index, {
            mobileRelevant: true,
            generatedVariantsByScreen: (id) =>
                id === 'scr-home' ? { 'mobile:default': { coverage: 'aligned' } } : undefined,
        })!;
        expect(rollup.manifestBackedGenerated).toBe(1);
        // Legacy default mockup still has no manifest → unknown.
        expect(rollup.legacyUnknownMockups).toBe(1);
        // Mobile default now counts as generated + P0 mobile covered.
        expect(rollup.p0WithMobile).toBe(1);
        expect(rollup.recommendedGenerated).toBe(2); // desktop default (legacy) + mobile default
    });
});

// --- Phase 3B: generated-variant threading ------------------------------------

describe('buildScreenMockupVariants with generatedVariants (Phase 3B)', () => {
    it('flips a missing non-default variant to generated with manifest coverage', () => {
        const index = buildScreenIndex(makeInventory([p0Screen]), [], null);
        const variants = buildScreenMockupVariants(index.items[0], {
            mobileRelevant: true,
            generatedVariants: { 'mobile:default': { coverage: 'aligned' } },
        });
        const mobile = variants.find(v => v.id === 'mobile:default')!;
        expect(mobile.status).toBe('generated');
        expect(mobile.source).toBe('variant');
        expect(mobile.coverageStatus).toBe('aligned');
        // Other variants stay missing.
        expect(variants.find(v => v.id === 'state:loading')!.status).toBe('missing');
    });

    it('never applies generatedVariants to the legacy default slot', () => {
        const index = buildScreenIndex(makeInventory([supportingScreen]), [], null);
        // Even if a stray "default" entry exists, the default slot reads the
        // legacy mockup join, not this map.
        const variants = buildScreenMockupVariants(index.items[0], {
            generatedVariants: { 'default': { coverage: 'aligned' } },
        });
        const dflt = variants.find(v => v.id === 'default')!;
        expect(dflt.status).toBe('missing');
        expect(dflt.source).toBe('derived_missing');
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
        const rollup = buildMockupVariantCoverageSummary(index, { mobileRelevant: true })!;
        // Only desktop default counts toward the denominator now.
        expect(rollup.recommendedTotal).toBe(1);
        expect(rollup.recommendedGenerated).toBe(0);
        // A deliberately-skipped mobile default is "handled", not a gap.
        expect(rollup.p0WithMobile).toBe(1);
        expect(rollup.p0Total).toBe(1);
    });
});

// --- SYN-003: image-presence gating of the primary Default variant -----------

describe('buildScreenMockupVariants with defaultImagePresence (SYN-003)', () => {
    const joinedIndex = () => buildScreenIndex(
        makeInventory([{ id: 'scr-x', name: 'Screen X', priority: 'P0', purpose: 'p' }]),
        [],
        makeMockupPayload([{ id: 'm1', name: 'Screen X', sourceScreenId: 'scr-x' }]),
    );

    it('option omitted → byte-identical legacy behavior (spec join = generated)', () => {
        const item = joinedIndex().items[0];
        const legacy = buildScreenMockupVariants(item);
        const explicitUnknown = buildScreenMockupVariants(item, { defaultImagePresence: 'unknown' });
        const dfltLegacy = legacy.find(v => v.id === 'default')!;
        const dfltUnknown = explicitUnknown.find(v => v.id === 'default')!;
        expect(dfltLegacy.status).toBe('generated');
        expect(dfltLegacy.source).toBe('legacy');
        // 'unknown' is exactly the legacy path (imagePresence aside).
        expect(dfltUnknown.status).toBe('generated');
        expect(dfltUnknown.source).toBe('legacy');
        expect(dfltLegacy.imagePresence).toBe('unknown');
    });

    it("presence 'present' → unchanged (generated / legacy)", () => {
        const dflt = buildScreenMockupVariants(joinedIndex().items[0], {
            defaultImagePresence: 'present',
        }).find(v => v.id === 'default')!;
        expect(dflt.status).toBe('generated');
        expect(dflt.source).toBe('legacy');
        expect(dflt.imagePresence).toBe('present');
    });

    it("presence 'checking' → stays generated but imagePresence is 'checking'", () => {
        const dflt = buildScreenMockupVariants(joinedIndex().items[0], {
            defaultImagePresence: 'checking',
        }).find(v => v.id === 'default')!;
        expect(dflt.status).toBe('generated');
        expect(dflt.imagePresence).toBe('checking');
    });

    it("presence 'absent' → missing / derived_missing / unknown coverage + honest note", () => {
        const dflt = buildScreenMockupVariants(joinedIndex().items[0], {
            defaultImagePresence: 'absent',
        }).find(v => v.id === 'default')!;
        expect(dflt.status).toBe('missing');
        expect(dflt.source).toBe('derived_missing');
        expect(dflt.coverageStatus).toBe('unknown');
        expect(dflt.imagePresence).toBe('absent');
        expect(dflt.notes.join(' ')).toMatch(/no rendered image was found/i);
    });

    it("an image-absent default reports hasMockup=false in the per-screen summary", () => {
        const variants = buildScreenMockupVariants(joinedIndex().items[0], {
            defaultImagePresence: 'absent',
        });
        expect(summarizeScreenVariants(variants).hasMockup).toBe(false);
        // With a real image present, the same screen reports hasMockup true.
        const present = buildScreenMockupVariants(joinedIndex().items[0], {
            defaultImagePresence: 'present',
        });
        expect(summarizeScreenVariants(present).hasMockup).toBe(true);
    });

    it('a user overlay override still wins over an absent image', () => {
        const index = buildScreenIndex(
            makeInventory([{ id: 'scr-x', name: 'Screen X', priority: 'P0', purpose: 'p' }]),
            [],
            makeMockupPayload([{ id: 'm1', name: 'Screen X', sourceScreenId: 'scr-x' }]),
            { 'scr-x': { mockupVariantStatus: { 'default': 'accepted' } } },
        );
        const dflt = buildScreenMockupVariants(index.items[0], {
            defaultImagePresence: 'absent',
        }).find(v => v.id === 'default')!;
        expect(dflt.status).toBe('accepted');
        expect(dflt.userSet).toBe(true);
    });

    it('the rollup drops an image-absent default via defaultImagePresenceByScreen', () => {
        const index = joinedIndex();
        const withImage = buildMockupVariantCoverageSummary(index, {
            defaultImagePresenceByScreen: () => 'present',
        })!;
        const withoutImage = buildMockupVariantCoverageSummary(index, {
            defaultImagePresenceByScreen: () => 'absent',
        })!;
        // Same recommended total; but the absent default is no longer counted
        // as generated.
        expect(withImage.recommendedGenerated).toBeGreaterThan(withoutImage.recommendedGenerated);
        // An absent default is not a manifest-backed / legacy-image mockup, so it
        // drops out of the legacy-unknown tally too.
        expect(withoutImage.legacyUnknownMockups).toBe(0);
    });
});
