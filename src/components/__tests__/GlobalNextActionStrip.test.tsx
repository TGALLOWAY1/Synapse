import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { PlanningAttentionSummary, PlanningReadiness } from '../../lib/planning';
import { GlobalNextActionStrip } from '../planning/GlobalNextActionStrip';

const readiness: PlanningReadiness = {
    phase: 'needs_decisions',
    headline: 'Important choices need attention',
    summary: 'Resolve the consequential choices before treating the plan as settled.',
    criteria: [],
    nextAction: {
        kind: 'resolve_decision',
        label: 'Resolve the next key decision',
        detail: 'Choose whether guests require an account.',
        planningRecordId: 'record-1',
    },
    unresolvedCount: 3,
    openDecisionCount: 3,
    conflictCount: 0,
    assumptionCount: 1,
    changedSourceCount: 0,
    isReadyToBuild: false,
};

const attention: PlanningAttentionSummary = {
    readiness,
    totalCount: 3,
    hiddenCount: 1,
    primary: {
        key: 'record:record-1',
        condition: 'needs_decision',
        title: 'Should guests require an account?',
        why: 'Onboarding and persistence depend on this choice.',
        actionLabel: 'Make this decision',
        destination: { kind: 'planning_record', recordId: 'record-1' },
        materiality: 'high',
        dependencyCount: 2,
        actionableNow: true,
        sourceRefs: [{ kind: 'planning_record', id: 'record-1' }],
    },
    secondary: [],
};

describe('GlobalNextActionStrip', () => {
    it('opens the primary project action from a persistent accessible strip', () => {
        const onOpen = vi.fn();
        render(<GlobalNextActionStrip attention={attention} onOpen={onOpen} />);

        expect(screen.getByRole('region', { name: 'Project next action' }))
            .toBeInTheDocument();
        expect(screen.getByLabelText('3 open planning items'))
            .toHaveTextContent('3 open');
        expect(screen.getByText('Open items guide the next pass and do not block progress.'))
            .toBeInTheDocument();

        const action = screen.getByRole('button', { name: 'Make this decision' });
        expect(action).toHaveClass('min-h-11', 'w-full', 'sm:w-auto');
        fireEvent.click(action);
        expect(onOpen).toHaveBeenCalledWith(attention.primary);
    });

    it('uses a singular accessible count label', () => {
        render(<GlobalNextActionStrip
            attention={{ ...attention, totalCount: 1 }}
            onOpen={vi.fn()}
        />);

        expect(screen.getByLabelText('1 open planning item'))
            .toHaveTextContent('1 open');
    });

    it('renders nothing when there is no primary action', () => {
        const { container } = render(<GlobalNextActionStrip
            attention={{ ...attention, primary: undefined }}
            onOpen={vi.fn()}
        />);

        expect(container).toBeEmptyDOMElement();
    });
});
