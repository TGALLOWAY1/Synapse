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

describe('UserFlowsRenderer — desktop cleanup', () => {
    it('shows a compact relationship summary instead of a repeated feature chip row', () => {
        render(
            <UserFlowsRenderer
                content={SINGLE_FLOW}
                features={FEATURES}
                uxPages={UX_PAGES}
                domainEntities={ENTITIES}
            />,
        );
        // The header carries a compact "Related: … features …" summary line
        // (distinct from the collapsible "Related artifacts" panel below).
        expect(screen.getByText(/Related: 1 feature/i)).toBeInTheDocument();
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

    it('renders step feature references as a quiet inline "Uses:" list, not large chips', () => {
        render(<UserFlowsRenderer content={SINGLE_FLOW} features={FEATURES} />);
        // The inline label is present…
        expect(screen.getAllByText(/^Uses$/i).length).toBeGreaterThan(0);
        // …and the feature name is a plain clickable button, not the old
        // fuchsia chip (which rendered a monospace uppercase id token).
        const usesButtons = screen.getAllByRole('button', { name: 'NLP Recipe Importer' });
        expect(usesButtons.length).toBeGreaterThan(0);
    });

    it('switches flows from the collapsed desktop rail', () => {
        render(<UserFlowsRenderer content={TWO_FLOWS} features={FEATURES} />);
        // Flow 1 is selected initially — its goal is visible.
        expect(screen.getByText(/Reach the dashboard\./i)).toBeInTheDocument();
        expect(screen.queryByText(/Import a recipe\./i)).toBeNull();
        // The collapsed rail exposes a labelled switcher button for flow 2.
        const flow2 = screen.getByRole('button', { name: /Flow 2:/i });
        fireEvent.click(flow2);
        // The header now shows flow 2's goal, not flow 1's.
        expect(screen.getByText(/Import a recipe\./i)).toBeInTheDocument();
        expect(screen.queryByText(/Reach the dashboard\./i)).toBeNull();
    });

    it('expands the desktop rail to the full grouped list', () => {
        render(<UserFlowsRenderer content={TWO_FLOWS} features={FEATURES} />);
        const expand = screen.getByRole('button', { name: /Expand flow list/i });
        fireEvent.click(expand);
        // Expanded rail surfaces the category group header + full titles.
        const nav = screen.getByRole('complementary', { name: /Flow navigation/i });
        expect(within(nav).getByText(/User Flows/)).toBeInTheDocument();
        expect(within(nav).getByText(/Onboarding/)).toBeInTheDocument();
    });
});
