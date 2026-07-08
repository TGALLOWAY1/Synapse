import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import type { Feature, MockupPayload, ScreenInventoryContent, ScreenItem } from '../../types';
import { buildScreenIndex, type ScreenMetadataEdit } from '../../lib/screenExperience';
import { buildReadinessIndex, buildScreenCoverageSummary } from '../../lib/screenReadiness';
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
        const { getByText } = renderDetail('bare-legacy-screen', 'overview');
        expect(getByText(/No linked PRD features found/)).toBeTruthy();
        expect(getByText(/No UI states documented/)).toBeTruthy();
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
            onSaveScreenEdit={opts.onSaveScreenEdit}
            mockupContext={opts.withMockupContext === false ? undefined : {
                projectId: 'p1',
                artifactId: 'a1',
                versionId: 'v1',
                payload: contractPayload,
                settings: { platform: 'desktop', fidelity: 'mid', scope: 'multi_screen' },
                versionNumber: 2,
                prdVersionLabel: 'Version 3',
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

    it('Mockups tab lists variant rows from metadata with honest statuses', () => {
        const { getByText, getAllByText } = renderContractDetail('mockups');
        expect(getByText('Mockup variants')).toBeTruthy();
        expect(getByText('Tracked from generated mockup metadata')).toBeTruthy();
        expect(getByText('Default view')).toBeTruthy();
        expect(getByText('Generated')).toBeTruthy();
        expect(getAllByText(/Generated from/).length).toBeGreaterThan(0);
        expect(getByText(/PRD Version 3 · mockup v2/)).toBeTruthy();
        expect(getByText('Empty history')).toBeTruthy();
        expect(getAllByText('Missing').length).toBe(2);
        // Only real actions are offered; per-variant generation is not claimed.
        expect(getByText(/Per-variant generation isn’t wired yet/)).toBeTruthy();
    });

    it('marking a variant not needed persists through the edit overlay', () => {
        const onSave = vi.fn();
        const { getAllByText } = renderContractDetail('mockups', { onSaveScreenEdit: onSave });
        fireEvent.click(getAllByText('Not needed')[0]);
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

describe('missing variant acceptance (review-feedback regression)', () => {
    it('a missing variant row can be marked accepted (e.g. verified via upload), not just not-needed', () => {
        const onSave = vi.fn();
        const { getAllByText } = renderContractDetail('mockups', { onSaveScreenEdit: onSave });
        // Row order: default (generated) → Empty history (missing) → Upload
        // error (missing); the first "Mark accepted" after the default row's
        // belongs to the missing Empty history row.
        fireEvent.click(getAllByText('Mark accepted')[1]);
        expect(onSave).toHaveBeenCalledTimes(1);
        const [, edit] = onSave.mock.calls[0] as [string, Record<string, unknown>];
        expect(edit.mockupVariantStatus).toEqual({ 'state:empty-history': 'accepted' });
    });
});
