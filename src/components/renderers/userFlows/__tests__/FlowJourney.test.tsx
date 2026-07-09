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

// A flow where several consecutive steps happen on the same screen — the exact
// shape that used to render as repeated identical nodes (the demo quirk).
const GROUPED_MARKDOWN = `### Flow: Submit
**Goal:** Submit a project.
**Steps:**
1. [Landing Page] — User picks a role → System routes onward
2. [Project Form] — User chooses submission type → System branches
   - **Decision:** If guided, go to step 3; otherwise step 4
3. [Project Form] — User fills in project details → System validates
4. [Project Form] — User adds evaluation criteria → System saves draft
5. [Progress Screen] — User watches analysis → System streams progress
**Success Outcome:** Done.`;

const groupedSteps = parseFlows(GROUPED_MARKDOWN)[0].steps;

describe('FlowJourney screen grouping', () => {
    it('renders one screen header per run of same-screen steps', () => {
        render(<FlowJourney flowIndex={0} steps={groupedSteps} issuesByStep={new Map()} />);
        // "Project Form" owns steps 2–4 but the name appears once as a header.
        expect(screen.getAllByText('Project Form')).toHaveLength(1);
        expect(screen.getByText('Steps 2–4')).toBeInTheDocument();
    });

    it('labels grouped sub-steps by their user action, not the screen name', () => {
        render(<FlowJourney flowIndex={0} steps={groupedSteps} issuesByStep={new Map()} />);
        expect(screen.getByText('User chooses submission type')).toBeInTheDocument();
        expect(screen.getByText('User fills in project details')).toBeInTheDocument();
        expect(screen.getByText('User adds evaluation criteria')).toBeInTheDocument();
    });

    it('highlights the sub-step for the current screen inside a group', () => {
        render(
            <FlowJourney
                flowIndex={0}
                steps={groupedSteps}
                issuesByStep={new Map()}
                highlightedStepIndices={new Set([2])}
            />,
        );
        expect(
            screen.getByRole('button', { name: /User fills in project details/ }),
        ).toHaveAttribute('aria-current', 'true');
    });
});
