import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import type { Feature, MockupPayload, ScreenInventoryContent, ScreenItem } from '../../types';
import { buildScreenIndex } from '../../lib/screenExperience';
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
