import { describe, expect, it } from 'vitest';
import type { Feature, MockupPayload, ScreenInventoryContent, ScreenItem } from '../../types';
import { buildScreenIndex } from '../screenExperience';
import {
    buildMockupSpecCoverage,
    buildReadinessIndex,
    buildScreenCoverageSummary,
    buildScreenHandoff,
    buildScreenTraceability,
    deriveAcceptanceCriteria,
    deriveScreenReadiness,
    detectScreenGaps,
    normalizeFeatureId,
    screenMatchesFilter,
} from '../screenReadiness';
import { parseFlows } from '../../components/renderers/userFlows/parseFlow';

// --- Fixtures -----------------------------------------------------------------

/** A fully-specified screen that passes every derived readiness check. */
const readyScreen: ScreenItem = {
    id: 'scr-home',
    name: 'Home Dashboard',
    priority: 'P0',
    purpose: 'Landing surface summarizing recent activity.',
    userIntent: 'I want to see what changed since my last visit',
    featureRefs: ['F1: Activity feed'],
    states: [
        { name: 'Default', description: 'Shows the feed', trigger: 'data loads' },
        { name: 'Empty', description: 'Shows onboarding CTA', trigger: 'no activity yet' },
    ],
    entryPoints: ['App launch'],
    exitPaths: [
        { label: 'Open item', target: 'Item Detail', condition: 'an item exists' },
    ],
    coreUIElements: ['Activity feed', 'Header bar'],
    outputData: ['selected item id'],
    risks: [],
};

const bareScreen: ScreenItem = {
    id: 'scr-bare',
    name: 'Bare Screen',
    priority: 'P2',
    purpose: 'A minimal supporting screen.',
};

function makeInventory(screens: ScreenItem[]): ScreenInventoryContent {
    return { sections: [{ title: 'Main', screens }] };
}

function makeMockupPayload(screens: Array<{ id: string; name: string; sourceScreenId?: string; coreUIElements?: string[] }>): MockupPayload {
    return {
        version: 'mockup_spec_v1',
        title: 'Mockups',
        summary: 'Test payload',
        screens: screens.map(s => ({ purpose: 'p', ...s })),
    };
}

const FEATURES: Feature[] = [
    { id: 'F1', name: 'Activity feed', description: '', userValue: '', complexity: 'low' },
    { id: 'F2', name: 'Sharing', description: '', userValue: '', complexity: 'low' },
];

// --- Gap detection / readiness ---------------------------------------------------

describe('detectScreenGaps', () => {
    it('finds no gaps in a fully-specified P0 screen with a mockup', () => {
        expect(detectScreenGaps({ screen: readyScreen, hasMockup: true, flowRefCount: 1 })).toEqual([]);
    });

    it('flags missing traceability, states, navigation, and flow refs', () => {
        const gaps = detectScreenGaps({ screen: bareScreen, hasMockup: false, flowRefCount: 0 });
        const kinds = gaps.map(g => g.kind);
        expect(kinds).toContain('missing_traceability');
        expect(kinds).toContain('missing_states');
        expect(kinds).toContain('missing_navigation');
        expect(kinds).toContain('no_flow_refs');
        expect(kinds).not.toContain('missing_purpose');
    });

    it('flags a P0 screen without a mockup, but not a P2 one', () => {
        const p0 = detectScreenGaps({ screen: { ...readyScreen }, hasMockup: false, flowRefCount: 1 });
        expect(p0.map(g => g.kind)).toContain('missing_mockup_p0');
        const p2 = detectScreenGaps({
            screen: { ...readyScreen, priority: 'P2' }, hasMockup: false, flowRefCount: 1,
        });
        expect(p2.map(g => g.kind)).not.toContain('missing_mockup_p0');
    });

    it('treats the legacy "core" priority as P0 for the mockup gap', () => {
        const gaps = detectScreenGaps({
            screen: { ...readyScreen, priority: 'core' }, hasMockup: false, flowRefCount: 1,
        });
        expect(gaps.map(g => g.kind)).toContain('missing_mockup_p0');
    });

    it('flags risks as unresolved (no mitigation data exists in the spec)', () => {
        const gaps = detectScreenGaps({
            screen: { ...readyScreen, risks: ['localStorage may be corrupted'] },
            hasMockup: true,
            flowRefCount: 1,
        });
        expect(gaps.map(g => g.kind)).toEqual(['unresolved_risks']);
    });

    it('flags states that carry neither trigger nor description', () => {
        const gaps = detectScreenGaps({
            screen: { ...readyScreen, states: [{ name: 'Mystery', description: '' }] },
            hasMockup: true,
            flowRefCount: 1,
        });
        expect(gaps.map(g => g.kind)).toEqual(['states_without_behavior']);
    });
});

describe('deriveScreenReadiness', () => {
    it('derives implementation_ready when no gaps exist', () => {
        const r = deriveScreenReadiness({ screen: readyScreen, hasMockup: true, flowRefCount: 1 });
        expect(r.status).toBe('implementation_ready');
        expect(r.source).toBe('derived');
        expect(r.reasons).toEqual([]);
    });

    it('derives needs_review on review-trigger gaps (risks, missing states)', () => {
        const r = deriveScreenReadiness({
            screen: { ...readyScreen, risks: ['A risk'] }, hasMockup: true, flowRefCount: 1,
        });
        expect(r.status).toBe('needs_review');
        expect(r.reasons.length).toBeGreaterThan(0);
    });

    it('derives draft when only non-review gaps remain (e.g. navigation)', () => {
        const r = deriveScreenReadiness({
            screen: { ...readyScreen, exitPaths: [] }, hasMockup: true, flowRefCount: 1,
        });
        expect(r.status).toBe('draft');
    });

    it('a user-set status always wins and is marked as user-sourced', () => {
        const r = deriveScreenReadiness({
            screen: bareScreen, hasMockup: false, flowRefCount: 0, userStatus: 'accepted',
        });
        expect(r.status).toBe('accepted');
        expect(r.source).toBe('user');
        // Derived warnings are not hidden by the override.
        expect(r.gaps.map(g => g.kind)).toContain('accepted_with_warnings');
    });

    it('caps reasons and appends an "and N more" line', () => {
        const r = deriveScreenReadiness({
            screen: { name: 'X', priority: 'P0', purpose: '' } as ScreenItem,
            hasMockup: false,
            flowRefCount: 0,
        });
        expect(r.reasons.length).toBeLessThanOrEqual(4);
        expect(r.reasons[r.reasons.length - 1]).toMatch(/more\./);
    });
});

// --- Traceability -----------------------------------------------------------------

describe('buildScreenTraceability', () => {
    it('resolves featureRefs id tokens against the PRD feature list', () => {
        const index = buildScreenIndex(makeInventory([readyScreen]), [], null);
        const t = buildScreenTraceability(index.items[0], FEATURES);
        expect(t.completeness).toBe('estimated');
        expect(t.features).toHaveLength(1);
        expect(t.features[0].feature?.name).toBe('Activity feed');
    });

    it('keeps unresolved refs visible instead of dropping them', () => {
        const screen = { ...readyScreen, featureRefs: ['F9: Unknown thing'] };
        const index = buildScreenIndex(makeInventory([screen]), [], null);
        const t = buildScreenTraceability(index.items[0], FEATURES);
        expect(t.features[0].refId).toBe('F9');
        expect(t.features[0].feature).toBeUndefined();
    });

    it('reports missing completeness when no refs exist', () => {
        const index = buildScreenIndex(makeInventory([bareScreen]), [], null);
        const t = buildScreenTraceability(index.items[0], FEATURES);
        expect(t.completeness).toBe('missing');
        expect(t.features).toEqual([]);
    });

    it('normalizes feature ids for matching (F-1 ≡ f1)', () => {
        expect(normalizeFeatureId('F-1')).toBe(normalizeFeatureId('f1'));
    });
});

// --- Acceptance criteria ------------------------------------------------------------

describe('deriveAcceptanceCriteria', () => {
    it('derives criteria from intent, exits, states, and risks', () => {
        const criteria = deriveAcceptanceCriteria({
            ...readyScreen,
            risks: ['Corrupted local storage'],
        });
        expect(criteria.some(c => c.includes('what changed since my last visit'))).toBe(true);
        expect(criteria.some(c => c.includes('"Open item" takes the user to Item Detail when an item exists'))).toBe(true);
        expect(criteria.some(c => c.includes('"Empty" state appears when no activity yet'))).toBe(true);
        expect(criteria.some(c => c.includes('Corrupted local storage'))).toBe(true);
    });

    it('returns an empty list for a screen with nothing derivable', () => {
        expect(deriveAcceptanceCriteria(bareScreen)).toEqual([]);
    });

    it('caps and dedupes the list', () => {
        const screen: ScreenItem = {
            ...readyScreen,
            risks: Array.from({ length: 20 }, (_, i) => `Risk ${i}`),
        };
        const criteria = deriveAcceptanceCriteria(screen);
        expect(criteria.length).toBeLessThanOrEqual(8);
        expect(new Set(criteria).size).toBe(criteria.length);
    });
});

// --- Handoff ---------------------------------------------------------------------------

describe('buildScreenHandoff', () => {
    it('re-projects existing fields without inventing anything', () => {
        const h = buildScreenHandoff(readyScreen);
        expect(h.components).toEqual(['Activity feed', 'Header bar']);
        expect(h.states).toEqual(['Default', 'Empty']);
        expect(h.events).toEqual([
            { label: 'Open item', target: 'Item Detail', condition: 'an item exists' },
        ]);
        expect(h.outputs).toEqual(['selected item id']);
    });

    it('falls back to the legacy components alias', () => {
        const h = buildScreenHandoff({ ...bareScreen, components: ['Legacy chip'] });
        expect(h.components).toEqual(['Legacy chip']);
        expect(h.states).toEqual([]);
        expect(h.events).toEqual([]);
    });
});

// --- Coverage summary ---------------------------------------------------------------------

const FLOWS_MD = `### Flow: First Visit
**Goal:** Land and explore
**Steps:**
1. [Home Dashboard] — User opens the app → System loads the feed
2. [Item Detail] — User opens an item → System shows it

### Flow: Unrelated
**Goal:** Something else
**Steps:**
1. [Settings Panel] — User opens settings → System shows settings
`;

describe('buildScreenCoverageSummary', () => {
    it('summarizes coverage across features, flows, mockups, and readiness', () => {
        const flows = parseFlows(FLOWS_MD);
        const inventory = makeInventory([readyScreen, bareScreen]);
        const payload = makeMockupPayload([
            { id: 'm1', name: 'Home Dashboard', sourceScreenId: 'scr-home' },
        ]);
        const index = buildScreenIndex(inventory, flows, payload);
        const readiness = buildReadinessIndex(index);
        const summary = buildScreenCoverageSummary(index, readiness, flows, FEATURES);

        expect(summary.totalScreens).toBe(2);
        expect(summary.prdFeatures).toEqual({
            covered: 1,
            total: 2,
            uncovered: [{ id: 'F2', name: 'Sharing' }],
        });
        // Only Flow 1 references a known screen.
        expect(summary.flows).toEqual({ represented: 1, total: 2 });
        expect(summary.p0).toEqual({ total: 1, withMockup: 1 });
        expect(summary.mockups).toEqual({ covered: 1, total: 2 });
        expect(summary.openRisks).toBe(0);
        expect(summary.ready).toBe(1);
        expect(summary.needsReview).toBe(1);
        expect(summary.message).toContain('1 of 2 screens');
    });

    it('reports null feature/flow coverage when there is nothing to compare', () => {
        const index = buildScreenIndex(makeInventory([bareScreen]), [], null);
        const readiness = buildReadinessIndex(index);
        const summary = buildScreenCoverageSummary(index, readiness, null, undefined);
        expect(summary.prdFeatures).toBeNull();
        expect(summary.flows).toBeNull();
    });

    it('uses an all-ready message when every screen passes', () => {
        const payload = makeMockupPayload([
            { id: 'm1', name: 'Home Dashboard', sourceScreenId: 'scr-home' },
        ]);
        const flows = parseFlows(FLOWS_MD);
        const index = buildScreenIndex(makeInventory([readyScreen]), flows, payload);
        const readiness = buildReadinessIndex(index);
        const summary = buildScreenCoverageSummary(index, readiness, flows, FEATURES);
        expect(summary.ready).toBe(1);
        expect(summary.message).toContain('All 1 screens');
    });
});

// --- Filters ---------------------------------------------------------------------------------

describe('screenMatchesFilter', () => {
    const payload = makeMockupPayload([
        { id: 'm1', name: 'Home Dashboard', sourceScreenId: 'scr-home' },
    ]);
    const riskyScreen: ScreenItem = { ...bareScreen, id: 'scr-risky', name: 'Risky', risks: ['A risk'] };
    const index = buildScreenIndex(
        makeInventory([readyScreen, bareScreen, riskyScreen]),
        parseFlows(FLOWS_MD),
        payload,
    );
    const readiness = buildReadinessIndex(index);
    const byId = (id: string) => index.byId.get(id)!;

    it('matches p0 / missing_mockups / has_risks off the spec', () => {
        expect(screenMatchesFilter(byId('scr-home'), readiness.get('scr-home'), 'p0')).toBe(true);
        expect(screenMatchesFilter(byId('scr-bare'), readiness.get('scr-bare'), 'p0')).toBe(false);
        expect(screenMatchesFilter(byId('scr-home'), readiness.get('scr-home'), 'missing_mockups')).toBe(false);
        expect(screenMatchesFilter(byId('scr-bare'), readiness.get('scr-bare'), 'missing_mockups')).toBe(true);
        expect(screenMatchesFilter(byId('scr-risky'), readiness.get('scr-risky'), 'has_risks')).toBe(true);
    });

    it('matches ready / needs_review off derived readiness', () => {
        expect(screenMatchesFilter(byId('scr-home'), readiness.get('scr-home'), 'ready')).toBe(true);
        expect(screenMatchesFilter(byId('scr-bare'), readiness.get('scr-bare'), 'needs_review')).toBe(true);
        expect(screenMatchesFilter(byId('scr-home'), readiness.get('scr-home'), 'needs_review')).toBe(false);
    });

    it('all matches everything', () => {
        for (const item of index.items) {
            expect(screenMatchesFilter(item, readiness.get(item.id), 'all')).toBe(true);
        }
    });
});

// --- Mockup spec coverage -----------------------------------------------------------------------

describe('buildMockupSpecCoverage', () => {
    it('matches spec elements against the mockup spec by token overlap', () => {
        const rows = buildMockupSpecCoverage(
            { ...readyScreen, coreUIElements: ['Activity feed', 'Recent evaluations sidebar'] },
            ['Activity feed list', 'Header'],
        );
        expect(rows).toEqual([
            { element: 'Activity feed', status: 'in_spec' },
            { element: 'Recent evaluations sidebar', status: 'not_in_spec' },
        ]);
    });

    it('returns [] when either side has no elements (no honest comparison)', () => {
        expect(buildMockupSpecCoverage(bareScreen, ['Header'])).toEqual([]);
        expect(buildMockupSpecCoverage(readyScreen, undefined)).toEqual([]);
        expect(buildMockupSpecCoverage(readyScreen, [])).toEqual([]);
    });
});

// --- User-set review status via the edit overlay ---------------------------------------------------

describe('buildReadinessIndex with edit overlays', () => {
    it('honors a user-set reviewStatus riding the screenEdits overlay', () => {
        const index = buildScreenIndex(
            makeInventory([bareScreen]),
            [],
            null,
            { 'scr-bare': { reviewStatus: 'implementation_ready' } },
        );
        const readiness = buildReadinessIndex(index);
        const r = readiness.get('scr-bare')!;
        expect(r.status).toBe('implementation_ready');
        expect(r.source).toBe('user');
    });
});
