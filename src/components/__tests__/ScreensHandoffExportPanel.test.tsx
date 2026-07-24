import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent, within } from '@testing-library/react';
import type { ScreenItem } from '../../types';
import type { ScreenExperienceItem } from '../../lib/screenExperience';
import type {
    ScreenReviewModel, SystemReadinessStatus, ScreenReviewFreshnessStatus,
} from '../../lib/screenReviewWorkflow';
import { buildScreenArtifactReviewReadiness } from '../../lib/screenReviewWorkflow';
import type { DerivedMockupVariant } from '../../lib/mockupVariants';
import {
    buildScreenImplementationHandoff, buildScreensHandoffRollup, buildHandoffPreflightContribution,
} from '../../lib/screenImplementationHandoff';
import { buildScreensPreflight, screenDownstreamInputFromModel } from '../../lib/screenDownstreamImpact';
import type { ScreensHandoffExportInput } from '../../lib/screenHandoffExport';
import { ScreensHandoffExportPanel } from '../experience/ScreensHandoffExportPanel';

// Component smoke tests for the Phase 5C export panel — it must render the three
// export-readiness states, surface the copy/download actions for both formats,
// and show a non-blocking warning for a not-ready export. Presentational over
// the pure package builder; clipboard/download are stubbed.

beforeEach(() => {
    vi.stubGlobal('matchMedia', vi.fn().mockImplementation((query: string) => ({
        matches: false, media: query,
        addEventListener: vi.fn(), removeEventListener: vi.fn(),
        addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
    })));
});

function screen(overrides: Partial<ScreenItem> = {}): ScreenItem {
    return {
        name: 'Landing & Role Selection',
        priority: 'P0',
        purpose: 'Entry point.',
        userIntent: 'Select a target role',
        featureRefs: ['F1'],
        entryPoints: ['App launch'],
        exitPaths: [{ label: 'Start', target: 'Dashboard' }],
        coreUIElements: ['Hero banner'],
        acceptanceCriteria: ['User can select a role.'],
        handoff: { route: '/', dataDependencies: ['Evaluation'] },
        ...overrides,
    };
}

function reviewModel(overrides: Partial<ScreenReviewModel> = {}): ScreenReviewModel {
    return {
        userStatus: 'implementation_ready',
        systemReadiness: 'ready' as SystemReadinessStatus,
        issues: [], blockingCount: 0, reviewCount: 0, infoCount: 0,
        acceptedOverWarnings: false,
        freshness: 'current' as ScreenReviewFreshnessStatus,
        ...overrides,
    };
}

function variant(): DerivedMockupVariant {
    return {
        id: 'default', screenId: 'scr-landing', viewport: 'desktop',
        stateName: 'Default', stateType: 'default', status: 'generated',
        required: true, userSet: false, source: 'legacy',
        coverageStatus: 'unknown', coverageEstimated: true,
        imagePresence: 'present', notes: [],
    };
}

function item(scr: ScreenItem): ScreenExperienceItem {
    return {
        id: 'scr-landing', slug: 'landing', screen: scr, baseScreen: scr,
        isEdited: false, sectionTitle: 'Main', relatedFlows: [],
    };
}

function buildInput(model: ScreenReviewModel): Omit<ScreensHandoffExportInput, 'exportedAt'> {
    const scr = screen();
    const it = item(scr);
    const reviewModels = new Map([[it.id, model]]);
    const p0Ids = new Set([it.id]);
    const handoff = buildScreenImplementationHandoff({
        item: it, reviewModel: model, variants: [variant()],
    });
    const handoffs = [handoff];
    const artifactReview = buildScreenArtifactReviewReadiness([
        { id: it.id, name: scr.name!, isP0: true, model },
    ]);
    const inputs = [screenDownstreamInputFromModel(it, model)];
    const contribution = buildHandoffPreflightContribution(handoffs, p0Ids);
    const preflight = buildScreensPreflight(inputs, artifactReview, contribution);
    const handoffRollup = buildScreensHandoffRollup(handoffs, p0Ids);
    return {
        projectName: 'Test App', handoffs, reviewModels, preflight, handoffRollup, p0Ids,
        manifest: { dataModelPresent: false, implementationPlanPresent: false },
    };
}

/** Expand the collapsed panel and return its root. */
function renderExpanded(input: Omit<ScreensHandoffExportInput, 'exportedAt'>) {
    const utils = render(<ScreensHandoffExportPanel input={input} />);
    const header = utils.getByRole('button', { name: /implementation handoff export/i });
    fireEvent.click(header);
    return utils;
}

describe('ScreensHandoffExportPanel', () => {
    it('16. renders the ready state', () => {
        const utils = renderExpanded(buildInput(reviewModel()));
        expect(utils.getAllByText(/ready to export/i).length).toBeGreaterThan(0);
    });

    it('17. renders the review-recommended state', () => {
        // A supporting-review path: unknown freshness + accepted (not impl-ready)
        // keeps the P0 gate ready but downgrades to review via mockup freshness.
        const model = reviewModel({
            userStatus: 'accepted',
            reviewCount: 1,
            issues: [{ id: 'mockup_freshness_unknown', severity: 'review', category: 'mockup_freshness', title: 'Mockup freshness unknown', description: '' }],
        });
        const utils = renderExpanded(buildInput(model));
        expect(utils.getAllByText(/review notes|review recommended/i).length).toBeGreaterThan(0);
    });

    it('18 & 22. renders a non-blocking not-ready warning', () => {
        const model = reviewModel({
            userStatus: 'draft',
            systemReadiness: 'blocked',
            blockingCount: 1,
            issues: [{ id: 'x', severity: 'blocking', category: 'purpose', title: 'No purpose recorded', description: '' }],
        });
        const utils = renderExpanded(buildInput(model));
        expect(utils.getAllByText(/not ready yet/i).length).toBeGreaterThan(0);
        // Still non-blocking: the export actions remain present.
        expect(utils.getByRole('button', { name: /copy markdown/i })).toBeTruthy();
    });

    it('19-21. exposes copy/download actions for Markdown and JSON', () => {
        const utils = renderExpanded(buildInput(reviewModel()));
        expect(utils.getByRole('button', { name: /copy markdown/i })).toBeTruthy();
        expect(utils.getByRole('button', { name: /download markdown/i })).toBeTruthy();
        expect(utils.getByRole('button', { name: /copy json/i })).toBeTruthy();
        expect(utils.getByRole('button', { name: /download json/i })).toBeTruthy();
    });

    it('copies markdown to the clipboard when Copy Markdown is clicked', async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        vi.stubGlobal('navigator', { clipboard: { writeText } });
        const utils = renderExpanded(buildInput(reviewModel()));
        const btn = utils.getByRole('button', { name: /copy markdown/i });
        fireEvent.click(btn);
        await Promise.resolve();
        expect(writeText).toHaveBeenCalledTimes(1);
        expect(writeText.mock.calls[0][0]).toContain('# Screens Implementation Handoff');
    });

    it('shows the included-artifacts / caveats disclosure', () => {
        const utils = renderExpanded(buildInput(reviewModel()));
        const details = utils.getByText(/what's included/i);
        expect(details).toBeTruthy();
        // The caveat about no image data is always present.
        fireEvent.click(details);
        expect(within(utils.container).getByText(/no image data is embedded/i)).toBeTruthy();
    });
});
