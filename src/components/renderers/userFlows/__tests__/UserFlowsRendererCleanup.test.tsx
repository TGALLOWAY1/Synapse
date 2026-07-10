import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { DomainEntity, Feature, UXPage } from '../../../../types';
import { UserFlowsRenderer } from '../UserFlowsRenderer';

const SINGLE_FLOW = `### Flow: Recipe ingestion (Core Experience)
**Goal:** Import a recipe via [f1] NLP Recipe Importer.
**Preconditions:** User is logged in.
**Steps:**
1. [NLP Recipe Importer] — User pastes URL → System scrapes and parses via [f1]
2. [Save Recipe to Library] — User clicks Save → System persists JSON
**Success Outcome:** The recipe is saved within < 5 seconds.
**Edge Cases:** First-time user with no saved recipes.`;

const TWO_FLOWS = `### Flow: Onboarding (First-Time User Onboarding)
**Goal:** Reach the dashboard.
**Steps:**
1. [Landing Page] — User taps Get started → System routes to sign-in
2. [Dashboard] — User arrives → System loads workspace
**Success Outcome:** Done.

### Flow: Recipe ingestion (Core Experience)
**Goal:** Import a recipe.
**Steps:**
1. [Importer] — User pastes URL → System parses
**Success Outcome:** Saved.`;

const FEATURES: Feature[] = [
    {
        id: 'f1',
        name: 'NLP Recipe Importer',
        description: 'Import recipes from a URL or raw text.',
        userValue: 'Saves manual entry.',
        complexity: 'medium',
        priority: 'must',
    },
];

const UX_PAGES: UXPage[] = [
    {
        id: 'p1',
        name: 'Save Recipe to Library',
        purpose: 'Persist a parsed recipe',
        components: ['Save button'],
        interactions: ['Click save'],
    },
];

const ENTITIES: DomainEntity[] = [
    { name: 'Recipe', description: 'A saved recipe record' },
];

const FLOW_WITH_RELATED_FEATURES = `### Flow: Document ingestion (Core Experience)
**Goal:** Upload a static educational infographic to be digitized by the AI pipelines.
**Related Features:** [f1] High-Resolution Image Ingestion, [f2] Spatial OCR Extraction
**Steps:**
1. [Document Library] — User uploads a file → System stores it
**Success Outcome:** The document is uploaded and structured.`;

const RELATED_FEATURE_CATALOG: Feature[] = [
    {
        id: 'f1',
        name: 'High-Resolution Image Ingestion',
        description: 'Ingest high-resolution source images.',
        userValue: 'Keeps the source sharp.',
        complexity: 'medium',
        priority: 'must',
    },
    {
        id: 'f2',
        name: 'Spatial OCR Extraction',
        description: 'Extract text while preserving coordinates.',
        userValue: 'Preserves layout.',
        complexity: 'high',
        priority: 'must',
    },
];

/** Expand every journey step-detail toggle (rows + single-card toggles). */
function expandAllJourneySteps() {
    screen.getAllByRole('button')
        .filter(b => b.getAttribute('aria-expanded') === 'false')
        .forEach(b => fireEvent.click(b));
}

describe('UserFlowsRenderer — desktop cleanup', () => {
    it('drops the flow-header metadata chips and "Related:" summary (that info lives in the sections below)', () => {
        render(
            <UserFlowsRenderer
                content={SINGLE_FLOW}
                features={FEATURES}
                uxPages={UX_PAGES}
                domainEntities={ENTITIES}
            />,
        );
        // The old compact "Related: … features" header summary is gone — those
        // features surface only in the collapsible Related artifacts panel. The
        // "Related:" prefix was unique to that main-card summary (the flow rail
        // shows a bare "N features"), so its absence proves the header row of
        // metadata chips + summary was removed. Step counts / risk dots
        // deliberately remain in the flow rail and Journey header.
        expect(screen.queryByText(/^Related:/i)).toBeNull();
    });

    it('strips the "Related Features:" line out of the goal and surfaces those features in Related artifacts', () => {
        render(
            <UserFlowsRenderer
                content={FLOW_WITH_RELATED_FEATURES}
                features={RELATED_FEATURE_CATALOG}
            />,
        );
        // The goal prose renders, but the bold "Related Features:" label and its
        // inline feature chips are no longer part of the goal block.
        expect(screen.getByText(/Upload a static educational infographic/i)).toBeInTheDocument();
        expect(screen.queryByText(/Related Features:/i)).toBeNull();
        expect(screen.queryAllByTestId('feature-ref-f1')).toHaveLength(0);
        // Expanding the Related artifacts panel reveals them as structured chips —
        // proving the feature refs still aggregate out of the split-off line.
        fireEvent.click(screen.getByRole('button', { name: /Related artifacts/i }));
        expect(screen.getAllByTestId('feature-ref-f1').length).toBeGreaterThan(0);
        expect(screen.getAllByTestId('feature-ref-f2').length).toBeGreaterThan(0);
    });

    it('keeps Related Artifacts collapsed by default and reveals it on toggle', () => {
        render(
            <UserFlowsRenderer
                content={SINGLE_FLOW}
                features={FEATURES}
                uxPages={UX_PAGES}
                domainEntities={ENTITIES}
            />,
        );
        const toggle = screen.getByRole('button', { name: /Related artifacts/i });
        expect(toggle).toHaveAttribute('aria-expanded', 'false');
        // The inner "Data entities" subsection isn't in the DOM while collapsed.
        expect(screen.queryByText(/Data entities/i)).toBeNull();
        fireEvent.click(toggle);
        expect(toggle).toHaveAttribute('aria-expanded', 'true');
        expect(screen.getByText(/Data entities/i)).toBeInTheDocument();
    });

    it('renders step feature references as a quiet inline "Uses:" list once the step is expanded', () => {
        render(<UserFlowsRenderer content={SINGLE_FLOW} features={FEATURES} />);
        // Step detail now lives INSIDE journey rows (the duplicate step-card
        // list is gone — audit H5); expand every step's detail first.
        expandAllJourneySteps();
        // The inline label is present…
        expect(screen.getAllByText(/^Uses$/i).length).toBeGreaterThan(0);
        // …and the feature name is a plain clickable button, not the old
        // fuchsia chip (which rendered a monospace uppercase id token).
        const usesButtons = screen.getAllByRole('button', { name: 'NLP Recipe Importer' });
        expect(usesButtons.length).toBeGreaterThan(0);
    });

    it('does not render a duplicate step-by-step section below the journey', () => {
        render(<UserFlowsRenderer content={SINGLE_FLOW} features={FEATURES} />);
        expect(screen.queryByText(/Step-by-step flow/i)).toBeNull();
    });

    it('switches flows from the expanded-by-default desktop rail', () => {
        render(<UserFlowsRenderer content={TWO_FLOWS} features={FEATURES} />);
        // Flow 1 is selected initially — its goal is visible.
        expect(screen.getByText(/Reach the dashboard\./i)).toBeInTheDocument();
        expect(screen.queryByText(/Import a recipe\./i)).toBeNull();
        // The rail now defaults to the NAMED flow list (audit L4) — switch by title.
        const nav = screen.getByRole('complementary', { name: /Flow navigation/i });
        fireEvent.click(within(nav).getByText(/Recipe ingestion/));
        // The header now shows flow 2's goal, not flow 1's.
        expect(screen.getByText(/Import a recipe\./i)).toBeInTheDocument();
        expect(screen.queryByText(/Reach the dashboard\./i)).toBeNull();
    });

    it('collapses the desktop rail to the numbered strip on demand', () => {
        render(<UserFlowsRenderer content={TWO_FLOWS} features={FEATURES} />);
        // Expanded (named) by default…
        const nav = screen.getByRole('complementary', { name: /Flow navigation/i });
        expect(within(nav).getByText(/Onboarding/)).toBeInTheDocument();
        // …and collapsible back to the numbered strip.
        fireEvent.click(screen.getByRole('button', { name: /Collapse flow list/i }));
        expect(within(nav).getByRole('button', { name: /Flow 2:/i })).toBeInTheDocument();
    });
});
