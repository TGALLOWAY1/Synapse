import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import type { Feature, MockupPayload, ScreenInventoryContent, ScreenItem } from '../../types';
import { buildScreenIndex, type ScreenMetadataEdit } from '../../lib/screenExperience';
import { buildReadinessIndex, buildScreenCoverageSummary, type ScreenCoverageSummary } from '../../lib/screenReadiness';
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
        // Flow-first: the card visualizes the next screen by name, not counts.
        expect(getByText('Item Detail')).toBeTruthy();
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

    it('withholds the green all-clear when a PRD feature is uncovered, even if every screen is ready', () => {
        const { index, readiness } = buildFixtures();
        // Every screen ready, no warnings — but one PRD feature links to no
        // screen, which is genuine implementation risk. The all-clear headline
        // must NOT fire (it would contradict the amber uncovered-feature row).
        const coverage: ScreenCoverageSummary = {
            totalScreens: 2,
            prdFeatures: { covered: 1, total: 2, uncovered: [{ id: 'F2', name: 'Sharing' }], mustWithoutPrimaryScreen: [] },
            stateVariants: null,
            flows: { represented: 1, total: 1 },
            p0: { total: 0, withMockup: 0 },
            states: { screensWithStates: 2, totalStates: 2, statesWithBehavior: 2 },
            mockups: { covered: 2, total: 2 },
            openRisks: 0,
            ready: 2, readyWithWarnings: 0, needsReview: 0,
            // Per-screen readiness sentence reads all-clear — it must NOT be
            // used as the headline while an artifact-level risk remains.
            message: 'All 2 screens pass the derived readiness checks. Review them once more before implementation.',
        };
        const { queryByText, getByText } = render(
            <ScreenListView index={index} readiness={readiness} coverage={coverage} onSelectScreen={() => {}} />,
        );
        // Neither the green all-clear nor the celebratory per-screen message.
        expect(queryByText(/Implementation coverage is complete/)).toBeNull();
        expect(queryByText(/All 2 screens pass the derived readiness checks/)).toBeNull();
        // A dedicated risk-aware headline is shown instead.
        expect(getByText(/some required coverage still needs review/)).toBeTruthy();
        expect(getByText(/1 PRD feature not linked to any screen/)).toBeTruthy();
    });

    it('surfaces stale/legacy primary-mockup signals even when no variants are recommended', () => {
        const { index, readiness, coverage } = buildFixtures();
        const { getByText, queryByText } = render(
            <ScreenListView
                index={index}
                readiness={readiness}
                coverage={coverage}
                // Desktop/simple project: only primary mockups, no additional
                // variants recommended — but one is stale and one is legacy.
                variantCoverage={{
                    recommendedGenerated: 2, recommendedTotal: 2,
                    additionalGenerated: 0, additionalTotal: 0,
                    p0WithMobile: 0, p0Total: 0,
                    legacyUnknownMockups: 1, manifestBackedGenerated: 0,
                    freshness: { total: 2, current: 1, review: 1, unknown: 0 },
                }}
                onSelectScreen={() => {}}
            />,
        );
        // No optional-variant section (nothing to expand into)...
        expect(queryByText('Expanded Design Coverage')).toBeNull();
        // ...yet the freshness + legacy signals for existing mockups still show.
        expect(getByText(/may be worth refreshing/)).toBeTruthy();
        expect(getByText(/predate coverage metadata/)).toBeTruthy();
    });

    it('exposes only the Flow and Status filters — no search / priority / sort / group / advanced', () => {
        const { index, readiness, coverage } = buildFixtures();
        const { getByLabelText, queryByLabelText, queryByText, queryByPlaceholderText } = render(
            <ScreenListView
                index={index}
                readiness={readiness}
                coverage={coverage}
                onSelectScreen={() => {}}
            />,
        );
        // Retained.
        expect(getByLabelText('Flow')).toBeTruthy();
        expect(getByLabelText('Status')).toBeTruthy();
        // Removed.
        expect(queryByPlaceholderText(/Search screens/)).toBeNull();
        expect(queryByLabelText('Priority')).toBeNull();
        expect(queryByLabelText('Sort')).toBeNull();
        expect(queryByLabelText('Group')).toBeNull();
        expect(queryByText('Advanced')).toBeNull();
    });

    it('renders an empty-filter state instead of nothing', () => {
        const { index, readiness, coverage } = buildFixtures();
        const { getByText, getByLabelText } = render(
            <ScreenListView
                index={index}
                readiness={readiness}
                coverage={coverage}
                onSelectScreen={() => {}}
            />,
        );
        // Status is now a compact select rather than a filter chip.
        fireEvent.change(getByLabelText('Status'), { target: { value: 'ready' } });
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

    it('Overview leads with the screen (Purpose, Acceptance checklist) and hides detail/handoff', () => {
        const { getByText, queryByText } = renderDetail('scr-home', 'overview');
        expect(getByText('Purpose')).toBeTruthy();
        expect(getByText('Acceptance checklist')).toBeTruthy();
        // PRD features + screen detail are progressively disclosed, not top-level.
        expect(getByText('PRD features')).toBeTruthy();
        expect(getByText('Screen details')).toBeTruthy();
        // Developer Handoff was moved out of the Screens artifact entirely.
        expect(queryByText('Developer Handoff')).toBeNull();
        expect(queryByText('Handoff')).toBeNull();
    });

    it('Overview survives a legacy screen with no optional fields', () => {
        const { getByText } = renderDetail('bare-legacy-screen', 'overview');
        expect(getByText('Purpose')).toBeTruthy();
        // Acceptance checklist degrades to a calm "not enough detail" line.
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
    tab: 'overview' | 'flow' | 'mockups',
    opts: {
        edits?: Parameters<typeof buildScreenIndex>[3];
        onSaveScreenEdit?: (id: string, edit: ScreenMetadataEdit | null) => void;
        withMockupContext?: boolean;
        trustContext?: import('../../lib/mockupVariantTrust').VariantTrustContext;
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
    it('Overview leads with the acceptance checklist; handoff detail is gone', () => {
        const { getByText, queryByText, getAllByText } = renderContractDetail('overview');
        // Acceptance criteria are a concise checklist (screen-level + per-state).
        expect(getByText('Acceptance checklist')).toBeTruthy();
        expect(getByText('User can submit end to end')).toBeTruthy();
        expect(getAllByText('Empty state appears when no evaluations exist').length).toBeGreaterThan(0);
        // Developer-handoff fields (route/components/events) no longer appear here.
        expect(queryByText('/submission')).toBeNull();
        expect(queryByText('onSubmitProject')).toBeNull();
        expect(queryByText('Wizard steps must be keyboard navigable')).toBeNull();
        // Noisy provenance badges are gone.
        expect(queryByText('From generated spec')).toBeNull();
        expect(queryByText('Mapped at generation')).toBeNull();
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

    it('a confirmed screen shows the confirmed state + Edit again', () => {
        const { getByText } = renderContractDetail('overview', {
            edits: { 'scr-submission': { reviewStatus: 'accepted' } } as never,
            onSaveScreenEdit: vi.fn(),
        });
        expect(getByText('Screen confirmed')).toBeTruthy();
        expect(getByText('Edit again')).toBeTruthy();
    });
});

// --- Phase 4A: review & approval workflow ------------------------------------

describe('single confirmation flow', () => {
    it('an unconfirmed screen shows the one review action: Confirm screen', () => {
        const { getByText, queryByText } = renderContractDetail('overview', { onSaveScreenEdit: vi.fn() });
        expect(getByText('Needs review')).toBeTruthy();
        expect(getByText('Confirm screen')).toBeTruthy();
        // The old competing review states are gone.
        expect(queryByText('Accept screen')).toBeNull();
        expect(queryByText('Mark ready to build')).toBeNull();
        expect(queryByText('Request changes')).toBeNull();
        expect(queryByText('System readiness')).toBeNull();
    });

    it('confirming persists accepted + a sign-off signature', () => {
        const onSave = vi.fn();
        const { getByText } = renderContractDetail('overview', { onSaveScreenEdit: onSave });
        fireEvent.click(getByText('Confirm screen'));
        expect(onSave).toHaveBeenCalledTimes(1);
        const [id, edit] = onSave.mock.calls[0] as [string, Record<string, unknown>];
        expect(id).toBe('scr-submission');
        expect(edit.reviewStatus).toBe('accepted');
        const review = edit.review as Record<string, unknown>;
        expect(review.acceptedAt).toBeTruthy();
        expect((review.signature as Record<string, unknown>).screenContractHash).toBeTruthy();
    });

    it('Edit again on a confirmed screen returns it to Needs Review', () => {
        const onSave = vi.fn();
        const { getByText } = renderContractDetail('overview', {
            edits: { 'scr-submission': { reviewStatus: 'accepted' } } as never,
            onSaveScreenEdit: onSave,
        });
        fireEvent.click(getByText('Edit again'));
        expect(onSave).toHaveBeenCalledTimes(1);
        const [, edit] = onSave.mock.calls[0] as [string, Record<string, unknown>];
        expect(edit.reviewStatus).toBe('needs_review');
    });

    it('editing details returns a confirmed screen to Needs Review', () => {
        const onSave = vi.fn();
        const { getByText, getByDisplayValue } = renderContractDetail('overview', {
            edits: { 'scr-submission': { reviewStatus: 'accepted' } } as never,
            onSaveScreenEdit: onSave,
        });
        fireEvent.click(getByText('Edit details'));
        fireEvent.change(getByDisplayValue('Guided project submission.'), { target: { value: 'Changed purpose.' } });
        fireEvent.click(getByText('Save'));
        const [, edit] = onSave.mock.calls[onSave.mock.calls.length - 1] as [string, Record<string, unknown>];
        expect(edit.reviewStatus).toBe('needs_review');
    });
});

describe('review notes', () => {
    it('flags issues behind a collapsed banner and lets the user address them', () => {
        const onSave = vi.fn();
        const { getByText } = renderContractDetail('overview', { onSaveScreenEdit: onSave });
        // Collapsed banner names the count; expanding reveals the notes.
        expect(getByText('Review notes')).toBeTruthy();
        fireEvent.click(getByText('Review notes'));
        // A risk resolution box is offered ("How should this be handled?").
        expect(getByText('How should this be handled?')).toBeTruthy();
    });

    it('resolving a risk persists structured input onto the overlay', () => {
        const onSave = vi.fn();
        const { getByText, getByPlaceholderText } = renderContractDetail('overview', { onSaveScreenEdit: onSave });
        fireEvent.click(getByText('Review notes'));
        const box = getByPlaceholderText(/friendly retry prompt/);
        fireEvent.change(box, { target: { value: 'Retry then fall back' } });
        fireEvent.click(getByText('Mark resolved'));
        const [, edit] = onSave.mock.calls[onSave.mock.calls.length - 1] as [string, Record<string, unknown>];
        const review = edit.review as Record<string, unknown>;
        expect(review.riskResolutions).toBeTruthy();
        expect(Object.values(review.riskResolutions as Record<string, string>)).toContain('Retry then fall back');
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
        // Review status is now secondary metadata behind each card's "Details".
        getAllByText('Show details').forEach(btn => fireEvent.click(btn));
        expect(getAllByText('Not reviewed').length).toBeGreaterThan(0);
    });

    it('relocates the artifact metadata/history/actions into each card\'s Show details', () => {
        const { index, readiness, coverage, reviewModels, artifactReview } = buildReviewFixtures();
        const onOpenVersionHistory = vi.fn();
        const onOpenMockupHistory = vi.fn();
        const onRegenerateMockup = vi.fn();
        const { getAllByText } = render(
            <ScreenListView
                index={index}
                readiness={readiness}
                reviewModels={reviewModels}
                artifactReview={artifactReview}
                coverage={coverage}
                artifactControls={{
                    prdVersionLabel: 'Version 3',
                    staleness: 'current',
                    lastMockupGeneratedAt: 1_700_000_000_000,
                    onOpenVersionHistory,
                    onOpenMockupHistory,
                    onRegenerateMockup,
                }}
                onSelectScreen={() => {}}
            />,
        );
        // Expand every card's details, then confirm the relocated controls appear.
        getAllByText('Show details').forEach(btn => fireEvent.click(btn));
        expect(getAllByText(/Generated from PRD Version 3/).length).toBeGreaterThan(0);
        const versionHistory = getAllByText('Version history');
        expect(versionHistory.length).toBeGreaterThan(0);
        fireEvent.click(versionHistory[0]);
        expect(onOpenVersionHistory).toHaveBeenCalled();
        fireEvent.click(getAllByText('Regenerate mockup')[0]);
        expect(onRegenerateMockup).toHaveBeenCalled();
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

    it('a legacy default with no source metadata reads PRD sync unknown', () => {
        const { getAllByText, getByText } = renderContractDetail('mockups', { trustContext: TRUST });
        // Default variant is generated via the legacy join but carries no
        // signature → unknown, never falsely stale.
        expect(getAllByText('PRD sync unknown').length).toBeGreaterThan(0);
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
        expect(getAllByText('Needs regeneration').length).toBeGreaterThan(0);
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
        expect(getAllByText('In sync with PRD').length).toBeGreaterThan(0);
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
        const { getByText, queryAllByText, getAllByText } = render(
            <ScreenListView
                index={index}
                readiness={readiness}
                reviewModels={reviewModels}
                artifactReview={artifactReview}
                coverage={coverage}
                onSelectScreen={() => {}}
            />,
        );
        // The accepted-but-outdated P0 dashboard surfaces a downstream note in
        // its (now secondary) Details section…
        getAllByText('Show details').forEach(btn => fireEvent.click(btn));
        expect(queryAllByText(/Downstream review/).length).toBeGreaterThan(0);
        // …but the coverage panel still renders normally.
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

// --- Phase 5A: implementation handoff rollup (list level) ---------------------
// The per-screen Handoff TAB was moved out of the Screens artifact into the
// Implementation Plan. The list-level handoff rollup (derived from the same
// libs, which are preserved) still surfaces in the coverage panel + card
// details, so those remain covered here.

describe('Phase 5A handoff rollup (list)', () => {
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
        // Handoff readiness is now secondary metadata behind each card's Details.
        getAllByText('Show details').forEach(btn => fireEvent.click(btn));
        // The unsigned P0 Home Dashboard has a blocked handoff.
        expect(getAllByText('Blocked').length).toBeGreaterThan(0);
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

// --- Phase 5B: trace bridge (list-level rollup) ------------------------------
// The per-screen trace bridge on the Handoff tab moved out of Screens with the
// rest of the developer handoff. The list-level trace rollup in the coverage
// panel (derived from the preserved libs) still surfaces here.

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

describe('Phase 5B handoff trace bridge (list rollup)', () => {
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
