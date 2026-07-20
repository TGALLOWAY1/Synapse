import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { Feature } from '../../../../types';
import { UserFlowsRenderer } from '../UserFlowsRenderer';

const SAMPLE_MARKDOWN = `### Flow: Recipe ingestion (First-Time User Onboarding)
**Goal:** Import a recipe via [f1] NLP Recipe Importer and review [f9] Real-Time Macro Calculator output.
**Preconditions:** User is logged in.
**Steps:**
1. [NLP Recipe Importer] — User pastes URL → System scrapes and parses
2. [Importing Recipe] — System runs LLM extraction → Spinner displayed
3. [Macro Calculator] — System computes nutrition via [f3] Dynamic Serving Scaler → User adjusts portions
4. [Save Recipe to Library] — User clicks Save → System persists JSON
**Success Outcome:** The recipe is saved within < 5 seconds.
**Error Paths:**
- Network timeout → Step 1 retries with backoff
- Invalid recipe URL → Show inline validation error
**Edge Cases:** First-time user with no saved recipes.`;

const FEATURES: Feature[] = [
    {
        id: 'f1',
        name: 'NLP Recipe Importer',
        description: 'Import recipes from a URL or raw text using a scraper microservice + LLM extraction.',
        userValue: 'Saves users from manual recipe entry.',
        complexity: 'medium',
        priority: 'must',
        acceptanceCriteria: [
            'Import from URL or raw text',
            'Web scraping and content normalization',
            'LLM extraction to structured recipe JSON',
        ],
    },
    {
        id: 'f3',
        name: 'Dynamic Serving Scaler',
        description: 'Scale recipe servings up or down with USDA-accurate nutrition.',
        userValue: 'Lets users adapt recipes to portion size.',
        complexity: 'low',
    },
];

describe('UserFlowsRenderer', () => {
    it('selects and expands the exact flow step supplied by an update plan', () => {
        const content = `${SAMPLE_MARKDOWN}\n\n### Flow: Update preferences\n**Goal:** Save a local preference.\n**Steps:**\n1. [Settings] — User changes theme → System saves locally\n**Success Outcome:** Preference saved.`;
        const { container } = render(
            <UserFlowsRenderer
                content={content}
                features={FEATURES}
                initialFlowId="update-preferences"
                initialStepIndex={0}
            />,
        );

        expect(screen.getByText(/Flow 2/i)).toBeInTheDocument();
        expect(container.querySelector('#flow-1-step-0')).toBeInTheDocument();
        expect(screen.getAllByText(/System saves locally/i).length).toBeGreaterThan(0);
    });

    it('does not render the legacy Summary / Detailed / Debug toggle', () => {
        render(<UserFlowsRenderer content={SAMPLE_MARKDOWN} features={FEATURES} />);
        // The toggle was a [role=tablist] aria-label="View mode".
        expect(screen.queryByRole('tablist', { name: /view mode/i })).toBeNull();
        expect(screen.queryByText(/^summary$/i)).toBeNull();
        expect(screen.queryByText(/^detailed$/i)).toBeNull();
        expect(screen.queryByText(/debug \/ qa/i)).toBeNull();
    });

    it('renders the structured flow header with category, without the old metadata chips or "Related:" summary', () => {
        const { container } = render(
            <UserFlowsRenderer content={SAMPLE_MARKDOWN} features={FEATURES} />,
        );
        expect(screen.getByText(/Flow 1/i)).toBeInTheDocument();
        // Category appears once as the sidebar group header and once as a
        // chip on the selected flow card; either is fine.
        expect(container.textContent).toMatch(/Core Experience/);
        // The header metadata pills (step count, alt paths, risk) and the
        // "Related: … features" summary line were removed — that information now
        // lives in the Flow journey / Alternate paths / Related artifacts
        // sections and the flow rail. The "Related:" prefix was unique to the
        // removed main-card summary (the rail shows a bare "N features"), so its
        // absence confirms the header metadata row is gone.
        expect(screen.queryByText(/^Related:/i)).toBeNull();
    });

    it('does not surface a misleading "errors" label in the flow list', () => {
        const { container } = render(
            <UserFlowsRenderer content={SAMPLE_MARKDOWN} features={FEATURES} />,
        );
        // The sidebar copy used to say "2 errors" — check that a bare
        // "errors" count chip is gone.
        expect(container.textContent ?? '').not.toMatch(/\b\d+ errors?\b/);
        // Replacement labels should appear somewhere instead.
        expect(container.textContent ?? '').toMatch(/alternate path/i);
    });

    it('renders feature reference chips inline for [f1] / [f3] / [f9]', () => {
        render(<UserFlowsRenderer content={SAMPLE_MARKDOWN} features={FEATURES} />);
        // [f1] is in the goal line — should be a button (chip).
        expect(screen.queryAllByTestId('feature-ref-f1').length).toBeGreaterThan(0);
        // [f9] is referenced in goal too, even though the catalog has no entry —
        // we still want a chip rendered (graceful fallback).
        expect(screen.queryAllByTestId('feature-ref-f9').length).toBeGreaterThan(0);
        // [f3] lives in step 3's text — step detail now renders inside the
        // journey row's expansion (the duplicate step-card list is gone).
        screen.getAllByRole('button')
            .filter(b => b.getAttribute('aria-expanded') === 'false')
            .forEach(b => fireEvent.click(b));
        expect(screen.queryAllByTestId('feature-ref-f3').length).toBeGreaterThan(0);
    });

    it('opens the feature drawer when a chip is clicked', () => {
        render(<UserFlowsRenderer content={SAMPLE_MARKDOWN} features={FEATURES} />);
        const chip = screen.queryAllByTestId('feature-ref-f1')[0];
        expect(chip).toBeTruthy();
        fireEvent.click(chip);
        // Drawer is a dialog with name "Feature details".
        const drawer = screen.getByRole('dialog', { name: /feature details/i });
        expect(drawer).toBeInTheDocument();
        // Confirm the drawer surfaces the feature's name when known.
        expect(drawer.textContent).toMatch(/NLP Recipe Importer/);
    });

    it('shows graceful fallback for an unknown feature reference in the drawer', () => {
        render(<UserFlowsRenderer content={SAMPLE_MARKDOWN} features={FEATURES} />);
        const chip = screen.queryAllByTestId('feature-ref-f9')[0];
        expect(chip).toBeTruthy();
        fireEvent.click(chip);
        const drawer = screen.getByRole('dialog', { name: /feature details/i });
        expect(drawer.textContent).toMatch(/No additional feature metadata available/i);
    });

    it('renders a flow journey with typed nodes and not the legacy diagram label', () => {
        const { container } = render(
            <UserFlowsRenderer content={SAMPLE_MARKDOWN} features={FEATURES} />,
        );
        // The new heading.
        expect(container.textContent).toMatch(/Flow journey/i);
        // The journey legend explains node types.
        expect(container.textContent).toMatch(/Screen/);
        expect(container.textContent).toMatch(/State/);
        expect(container.textContent).toMatch(/Action/);
    });

    it('renders an Alternate paths & edge cases section instead of generic "errors"', () => {
        const { container } = render(
            <UserFlowsRenderer content={SAMPLE_MARKDOWN} features={FEATURES} />,
        );
        expect(container.textContent).toMatch(/Alternate paths & edge cases/i);
        // No section heading should call them just "errors" anymore.
        expect(container.textContent).not.toMatch(/General error paths/i);
    });

    it('numbers flows by grouped display order, not authored order, when categories are out of CATEGORY_ORDER order', () => {
        // Authored order: Sharing & Collaboration, Onboarding, Auth & Identity —
        // deliberately NOT in CATEGORY_ORDER order (Onboarding, Auth & Identity,
        // Core Experience, Sharing & Collaboration, Other). A naive
        // `originalIndex + 1` would show the Auth flow (authored 3rd) as
        // "Flow 3", but the sidebar groups it under Auth & Identity, which
        // renders second — so it must display as "Flow 2".
        const content = `### Flow: Invite a teammate
**Goal:** Share a workspace with a collaborator.
**Steps:**
1. [Share dialog] — User invites teammate → System sends invite

### Flow: Welcome tour
**Goal:** Get started for the first time.
**Steps:**
1. [Welcome] — User views tour → System advances slide

### Flow: Log in
**Goal:** Sign in with a password.
**Steps:**
1. [Login] — User signs in → System authenticates`;

        const { container } = render(<UserFlowsRenderer content={content} initialFlowId="log-in" />);

        // Grouped order: Onboarding (Welcome tour) → 1, Auth & Identity (Log in)
        // → 2, Sharing & Collaboration (Invite a teammate) → 3.
        expect(container.textContent).toMatch(/Flow 2/);
        expect(container.textContent).not.toMatch(/Flow 3\D/);
    });
});
