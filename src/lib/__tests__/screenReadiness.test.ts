import { describe, expect, it } from 'vitest';
import type { Feature, MockupPayload, ScreenInventoryContent, ScreenItem } from '../../types';
import { buildScreenIndex } from '../screenExperience';
import {
    buildMockupSpecCoverage,
    buildMockupVariantRows,
    buildReadinessIndex,
    buildScreenCoverageSummary,
    buildScreenTraceability,
    deriveScreenReadiness,
    detectScreenGaps,
    normalizeFeatureId,
    parseDecisionBranches,
    resolveAcceptanceCriteria,
    resolveScreenHandoff,
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
    it('reports explicit confidence when every ref resolves to a PRD feature', () => {
        const index = buildScreenIndex(makeInventory([readyScreen]), [], null);
        const t = buildScreenTraceability(index.items[0], FEATURES);
        expect(t.confidence).toBe('explicit');
        expect(t.invalidRefIds).toEqual([]);
        expect(t.features).toHaveLength(1);
        expect(t.features[0].feature?.name).toBe('Activity feed');
    });

    it('keeps unresolved refs visible and downgrades confidence to estimated', () => {
        const screen = { ...readyScreen, featureRefs: ['F9: Unknown thing'] };
        const index = buildScreenIndex(makeInventory([screen]), [], null);
        const t = buildScreenTraceability(index.items[0], FEATURES);
        expect(t.features[0].refId).toBe('F9');
        expect(t.features[0].feature).toBeUndefined();
        expect(t.confidence).toBe('estimated');
        expect(t.invalidRefIds).toEqual(['F9']);
    });

    it('stays estimated (never explicit) when there is no feature list to validate against', () => {
        const index = buildScreenIndex(makeInventory([readyScreen]), [], null);
        const t = buildScreenTraceability(index.items[0], undefined);
        expect(t.confidence).toBe('estimated');
        expect(t.invalidRefIds).toEqual([]);
    });

    it('reports missing confidence when no refs exist', () => {
        const index = buildScreenIndex(makeInventory([bareScreen]), [], null);
        const t = buildScreenTraceability(index.items[0], FEATURES);
        expect(t.confidence).toBe('missing');
        expect(t.features).toEqual([]);
    });

    it('normalizes feature ids for matching (F-1 ≡ f1)', () => {
        expect(normalizeFeatureId('F-1')).toBe(normalizeFeatureId('f1'));
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
            mustWithoutPrimaryScreen: [],
        });
        // No screen carries contract-recommended (needsMockup) states.
        expect(summary.stateVariants).toBeNull();
        // Only Flow 1 references a known screen.
        expect(summary.flows).toEqual({ represented: 1, total: 2 });
        expect(summary.p0).toEqual({ total: 1, withMockup: 1 });
        expect(summary.mockups).toEqual({ covered: 1, total: 2 });
        expect(summary.openRisks).toBe(0);
        expect(summary.ready).toBe(1);
        expect(summary.readyWithWarnings).toBe(0);
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
        expect(summary.readyWithWarnings).toBe(0);
        expect(summary.message).toContain('All 1 screens');
    });

    it('counts user-accepted (confirmed) screens as ready — the Screens UI has one sign-off action', () => {
        // Regression for the audit's C1 contradiction: a fully confirmed
        // project used to roll up as "0 of N ready" because only the legacy
        // implementation_ready status (no longer settable from Screens) was
        // counted.
        const payload = makeMockupPayload([
            { id: 'm1', name: 'Home Dashboard', sourceScreenId: 'scr-home' },
        ]);
        const flows = parseFlows(FLOWS_MD);
        const index = buildScreenIndex(
            makeInventory([readyScreen]),
            flows,
            payload,
            { 'scr-home': { reviewStatus: 'accepted' } },
        );
        const readiness = buildReadinessIndex(index);
        const summary = buildScreenCoverageSummary(index, readiness, flows, FEATURES);
        expect(summary.ready).toBe(1);
        expect(summary.readyWithWarnings).toBe(0);
        expect(summary.message).toContain('All 1 screens are confirmed');
    });

    it('flags a user-accept over open warnings, never letting it read all-clear', () => {
        const index = buildScreenIndex(
            makeInventory([bareScreen]),
            [],
            null,
            { 'scr-bare': { reviewStatus: 'accepted' } },
        );
        const readiness = buildReadinessIndex(index);
        const summary = buildScreenCoverageSummary(index, readiness, null, undefined);
        expect(summary.ready).toBe(1);
        expect(summary.readyWithWarnings).toBe(1);
        expect(summary.message).not.toContain('All 1 screens');
    });

    it('does not report all-clear when a warned override is the only "ready" screen', () => {
        // A single bare screen (lots of derived gaps) marked implementation_ready
        // by the user. It counts as ready, but the derived warnings remain, so the
        // rollup must NOT claim "All screens pass".
        const index = buildScreenIndex(
            makeInventory([bareScreen]),
            [],
            null,
            { 'scr-bare': { reviewStatus: 'implementation_ready' } },
        );
        const readiness = buildReadinessIndex(index);
        const summary = buildScreenCoverageSummary(index, readiness, null, undefined);
        expect(summary.ready).toBe(1);
        expect(summary.readyWithWarnings).toBe(1);
        expect(summary.message).not.toContain('All 1 screens');
        expect(summary.message).toContain('0 of 1 screens');
        expect(summary.message).toContain('still has open warnings');
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

// --- Phase 2: source-grounded screen contract -------------------------------------------------------

/** A Phase 2 contract-grade screen: structured states, handled risks,
 * generated acceptance criteria, and a developer handoff spec. */
const contractScreen: ScreenItem = {
    id: 'scr-submission',
    name: 'Submission Wizard',
    priority: 'P0',
    purpose: 'Guided project submission.',
    userIntent: 'Submit my project for evaluation',
    featureRefs: ['F1: Activity feed'],
    states: [
        {
            name: 'Default', description: 'Wizard steps shown', trigger: 'screen opens',
            type: 'default', required: true,
        },
        {
            name: 'Empty history', description: 'Empty state with start CTA', trigger: 'no saved evaluations',
            type: 'empty', systemBehavior: 'Local lookup returns no records',
            required: true, needsMockup: true,
            acceptanceCriteria: ['Empty history state appears when no evaluations are found'],
        },
        {
            name: 'Upload error', description: 'Inline error with retry', trigger: 'upload fails',
            type: 'error', required: true, needsMockup: true,
        },
    ],
    entryPoints: ['Home CTA'],
    exitPaths: [{ label: 'Submit', target: 'Readiness Dashboard' }],
    coreUIElements: ['Wizard steps', 'Upload area'],
    riskDetails: [
        { description: 'Large file uploads time out', severity: 'medium', proposedHandling: 'Chunked uploads with resume' },
    ],
    acceptanceCriteria: ['User can submit a project end to end'],
    handoff: {
        route: '/submission',
        routeParams: ['projectId'],
        primaryComponents: ['SubmissionWizard', 'AssetUploadStep'],
        stateVariables: ['selectedTargetRoleId', 'uploadedAssets'],
        events: [{ name: 'onSubmitProject', trigger: 'Submit clicked', effect: 'POST /submissions' }],
        accessibilityNotes: ['Wizard steps must be keyboard navigable'],
    },
};

describe('Phase 2 source-grounded resolvers', () => {
    it('resolveAcceptanceCriteria prefers generated screen+state criteria', () => {
        const r = resolveAcceptanceCriteria(contractScreen);
        expect(r.source).toBe('generated');
        expect(r.criteria).toContain('User can submit a project end to end');
        expect(r.criteria).toContain('Empty history state appears when no evaluations are found');
    });

    it('resolveAcceptanceCriteria falls back to derived criteria for legacy screens', () => {
        const r = resolveAcceptanceCriteria(readyScreen);
        expect(r.source).toBe('derived');
        expect(r.criteria.length).toBeGreaterThan(0);
    });

    it('resolveScreenHandoff prefers the generated handoff contract', () => {
        const h = resolveScreenHandoff(contractScreen);
        expect(h.source).toBe('generated');
        expect(h.route).toBe('/submission');
        expect(h.components).toEqual(['SubmissionWizard', 'AssetUploadStep']);
        expect(h.stateVariables).toContain('uploadedAssets');
        expect(h.events[0].name).toBe('onSubmitProject');
        expect(h.accessibilityNotes).toEqual(['Wizard steps must be keyboard navigable']);
    });

    it('resolveScreenHandoff falls back to the derived projection for legacy screens', () => {
        const h = resolveScreenHandoff(readyScreen);
        expect(h.source).toBe('derived');
        expect(h.route).toBeUndefined();
        expect(h.components).toEqual(['Activity feed', 'Header bar']);
        expect(h.events).toEqual([]);
        expect(h.exitEvents).toHaveLength(1);
    });

    it('risks with proposed handling do not count as unresolved', () => {
        const gaps = detectScreenGaps({ screen: contractScreen, hasMockup: true, flowRefCount: 1 });
        expect(gaps.map(g => g.kind)).not.toContain('unresolved_risks');
    });

    it('a structured risk without handling still counts as unresolved', () => {
        const screen: ScreenItem = {
            ...contractScreen,
            riskDetails: [{ description: 'Unhandled thing', severity: 'high' }],
        };
        const gaps = detectScreenGaps({ screen, hasMockup: true, flowRefCount: 1 });
        expect(gaps.map(g => g.kind)).toContain('unresolved_risks');
    });

    it('flags invalid feature refs against the PRD feature list', () => {
        const screen: ScreenItem = { ...contractScreen, featureRefs: ['F1: Activity feed', 'F9: Ghost feature'] };
        const gaps = detectScreenGaps({
            screen, hasMockup: true, flowRefCount: 1, features: FEATURES,
        });
        const invalid = gaps.find(g => g.kind === 'invalid_traceability');
        expect(invalid).toBeDefined();
        expect(invalid!.message).toContain('F9');
    });

    it('flags missing required state variants and clears once resolved', () => {
        const withGap = detectScreenGaps({
            screen: contractScreen, hasMockup: true, flowRefCount: 1, missingRequiredVariants: 2,
        });
        expect(withGap.map(g => g.kind)).toContain('missing_state_variants');
        const without = detectScreenGaps({
            screen: contractScreen, hasMockup: true, flowRefCount: 1, missingRequiredVariants: 0,
        });
        expect(without.map(g => g.kind)).not.toContain('missing_state_variants');
    });
});

describe('buildMockupVariantRows', () => {
    const inventory = makeInventory([contractScreen]);
    const payload = makeMockupPayload([
        { id: 'm1', name: 'Submission Wizard', sourceScreenId: 'scr-submission' },
    ]);

    it('tracks the default view from mockup metadata and states as missing', () => {
        const index = buildScreenIndex(inventory, [], payload);
        const rows = buildMockupVariantRows(index.items[0], 'desktop');
        const byId = new Map(rows.map(r => [r.id, r]));
        expect(byId.get('default')!.status).toBe('generated');
        expect(byId.get('default')!.platform).toBe('desktop');
        // The explicit default-type state folds into the default row.
        expect(rows.filter(r => r.stateName === 'Default')).toHaveLength(1);
        expect(byId.get('state:empty-history')!.status).toBe('missing');
        expect(byId.get('state:empty-history')!.required).toBe(true);
        expect(byId.get('state:upload-error')!.required).toBe(true);
    });

    it('reports the default view missing when the screen has no mockup', () => {
        const index = buildScreenIndex(inventory, [], null);
        const rows = buildMockupVariantRows(index.items[0]);
        expect(rows.find(r => r.id === 'default')!.status).toBe('missing');
    });

    it('honors the user mockupVariantStatus overlay', () => {
        const index = buildScreenIndex(inventory, [], payload, {
            'scr-submission': {
                mockupVariantStatus: { 'default': 'accepted', 'state:upload-error': 'not_needed' },
            },
        });
        const rows = buildMockupVariantRows(index.items[0]);
        const byId = new Map(rows.map(r => [r.id, r]));
        expect(byId.get('default')!.status).toBe('accepted');
        expect(byId.get('default')!.userSet).toBe(true);
        expect(byId.get('state:upload-error')!.status).toBe('not_needed');
        expect(byId.get('state:empty-history')!.status).toBe('missing');
    });

    it('missing recommended variants are optional — surfaced as a gap but never downgrade readiness', () => {
        const flows = parseFlows(`### Flow: Submit
**Goal:** Submit
**Steps:**
1. [Submission Wizard] — User submits → System processes
`);
        const open = buildReadinessIndex(buildScreenIndex(inventory, flows, payload), FEATURES);
        const r1 = open.get('scr-submission')!;
        // Additional mockup variants are optional design enrichment: the screen
        // is implementation-ready even though its state variants are ungenerated.
        expect(r1.status).toBe('implementation_ready');
        // The gap is still surfaced for discovery, it just doesn't score.
        expect(r1.gaps.map(g => g.kind)).toContain('missing_state_variants');

        const resolved = buildReadinessIndex(buildScreenIndex(inventory, flows, payload, {
            'scr-submission': {
                mockupVariantStatus: { 'state:empty-history': 'accepted', 'state:upload-error': 'not_needed' },
            },
        }), FEATURES);
        const r2 = resolved.get('scr-submission')!;
        expect(r2.gaps.map(g => g.kind)).not.toContain('missing_state_variants');
        expect(r2.status).toBe('implementation_ready');
    });

    it('counts recommended variants in the coverage summary', () => {
        const index = buildScreenIndex(inventory, [], payload);
        const readiness = buildReadinessIndex(index, FEATURES);
        const summary = buildScreenCoverageSummary(index, readiness, null, FEATURES);
        expect(summary.stateVariants).toEqual({ covered: 0, required: 2 });
    });
});

describe('parseDecisionBranches', () => {
    it('parses arrow-form branch lists', () => {
        expect(parseDecisionBranches('Start new → Submission form; Resume → Readiness dashboard')).toEqual([
            { condition: 'Start new', outcome: 'Submission form' },
            { condition: 'Resume', outcome: 'Readiness dashboard' },
        ]);
    });

    it('parses if/otherwise decisions', () => {
        expect(parseDecisionBranches('If no role selected, go to step 4; otherwise step 5')).toEqual([
            { condition: 'no role selected', outcome: 'go to step 4' },
            { condition: 'Otherwise', outcome: 'step 5' },
        ]);
    });

    it('returns [] for vague decisions instead of inventing branches', () => {
        expect(parseDecisionBranches('User chooses path')).toEqual([]);
        expect(parseDecisionBranches('')).toEqual([]);
    });

    it('feeds the decision_missing_branches gap through the readiness index', () => {
        const flows = parseFlows(`### Flow: Choose
**Goal:** Choose
**Steps:**
1. [Home Dashboard] — User decides → System waits
   - **Decision:** User chooses path
`);
        const index = buildScreenIndex(makeInventory([readyScreen]), flows, makeMockupPayload([
            { id: 'm1', name: 'Home Dashboard', sourceScreenId: 'scr-home' },
        ]));
        const readiness = buildReadinessIndex(index, FEATURES);
        const r = readiness.get('scr-home')!;
        expect(r.gaps.map(g => g.kind)).toContain('decision_missing_branches');
        expect(r.status).toBe('needs_review');
    });
});

describe('missing_state_variants scope (review-feedback regression)', () => {
    it('a legacy screen without a mockup never gets a state-variant gap (default row excluded)', () => {
        // readyScreen as P2 with no mockup: Phase 1 behavior is NO
        // missing_mockup_p0 gap and it must not be replaced by a
        // missing_state_variants downgrade from the default variant row.
        const p2Screen: ScreenItem = { ...readyScreen, priority: 'P2' };
        const flows = parseFlows(FLOWS_MD);
        const index = buildScreenIndex(makeInventory([p2Screen]), flows, null);
        const readiness = buildReadinessIndex(index, FEATURES);
        const r = readiness.get('scr-home')!;
        expect(r.gaps.map(g => g.kind)).not.toContain('missing_state_variants');
        expect(r.gaps.map(g => g.kind)).not.toContain('missing_mockup_p0');
        expect(r.status).toBe('implementation_ready');
    });
});
