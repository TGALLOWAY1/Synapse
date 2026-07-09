import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import type { Feature, MockupPayload, ScreenInventoryContent, ScreenItem } from '../../types';
import { buildScreenIndex, type ScreenMetadataEdit } from '../../lib/screenExperience';
import { buildReadinessIndex, buildScreenCoverageSummary } from '../../lib/screenReadiness';
import { buildScreenReviewIndex, summarizeArtifactReviewReadiness } from '../../lib/screenReviewWorkflow';
import { parseFlows } from '../renderers/userFlows/parseFlow';
import { ScreenListView } from '../experience/ScreenListView';
import { ScreenDetailView } from '../experience/ScreenDetailView';

// Render smoke tests for the upgraded Screens experience views: the coverage
// & readiness panel, list filters, and the structured Overview / Flow /
// Mockups tabs — including the degraded legacy path (minimal screens with no
// states/refs/navigation), which must render fallbacks, never crash.

beforeEach(() => {
    vi.stubGlobal(
        'matchMedia',
        vi.fn().mockImplementation((query: string) => ({
            matches: false,
            media: query,
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            addListener: vi.fn(),
            removeListener: vi.fn(),
            dispatchEvent: vi.fn(),
        })),
    );
});

const fullScreen: ScreenItem = {
    id: 'scr-home',
    name: 'Home Dashboard',
    priority: 'P0',
    purpose: 'Landing surface summarizing recent activity.',
    userIntent: 'I want to see what changed',
    featureRefs: ['F1: Activity feed'],
    states: [
        { name: 'Default', description: 'Shows the feed', trigger: 'data loads' },
        { name: 'Empty', description: '', trigger: '' },
    ],
    entryPoints: ['App launch'],
    exitPaths: [{ label: 'Open item', target: 'Item Detail' }],
    coreUIElements: ['Activity feed', 'Header bar'],
    outputData: ['selected item id'],
    risks: ['LocalStorage read failure'],
};

/** Legacy-shaped screen: only the required fields. */
const legacyScreen: ScreenItem = {
    name: 'Bare Legacy Screen',
    priority: 'P2',
    purpose: '',
};

const inventory: ScreenInventoryContent = {
    sections: [{ title: 'Main', screens: [fullScreen, legacyScreen] }],
};

const FLOWS_MD = `### Flow: First Visit
**Goal:** Land and explore
**Steps:**
1. [Home Dashboard] — User opens the app → System loads the feed
2. [Home Dashboard] — User picks an item → System navigates
`;

const payload: MockupPayload = {
    version: 'mockup_spec_v1',
    title: 'Mockups',
    summary: 'Test',
    screens: [{
        id: 'm1',
        name: 'Home Dashboard',
        purpose: 'p',
        sourceScreenId: 'scr-home',
        coreUIElements: ['Activity feed list'],
    }],
};

const FEATURES: Feature[] = [
    { id: 'F1', name: 'Activity feed', description: '', userValue: '', complexity: 'low' },
    { id: 'F2', name: 'Sharing', description: '', userValue: '', complexity: 'low' },
];

function buildFixtures() {
    const flows = parseFlows(FLOWS_MD);
    const index = buildScreenIndex(inventory, flows, payload);
    const readiness = buildReadinessIndex(index);
    const coverage = buildScreenCoverageSummary(index, readiness, flows, FEATURES);
    return { index, readiness, coverage };
}

describe('ScreenListView (coverage panel + filters + cards)', () => {
    it('renders the coverage panel, readiness badges, and clearer metadata', () => {
        const { index, readiness, coverage } = buildFixtures();
        const { getByText, getAllByText } = render(
            <ScreenListView
                index={index}
                readiness={readiness}
                coverage={coverage}
                onSelectScreen={() => {}}
            />,
        );
        expect(getByText('Screen Coverage & Readiness')).toBeTruthy();
        expect(getByText('PRD features linked')).toBeTruthy();
        expect(getAllByText('1 / 2').length).toBeGreaterThan(0);
        // Clearer navigation label replaces "2 in · 2 out".
        expect(getByText(/incoming · .*outgoing/)).toBeTruthy();
        // Both screens have review-worthy gaps → needs-review badges present.
        expect(getAllByText('Needs review').length).toBeGreaterThan(0);
        // Uncovered-feature disclosure names the missing feature.
        fireEvent.click(getByText(/1 PRD feature not linked/));
        expect(getByText(/Sharing/)).toBeTruthy();
    });

    it('frames mockup variants as optional Expanded Design Coverage, not a deficiency', () => {
        const { index, readiness, coverage } = buildFixtures();
        const { getByText, queryByText } = render(
            <ScreenListView
                index={index}
                readiness={readiness}
                coverage={coverage}
                variantCoverage={{
                    recommendedGenerated: 7, recommendedTotal: 17,
                    additionalGenerated: 6, additionalTotal: 17,
                    p0WithMobile: 0, p0Total: 2,
                    legacyUnknownMockups: 0, manifestBackedGenerated: 0,
                    freshness: { total: 0, current: 0, review: 0, unknown: 0 },
                }}
                onSelectScreen={() => {}}
            />,
        );
        // Required work sits under a positive "Ready for Development" header.
        expect(getByText('Ready for Development')).toBeTruthy();
        // Variants are reframed as optional, opportunity-oriented coverage.
        expect(getByText('Expanded Design Coverage')).toBeTruthy();
        expect(getByText(/available on demand/)).toBeTruthy();
        // The old mandatory-sounding "N / M recommended" ratio is gone.
        expect(queryByText(/17 recommended/)).toBeNull();
    });

    it('filters screens (Has risks shows only the risky screen)', () => {
        const { index, readiness, coverage } = buildFixtures();
        const { getByText, queryByText } = render(
            <ScreenListView
                index={index}
                readiness={readiness}
                coverage={coverage}
                onSelectScreen={() => {}}
            />,
        );
        fireEvent.click(getByText('Has risks'));
        expect(getByText('Home Dashboard')).toBeTruthy();
        expect(queryByText('Bare Legacy Screen')).toBeNull();
    });

    it('renders an empty-filter state instead of nothing', () => {
        const { index, readiness, coverage } = buildFixtures();
        const { getByText } = render(
            <ScreenListView
                index={index}
                readiness={readiness}
                coverage={coverage}
                onSelectScreen={() => {}}
            />,
        );
        fireEvent.click(getByText('Ready'));
        expect(getByText('No screens match this filter.')).toBeTruthy();
    });
});

describe('ScreenDetailView tabs', () => {
    function renderDetail(screenId: string, tab: 'overview' | 'flow' | 'mockups') {
        const { index, readiness } = buildFixtures();
        const item = index.byId.get(screenId)!;
        return render(
            <ScreenDetailView
                item={item}
                readiness={readiness.get(screenId)}
                activeTab={tab}
                onTabChange={() => {}}
                onBack={() => {}}
                onNavigateToScreen={() => {}}
                availableScreenSlugs={index.availableSlugs}
                features={FEATURES}
            />,
        );
    }

    it('Overview renders the structured contract sections with honest fallbacks', () => {
        const { getByText, getAllByText } = renderDetail('scr-home', 'overview');
        expect(getByText('PRD Traceability')).toBeTruthy();
        expect(getAllByText('Activity feed').length).toBeGreaterThan(0);
        expect(getByText('Required States')).toBeTruthy();
        expect(getByText('Risks & Edge Cases')).toBeTruthy();
        expect(getByText('Acceptance Criteria')).toBeTruthy();
        expect(getByText('Developer Handoff')).toBeTruthy();
        // The behavior-less "Empty" state renders "Not specified", not fabricated detail.
        expect(getAllByText('Not specified').length).toBeGreaterThan(0);
    });

    it('Overview survives a legacy screen with no optional fields', () => {
        const { getByText, getAllByText } = renderDetail('bare-legacy-screen', 'overview');
        expect(getByText(/No linked PRD features found/)).toBeTruthy();
        // "No UI states documented" now appears in both the Overview section and
        // the Phase 4A review-issue list — assert it's present rather than unique.
        expect(getAllByText(/No UI states documented/).length).toBeGreaterThan(0);
        expect(getByText(/Not enough detail/)).toBeTruthy();
    });

    it('Flow tab shows appearance context and labels repeated appearances', () => {
        const { getByText } = renderDetail('scr-home', 'flow');
        expect(getByText('This screen appears in')).toBeTruthy();
        expect(getByText(/appearance 1 of 2/)).toBeTruthy();
        expect(getByText(/appearance 2 of 2/)).toBeTruthy();
    });

    it('Mockups tab shows an honest empty state when no mockup matches', () => {
        const { getByText } = renderDetail('bare-legacy-screen', 'mockups');
        expect(getByText(/No mockup has been generated for this screen yet/)).toBeTruthy();
    });
});

// --- Phase 2: source-grounded contract rendering -----------------------------------

// The Mockups tab embeds MockupScreenImage, which drives the IDB-backed image
// store — out of scope here (the variant card is what's under test).
vi.mock('../mockups/MockupScreenImage', () => ({
    MockupScreenImage: () => <div data-testid="mockup-image-stub" />,
}));

const contractScreen: ScreenItem = {
    id: 'scr-submission',
    name: 'Submission Wizard',
    priority: 'P0',
    purpose: 'Guided project submission.',
    userIntent: 'Submit my project',
    featureRefs: ['F1: Activity feed'],
    states: [
        { name: 'Default', description: 'Wizard shown', trigger: 'open', type: 'default', required: true },
        {
            name: 'Empty history', description: 'Empty state with CTA', trigger: 'no evaluations',
            type: 'empty', systemBehavior: 'Lookup returns no records', required: true, needsMockup: true,
            acceptanceCriteria: ['Empty state appears when no evaluations exist'],
        },
        { name: 'Upload error', description: 'Inline error', trigger: 'upload fails', type: 'error', needsMockup: true },
    ],
    entryPoints: ['Home CTA'],
    exitPaths: [{ label: 'Submit', target: 'Dashboard' }],
    coreUIElements: ['Wizard steps'],
    riskDetails: [{ description: 'Uploads time out', severity: 'medium', proposedHandling: 'Chunked uploads' }],
    acceptanceCriteria: ['User can submit end to end'],
    handoff: {
        route: '/submission',
        primaryComponents: ['SubmissionWizard'],
        stateVariables: ['uploadedAssets'],
        events: [{ name: 'onSubmitProject', trigger: 'Submit clicked', effect: 'POST /submissions' }],
        accessibilityNotes: ['Wizard steps must be keyboard navigable'],
    },
};

const contractInventory: ScreenInventoryContent = {
    sections: [{ title: 'Submission', screens: [contractScreen] }],
};

const contractPayload: MockupPayload = {
    version: 'mockup_spec_v1',
    title: 'Mockups',
    summary: 'Test',
    screens: [{ id: 'm-sub', name: 'Submission Wizard', purpose: 'p', sourceScreenId: 'scr-submission' }],
};

function renderContractDetail(
    tab: 'overview' | 'flow' | 'mockups' | 'handoff',
    opts: {
        edits?: Parameters<typeof buildScreenIndex>[3];
        onSaveScreenEdit?: (id: string, edit: ScreenMetadataEdit | null) => void;
        withMockupContext?: boolean;
        trustContext?: import('../../lib/mockupVariantTrust').VariantTrustContext;
        traceDataModel?: import('../../types').DataModelContent | null;
        tracePlan?: import('../../types').StructuredImplementationPlan | null;
    } = {},
) {
    const index = buildScreenIndex(contractInventory, [], contractPayload, opts.edits);
    const readiness = buildReadinessIndex(index, FEATURES);
    const item = index.byId.get('scr-submission')!;
    return render(
        <ScreenDetailView
            item={item}
            readiness={readiness.get('scr-submission')}
            activeTab={tab}
            onTabChange={() => {}}
            onBack={() => {}}
            onNavigateToScreen={() => {}}
            availableScreenSlugs={index.availableSlugs}
            features={FEATURES}
            traceDataModel={opts.traceDataModel}
            tracePlan={opts.tracePlan}
            mobileRelevant
            onSaveScreenEdit={opts.onSaveScreenEdit}
            mockupContext={opts.withMockupContext === false ? undefined : {
                projectId: 'p1',
                artifactId: 'a1',
                versionId: 'v1',
                payload: contractPayload,
                settings: { platform: 'desktop', fidelity: 'mid', scope: 'multi_screen' },
                versionNumber: 2,
                prdVersionLabel: 'Version 3',
                trustContext: opts.trustContext,
            }}
        />,
    );
}

describe('Phase 2 contract rendering', () => {
    it('Overview shows generated handoff, criteria, state contract, and risk handling', () => {
        const { getByText, getAllByText } = renderContractDetail('overview');
        // Generated handoff fields.
        expect(getByText('/submission')).toBeTruthy();
        expect(getByText('SubmissionWizard')).toBeTruthy();
        expect(getByText('uploadedAssets')).toBeTruthy();
        expect(getByText('onSubmitProject')).toBeTruthy();
        expect(getByText('Wizard steps must be keyboard navigable')).toBeTruthy();
        expect(getAllByText('From generated spec').length).toBe(2); // criteria + handoff
        // Explicit traceability label (all refs resolve).
        expect(getByText('Mapped at generation')).toBeTruthy();
        // State contract chips + system behavior.
        expect(getAllByText('Needs mockup').length).toBeGreaterThan(0);
        expect(getByText('Lookup returns no records')).toBeTruthy();
        // Risk with proposed handling is documented, not "needs review".
        expect(getByText(/Handling: Chunked uploads/)).toBeTruthy();
        // Generated acceptance criteria (screen-level + per-state; state
        // criteria also render inside their own state row).
        expect(getByText('User can submit end to end')).toBeTruthy();
        expect(getAllByText('Empty state appears when no evaluations exist').length).toBeGreaterThan(0);
    });

    it('Mockups tab presents a viewport × state variant gallery with honest statuses', () => {
        const { getByText, getAllByText } = renderContractDetail('mockups');
        // Header + derived summary.
        expect(getByText(/recommended .*variants.* generated/)).toBeTruthy();
        // Variant cards (viewport × state). The default is generated; mobile /
        // states are recommended-but-missing.
        expect(getAllByText('Desktop · Default').length).toBeGreaterThan(0);
        expect(getByText('Mobile · Default')).toBeTruthy();
        expect(getByText('Desktop · Empty history')).toBeTruthy();
        expect(getByText('Desktop · Upload error')).toBeTruthy();
        // Legacy mockup with no coverage metadata → unknown, never fabricated.
        expect(getByText('Coverage unknown')).toBeTruthy();
        expect(getByText(/Generated from PRD Version 3/)).toBeTruthy();
        // Missing variants are visually distinct (Missing pills + "Not generated yet").
        expect(getAllByText('Missing').length).toBe(3);
        expect(getAllByText('Not generated yet').length).toBe(3);
        // Selecting a missing variant offers a Phase 3B "Generate variant"
        // action — disabled here because the test env has no OpenAI key — with
        // a clear, non-alarming explanation rather than a silent failure.
        fireEvent.click(getByText('Mobile · Default'));
        const generateBtn = getByText('Generate variant').closest('button');
        expect(generateBtn).toBeTruthy();
        expect(generateBtn?.disabled).toBe(true);
        expect(getAllByText(/requires your own OpenAI API key/).length).toBeGreaterThan(0);
    });

    it('marking a variant not needed persists through the edit overlay', () => {
        const onSave = vi.fn();
        const { getByText } = renderContractDetail('mockups', { onSaveScreenEdit: onSave });
        // Select the missing Empty-history variant, then mark it not needed.
        fireEvent.click(getByText('Desktop · Empty history'));
        fireEvent.click(getByText('Not needed'));
        expect(onSave).toHaveBeenCalledTimes(1);
        const [id, edit] = onSave.mock.calls[0] as [string, Record<string, unknown>];
        expect(id).toBe('scr-submission');
        expect(edit.mockupVariantStatus).toEqual({ 'state:empty-history': 'not_needed' });
    });

    it('the edit form preserves unknown and variant overlay fields on save', () => {
        const onSave = vi.fn();
        const edits = {
            'scr-submission': {
                notes: 'keep me',
                mockupVariantStatus: { 'default': 'accepted' as const },
                futureField: 'do not drop',
            } as Record<string, unknown>,
        };
        const { getByText } = renderContractDetail('overview', {
            edits: edits as never,
            onSaveScreenEdit: onSave,
        });
        fireEvent.click(getByText('Edit details'));
        fireEvent.click(getByText('Save'));
        expect(onSave).toHaveBeenCalledTimes(1);
        const [, edit] = onSave.mock.calls[0] as [string, Record<string, unknown>];
        expect(edit.notes).toBe('keep me');
        expect(edit.mockupVariantStatus).toEqual({ 'default': 'accepted' });
        expect(edit.futureField).toBe('do not drop');
    });

    it('user-set review status overrides the estimate while warnings stay visible', () => {
        const { getAllByText, getByText } = renderContractDetail('overview', {
            edits: { 'scr-submission': { reviewStatus: 'implementation_ready' } } as never,
        });
        expect(getAllByText('Ready to build').length).toBeGreaterThan(0);
        // The derived warnings are still surfaced in the handoff footer.
        expect(getByText(/Before building:/)).toBeTruthy();
    });
});

// --- Phase 4A: review & approval workflow ------------------------------------

describe('Phase 4A review workflow UI', () => {
    it('Screen Detail renders the review header, status, and actions', () => {
        const { getByText } = renderContractDetail('overview', { onSaveScreenEdit: vi.fn() });
        expect(getByText('User review')).toBeTruthy();
        expect(getByText('System readiness')).toBeTruthy();
        expect(getByText('Accept screen')).toBeTruthy();
        expect(getByText('Mark ready to build')).toBeTruthy();
    });

    it('accepting a clean screen persists the accepted status + a sign-off signature', () => {
        const onSave = vi.fn();
        const { getByText } = renderContractDetail('overview', { onSaveScreenEdit: onSave });
        fireEvent.click(getByText('Accept screen'));
        expect(onSave).toHaveBeenCalledTimes(1);
        const [id, edit] = onSave.mock.calls[0] as [string, Record<string, unknown>];
        expect(id).toBe('scr-submission');
        expect(edit.reviewStatus).toBe('accepted');
        const review = edit.review as Record<string, unknown>;
        expect(review.acceptedAt).toBeTruthy();
        expect((review.signature as Record<string, unknown>).screenContractHash).toBeTruthy();
    });

    it('the review checklist persists a ticked item into the overlay', () => {
        const onSave = vi.fn();
        const { getByText, getByLabelText } = renderContractDetail('overview', { onSaveScreenEdit: onSave });
        fireEvent.click(getByText('Review checklist'));
        fireEvent.click(getByLabelText('Purpose matches the PRD'));
        expect(onSave).toHaveBeenCalledTimes(1);
        const [, edit] = onSave.mock.calls[0] as [string, Record<string, unknown>];
        const review = edit.review as Record<string, unknown>;
        expect((review.checklist as Record<string, unknown>).purposeMatchesPrd).toBe(true);
    });
});

function buildReviewFixtures() {
    const flows = parseFlows(FLOWS_MD);
    const index = buildScreenIndex(inventory, flows, payload);
    const readiness = buildReadinessIndex(index, FEATURES);
    const coverage = buildScreenCoverageSummary(index, readiness, flows, FEATURES);
    const reviewModels = buildScreenReviewIndex(index, { features: FEATURES });
    const artifactReview = summarizeArtifactReviewReadiness(index, reviewModels);
    return { index, readiness, coverage, reviewModels, artifactReview };
}

describe('Phase 4A Screens list + coverage panel', () => {
    it('cards show the review status and issue counts', () => {
        const { index, readiness, coverage, reviewModels, artifactReview } = buildReviewFixtures();
        const { getAllByText } = render(
            <ScreenListView
                index={index}
                readiness={readiness}
                reviewModels={reviewModels}
                artifactReview={artifactReview}
                coverage={coverage}
                onSelectScreen={() => {}}
            />,
        );
        // Both screens are unreviewed → each card shows the review status line.
        expect(getAllByText('Not reviewed').length).toBeGreaterThan(0);
    });

    it('the Has blockers filter shows only screens with blocking issues', () => {
        const { index, readiness, coverage, reviewModels, artifactReview } = buildReviewFixtures();
        const { getByText, queryByText } = render(
            <ScreenListView
                index={index}
                readiness={readiness}
                reviewModels={reviewModels}
                artifactReview={artifactReview}
                coverage={coverage}
                onSelectScreen={() => {}}
            />,
        );
        fireEvent.click(getByText('Has blockers'));
        // The bare legacy screen (no purpose / acceptance) has blockers; the
        // full P0 dashboard does not.
        expect(getByText('Bare Legacy Screen')).toBeTruthy();
        expect(queryByText('Home Dashboard')).toBeNull();
    });

    it('the coverage panel shows the review-readiness rollup + gate', () => {
        const { index, readiness, coverage, reviewModels, artifactReview } = buildReviewFixtures();
        const { getByText } = render(
            <ScreenListView
                index={index}
                readiness={readiness}
                reviewModels={reviewModels}
                artifactReview={artifactReview}
                coverage={coverage}
                onSelectScreen={() => {}}
            />,
        );
        expect(getByText('Review readiness')).toBeTruthy();
        // No P0 screen is accepted yet → not ready for implementation planning.
        expect(getByText('Not ready for implementation planning yet')).toBeTruthy();
    });
});

describe('missing variant acceptance (review-feedback regression)', () => {
    it('a missing variant row can be marked accepted (e.g. verified via upload), not just not-needed', () => {
        const onSave = vi.fn();
        const { getByText } = renderContractDetail('mockups', { onSaveScreenEdit: onSave });
        // Select the missing Empty-history variant, then mark it accepted.
        fireEvent.click(getByText('Desktop · Empty history'));
        fireEvent.click(getByText('Mark accepted'));
        expect(onSave).toHaveBeenCalledTimes(1);
        const [, edit] = onSave.mock.calls[0] as [string, Record<string, unknown>];
        expect(edit.mockupVariantStatus).toEqual({ 'state:empty-history': 'accepted' });
    });
});

// --- Phase 3C: variant freshness / staleness / history / local-only ----------

import { useMockupVariantImageStore } from '../../store/mockupVariantImageStore';
import { buildVariantSourceSignature } from '../../lib/mockupVariantTrust';
import type { MockupVariantImageRecord } from '../../types';

const TRUST = {
    prdVersionId: 'prd-1',
    screenVersionId: 'inv-1',
    designSystemVersionId: 'ds-1',
    designSystemHash: 'dshash1',
};

/** Seed a per-variant image record into the store (jsdom has no IndexedDB, so
 * loadForVersion is a no-op and the seeded cache persists). */
function seedVariant(record: Partial<MockupVariantImageRecord> & { variantId: string }) {
    const full: MockupVariantImageRecord = {
        key: `v1:scr-submission:${record.variantId}:low`,
        projectId: 'p1', artifactId: 'a1', versionId: 'v1', screenId: 'scr-submission',
        viewport: 'desktop', stateName: 'Empty history', dataUrl: 'data:image/png;base64,ZZZ',
        quality: 'low', prompt: '', generatedAt: 1, ...record,
    };
    useMockupVariantImageStore.setState({ images: { [full.key]: full } });
}

describe('Phase 3C variant freshness & history UI', () => {
    beforeEach(() => {
        useMockupVariantImageStore.setState({ images: {}, inFlight: {}, errors: {} });
    });

    it('shows the snapshot-inclusion storage note in the Mockups tab', () => {
        const { getByText } = renderContractDetail('mockups');
        // Phase 3D: variant images now travel in project snapshots, so the copy
        // states they can be restored on another device (no longer "local-only").
        expect(getByText(/included in project snapshots/)).toBeTruthy();
    });

    it('a legacy default with no source metadata reads Freshness unknown', () => {
        const { getAllByText, getByText } = renderContractDetail('mockups', { trustContext: TRUST });
        // Default variant is generated via the legacy join but carries no
        // signature → unknown, never falsely stale.
        expect(getAllByText('Freshness unknown').length).toBeGreaterThan(0);
        expect(getByText(/Source comparison unavailable for this older mockup/)).toBeTruthy();
    });

    it('renders a Stale badge + reason when the stored contract hash differs', () => {
        seedVariant({
            variantId: 'state:empty-history',
            coverageManifest: {
                variant: { viewport: 'desktop', stateName: 'Empty history' },
                overallStatus: 'aligned', estimated: true,
                uiRegions: [], states: [], userActions: [], acceptanceCriteria: [], warnings: [],
            },
            sourceSignature: {
                screenId: 'scr-submission', viewport: 'desktop', stateName: 'Empty history',
                variantId: 'state:empty-history', screenContractHash: 'DEFINITELY_DIFFERENT',
                createdAt: '2026-01-01T00:00:00.000Z',
            },
            generatedFrom: { prdVersionId: 'prd-1', screenVersionId: 'inv-1', designSystemVersionId: 'ds-1' },
        });
        const { getByText, getAllByText } = renderContractDetail('mockups', { trustContext: TRUST });
        fireEvent.click(getByText('Desktop · Empty history'));
        expect(getAllByText('Stale').length).toBeGreaterThan(0);
        expect(getAllByText(/Screen spec changed after this mockup was generated/).length).toBeGreaterThan(0);
    });

    it('renders a Current badge when the stored signature matches the current one', () => {
        // Compute the signature the component will compute for this variant.
        const sig = buildVariantSourceSignature(
            { screen: contractScreen, viewport: 'desktop', stateName: 'Empty history',
              stateType: 'empty', variantId: 'state:empty-history' },
            TRUST,
            '2026-01-01T00:00:00.000Z',
        );
        seedVariant({
            variantId: 'state:empty-history',
            sourceSignature: sig,
            generatedFrom: { prdVersionId: 'prd-1', screenVersionId: 'inv-1', designSystemVersionId: 'ds-1' },
        });
        const { getByText, getAllByText } = renderContractDetail('mockups', { trustContext: TRUST });
        fireEvent.click(getByText('Desktop · Empty history'));
        expect(getAllByText('Current').length).toBeGreaterThan(0);
    });

    it('renders the variant history section when history exists', () => {
        seedVariant({
            variantId: 'state:empty-history',
            history: [{
                dataUrl: 'data:image/png;base64,OLD',
                quality: 'low',
                generatedAt: 1,
                reason: 'regenerated',
            }],
        });
        const { getByText } = renderContractDetail('mockups', { trustContext: TRUST });
        fireEvent.click(getByText('Desktop · Empty history'));
        const historyToggle = getByText(/Variant history \(1 previous\)/);
        expect(historyToggle).toBeTruthy();
        fireEvent.click(historyToggle);
        expect(getByText('Previous render 1')).toBeTruthy();
    });
});

// --- Phase 4B: downstream impact + Screens preflight -------------------------

import { ScreenDownstreamImpactSection } from '../experience/ScreenDownstreamImpactSection';
import { ScreenPreflightPanel } from '../experience/ScreenPreflightPanel';
import { buildScreenDownstreamImpact, buildScreensPreflight } from '../../lib/screenDownstreamImpact';
import type { ScreenArtifactReviewReadiness } from '../../lib/screenReviewWorkflow';

/** Fixtures where the P0 dashboard is Accepted but its stored review signature
 * no longer matches — i.e. it changed after sign-off (freshness 'outdated'). */
function buildDownstreamFixtures() {
    const flows = parseFlows(FLOWS_MD);
    const edits: Record<string, ScreenMetadataEdit> = {
        'scr-home': {
            reviewStatus: 'accepted',
            review: { signature: { screenContractHash: 'stale-hash-that-will-not-match' } },
        },
    };
    const index = buildScreenIndex(inventory, flows, payload, edits);
    const readiness = buildReadinessIndex(index, FEATURES);
    const coverage = buildScreenCoverageSummary(index, readiness, flows, FEATURES);
    const reviewModels = buildScreenReviewIndex(index, { features: FEATURES });
    const artifactReview = summarizeArtifactReviewReadiness(index, reviewModels);
    return { index, readiness, coverage, reviewModels, artifactReview };
}

describe('Phase 4B downstream impact section', () => {
    it('11. shows the impacted artifacts when an accepted screen is outdated', () => {
        const impact = buildScreenDownstreamImpact({
            screenId: 's', title: 'Dashboard', isP0: true,
            userStatus: 'accepted', reviewFreshness: 'outdated',
            blockingCount: 0, blockingTitles: [],
            mockupFreshnessStale: false, mockupFreshnessUnknown: false, hasDataRequirements: true,
        });
        const { getByText, getAllByText } = render(<ScreenDownstreamImpactSection impact={impact} />);
        expect(getAllByText('Downstream impact').length).toBeGreaterThan(0);
        expect(getByText('Mockups')).toBeTruthy();
        expect(getByText('Implementation Plan')).toBeTruthy();
    });

    it('12. shows a calm no-impact empty state', () => {
        const impact = buildScreenDownstreamImpact({
            screenId: 's', title: 'Settings', isP0: false,
            userStatus: 'draft', reviewFreshness: 'current',
            blockingCount: 0, blockingTitles: [],
            mockupFreshnessStale: false, mockupFreshnessUnknown: false, hasDataRequirements: false,
        });
        const { getByText } = render(<ScreenDownstreamImpactSection impact={impact} />);
        expect(getByText('No downstream impact detected for this screen.')).toBeTruthy();
    });
});

describe('Phase 4B list card + coverage panel', () => {
    it('13. a card shows a downstream review chip only when relevant', () => {
        const { index, readiness, coverage, reviewModels, artifactReview } = buildDownstreamFixtures();
        const { getByText, queryAllByText } = render(
            <ScreenListView
                index={index}
                readiness={readiness}
                reviewModels={reviewModels}
                artifactReview={artifactReview}
                coverage={coverage}
                onSelectScreen={() => {}}
            />,
        );
        // The accepted-but-outdated P0 dashboard surfaces a downstream chip…
        expect(queryAllByText(/Downstream review/).length).toBeGreaterThan(0);
        // …but the header still renders normally.
        expect(getByText('Screen Coverage & Readiness')).toBeTruthy();
    });

    it('14. the coverage panel shows the downstream readiness section', () => {
        const { index, readiness, coverage, reviewModels, artifactReview } = buildDownstreamFixtures();
        const { getByText } = render(
            <ScreenListView
                index={index}
                readiness={readiness}
                reviewModels={reviewModels}
                artifactReview={artifactReview}
                coverage={coverage}
                onSelectScreen={() => {}}
            />,
        );
        expect(getByText('Downstream readiness')).toBeTruthy();
    });
});

describe('Phase 4B preflight panel', () => {
    function readyGate(overrides: Partial<ScreenArtifactReviewReadiness> = {}): ScreenArtifactReviewReadiness {
        return {
            ready: true, totalScreens: 1, accepted: 1, implementationReady: 0, needsReview: 0, draft: 0,
            blockers: 0, reviewItems: 0,
            p0: { total: 1, signedOff: 1, withBlockers: 0, notSignedOff: [] },
            reasons: [], message: 'Ready', ...overrides,
        };
    }

    it('15. shows blockers, review items, and recommended next steps', () => {
        const preflight = buildScreensPreflight(
            [{
                screenId: 'p0', title: 'Dashboard', isP0: true,
                userStatus: undefined, reviewFreshness: 'current',
                blockingCount: 1, blockingTitles: ['No acceptance criteria'],
                mockupFreshnessStale: true, mockupFreshnessUnknown: false, hasDataRequirements: false,
            }],
            readyGate({ ready: false, p0: { total: 1, signedOff: 0, withBlockers: 1, notSignedOff: [{ id: 'p0', name: 'Dashboard' }] } }),
        );
        const { getByText } = render(<ScreenPreflightPanel preflight={preflight} />);
        expect(getByText('Implementation preflight')).toBeTruthy();
        expect(getByText('Blocking')).toBeTruthy();
        expect(getByText('Recommended next steps')).toBeTruthy();
    });

    it('16. renders a ready state when no blockers remain', () => {
        const preflight = buildScreensPreflight(
            [{
                screenId: 'p0', title: 'Dashboard', isP0: true,
                userStatus: 'accepted', reviewFreshness: 'current',
                blockingCount: 0, blockingTitles: [],
                mockupFreshnessStale: false, mockupFreshnessUnknown: false, hasDataRequirements: false,
            }],
            readyGate(),
        );
        const { getByText } = render(<ScreenPreflightPanel preflight={preflight} />);
        expect(getByText('Ready for implementation planning')).toBeTruthy();
    });
});

// --- Phase 5A: implementation handoff tab ------------------------------------

describe('Phase 5A handoff tab', () => {
    it('19. the Handoff tab renders the developer sections', () => {
        const { getByText, getAllByText } = renderContractDetail('handoff', { onSaveScreenEdit: vi.fn() });
        expect(getAllByText('Implementation handoff').length).toBeGreaterThan(0);
        expect(getByText('Route')).toBeTruthy();
        expect(getByText('Components')).toBeTruthy();
        expect(getByText('QA checklist')).toBeTruthy();
        expect(getByText('Build task checklist')).toBeTruthy();
        // The generated handoff route renders.
        expect(getAllByText('/submission').length).toBeGreaterThan(0);
    });

    it('20. an unsigned P0 screen shows Handoff blocked; accepting clears it', () => {
        const blocked = renderContractDetail('handoff', { onSaveScreenEdit: vi.fn() });
        expect(blocked.getByText('Handoff blocked')).toBeTruthy();
        blocked.unmount();

        const accepted = renderContractDetail('handoff', {
            edits: { 'scr-submission': { reviewStatus: 'accepted' } } as never,
            onSaveScreenEdit: vi.fn(),
        });
        expect(accepted.queryByText('Handoff blocked')).toBeNull();
    });

    it('21. Copy handoff produces markdown with the main sections', async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
        const { getByText } = renderContractDetail('handoff', { onSaveScreenEdit: vi.fn() });
        fireEvent.click(getByText('Copy handoff'));
        await Promise.resolve();
        expect(writeText).toHaveBeenCalledTimes(1);
        const md = writeText.mock.calls[0][0] as string;
        expect(md).toMatch(/# Submission Wizard .*Implementation Handoff/);
        expect(md).toContain('## Route');
        expect(md).toContain('## Build Tasks');
    });

    it('22. a screen card shows a handoff readiness chip', () => {
        const { index, readiness, coverage, reviewModels, artifactReview } = buildReviewFixtures();
        const { getAllByText } = render(
            <ScreenListView
                index={index}
                readiness={readiness}
                reviewModels={reviewModels}
                artifactReview={artifactReview}
                coverage={coverage}
                features={FEATURES}
                onSelectScreen={() => {}}
            />,
        );
        // The unsigned P0 Home Dashboard has a blocked handoff.
        expect(getAllByText('Handoff blocked').length).toBeGreaterThan(0);
    });

    it('23. the coverage panel shows the handoff rollup', () => {
        const { index, readiness, coverage, reviewModels, artifactReview } = buildReviewFixtures();
        const { getByText } = render(
            <ScreenListView
                index={index}
                readiness={readiness}
                reviewModels={reviewModels}
                artifactReview={artifactReview}
                coverage={coverage}
                features={FEATURES}
                onSelectScreen={() => {}}
            />,
        );
        expect(getByText('Implementation handoff')).toBeTruthy();
        expect(getByText('Implementation handoff not ready')).toBeTruthy();
    });

    it('24. the preflight includes handoff blocking items', () => {
        const { index, readiness, coverage, reviewModels, artifactReview } = buildReviewFixtures();
        const { getByText } = render(
            <ScreenListView
                index={index}
                readiness={readiness}
                reviewModels={reviewModels}
                artifactReview={artifactReview}
                coverage={coverage}
                features={FEATURES}
                onSelectScreen={() => {}}
            />,
        );
        // The blocked P0 handoff surfaces in the implementation preflight.
        expect(getByText(/Home Dashboard handoff is blocked/)).toBeTruthy();
    });
});

// --- Phase 5B: trace bridge on the Handoff tab -------------------------------

const TRACE_DATA_MODEL: import('../../types').DataModelContent = {
    entities: [
        {
            name: 'Submission',
            description: 'A submitted project',
            fields: [
                { name: 'id', type: 'string', required: true, description: '' },
                { name: 'status', type: 'string', required: true, description: '' },
            ],
            relationships: [],
            featureRefs: ['F1'],
        },
    ],
};

const TRACE_PLAN: import('../../types').StructuredImplementationPlan = {
    milestones: [
        {
            id: 'm1',
            name: 'Foundation',
            linkedArtifacts: { screens: ['Submission Wizard'] },
            tasks: [
                { id: 't1', title: 'Build the /submission route and SubmissionWizard', description: 'Wire it.', status: 'todo' },
            ],
        },
    ],
} as unknown as import('../../types').StructuredImplementationPlan;

describe('Phase 5B handoff trace bridge', () => {
    it('17-18. renders the trace confidence summary + Data Model support match', () => {
        const { getByText, getAllByText } = renderContractDetail('handoff', {
            onSaveScreenEdit: vi.fn(),
            traceDataModel: TRACE_DATA_MODEL,
            tracePlan: TRACE_PLAN,
        });
        expect(getByText('Trace confidence')).toBeTruthy();
        expect(getByText('Data Model support')).toBeTruthy();
        // The Submission entity matches by shared PRD feature F1.
        expect(getAllByText('Submission').length).toBeGreaterThan(0);
        expect(getAllByText('Explicit trace').length).toBeGreaterThan(0);
    });

    it('19. renders the missing Data Model state when nothing matches', () => {
        const { getByText } = renderContractDetail('handoff', {
            onSaveScreenEdit: vi.fn(),
            traceDataModel: { entities: [
                { name: 'ZebraOnly', description: '', fields: [], relationships: [] },
            ] },
            tracePlan: null,
        });
        expect(getByText(/No linked Data Model entities found/)).toBeTruthy();
    });

    it('20. renders related Implementation Plan items when matched', () => {
        const { getByText } = renderContractDetail('handoff', {
            onSaveScreenEdit: vi.fn(),
            traceDataModel: TRACE_DATA_MODEL,
            tracePlan: TRACE_PLAN,
        });
        expect(getByText('Related implementation plan items')).toBeTruthy();
        expect(getByText(/Build the \/submission route/)).toBeTruthy();
    });

    it('21. renders the missing Implementation Plan state', () => {
        const { getByText } = renderContractDetail('handoff', {
            onSaveScreenEdit: vi.fn(),
            traceDataModel: TRACE_DATA_MODEL,
            tracePlan: { milestones: [{ id: 'm', name: 'M', tasks: [
                { id: 't', title: 'Unrelated work', description: 'nothing', status: 'todo' },
            ] }] } as unknown as import('../../types').StructuredImplementationPlan,
        });
        expect(getByText(/No related Implementation Plan tasks found/)).toBeTruthy();
    });

    it('22. Copy handoff includes the trace sections', async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
        const { getByText } = renderContractDetail('handoff', {
            onSaveScreenEdit: vi.fn(),
            traceDataModel: TRACE_DATA_MODEL,
            tracePlan: TRACE_PLAN,
        });
        fireEvent.click(getByText('Copy handoff'));
        await Promise.resolve();
        const md = writeText.mock.calls[0][0] as string;
        expect(md).toContain('## Trace Confidence');
        expect(md).toContain('## Data Model Support');
        expect(md).toContain('## Related Implementation Plan Items');
    });

    it('23. the coverage panel shows the handoff trace rollup', () => {
        const { index, readiness, coverage, reviewModels, artifactReview } = buildReviewFixtures();
        const { getByText } = render(
            <ScreenListView
                index={index}
                readiness={readiness}
                reviewModels={reviewModels}
                artifactReview={artifactReview}
                coverage={coverage}
                features={FEATURES}
                traceDataModel={TRACE_DATA_MODEL}
                tracePlan={null}
                onSelectScreen={() => {}}
            />,
        );
        // Trace rollup row renders once trace bridges exist.
        expect(getByText('Handoff trace')).toBeTruthy();
    });
});
