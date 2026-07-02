import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { FlowJourney } from '../FlowJourney';
import { parseFlows } from '../parseFlow';

// "Landing Page" / "Dashboard" / "Unknown View" all infer as `screen` journey
// nodes (SCREEN_HINTS: page/dashboard/view), so navigation eligibility is
// decided purely by slug membership in availableScreenSlugs.
const MARKDOWN = `### Flow: Onboarding
**Goal:** Reach the dashboard.
**Steps:**
1. [Landing Page] — User taps Get started → System routes to sign-in
2. [Unknown View] — User wanders → System shrugs
3. [Dashboard] — User arrives → System loads workspace
**Success Outcome:** Done.`;

const steps = parseFlows(MARKDOWN)[0].steps;
const SLUGS: ReadonlySet<string> = new Set(['landing-page', 'dashboard']);

describe('FlowJourney screen-node navigation', () => {
    it('navigates when a screen node matches an available slug', () => {
        const onNavigate = vi.fn();
        render(
            <FlowJourney
                flowIndex={0}
                steps={steps}
                issuesByStep={new Map()}
                onNavigateToScreen={onNavigate}
                availableScreenSlugs={SLUGS}
            />,
        );
        fireEvent.click(screen.getByRole('button', { name: /Landing Page/ }));
        expect(onNavigate).toHaveBeenCalledWith('landing-page');
    });

    it('falls back to scroll behavior for screen nodes with no matching slug', () => {
        const onNavigate = vi.fn();
        render(
            <FlowJourney
                flowIndex={0}
                steps={steps}
                issuesByStep={new Map()}
                onNavigateToScreen={onNavigate}
                availableScreenSlugs={SLUGS}
            />,
        );
        // "Unknown View" is a screen node, but its slug isn't available.
        fireEvent.click(screen.getByRole('button', { name: /Unknown View/ }));
        expect(onNavigate).not.toHaveBeenCalled();
    });

    it('keeps the default behavior when navigation props are omitted', () => {
        render(
            <FlowJourney flowIndex={0} steps={steps} issuesByStep={new Map()} />,
        );
        // No matching StepCard exists in this render, so the click is a no-op
        // (getElementById miss) — it must not throw.
        fireEvent.click(screen.getByRole('button', { name: /Landing Page/ }));
    });

    it('marks highlighted steps with aria-current', () => {
        render(
            <FlowJourney
                flowIndex={0}
                steps={steps}
                issuesByStep={new Map()}
                highlightedStepIndices={new Set([2])}
            />,
        );
        expect(screen.getByRole('button', { name: /Dashboard/ })).toHaveAttribute('aria-current', 'true');
        expect(screen.getByRole('button', { name: /Landing Page/ })).not.toHaveAttribute('aria-current');
    });
});
