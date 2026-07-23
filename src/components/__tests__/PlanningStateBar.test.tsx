import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { PlanningReadiness } from '../../lib/planning';
import { PlanningStateBar } from '../planning/PlanningStateBar';

const readiness: PlanningReadiness = {
    phase: 'needs_decisions',
    headline: 'Important choices need attention',
    summary: 'Resolve the consequential choices before treating the plan as settled.',
    criteria: [],
    nextAction: {
        kind: 'resolve_decision',
        label: 'Resolve the next key decision',
        detail: 'Choose whether guests require an account.',
        planningRecordId: 'decision-1',
    },
    unresolvedCount: 2,
    openDecisionCount: 2,
    conflictCount: 0,
    assumptionCount: 1,
    changedSourceCount: 0,
    isReadyToBuild: false,
};

const baseProps = {
    readiness,
    committed: false,
    onReviewReadiness: vi.fn(),
    onOpenDecisions: vi.fn(),
    onOpenChallenge: vi.fn(),
};

describe('PlanningStateBar', () => {
    it('keeps plan context and planning tools without echoing the global action', () => {
        render(<PlanningStateBar
            {...baseProps}
            planSummary="A focused guest onboarding experience that preserves work without forcing early account creation."
        />);

        expect(screen.getByText(/A focused guest onboarding experience/)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Make this decision/ })).toBeNull();
        expect(screen.queryByText('Start here')).toBeNull();
        expect(screen.queryByText(/Other items needing attention/)).toBeNull();

        const planningTools = screen.getByText(/Review details and planning tools/).closest('details');
        expect(planningTools).not.toHaveAttribute('open');
        fireEvent.click(screen.getByText(/Review details and planning tools/));
        expect(planningTools).toHaveAttribute('open');
        expect(screen.getByRole('button', { name: 'Open Decision Center' })).toBeInTheDocument();
    });

    it('presents a healthy fresh draft calmly, without counters of problems', () => {
        render(<PlanningStateBar {...baseProps} />);

        expect(screen.getByText('Your draft is ready')).toBeInTheDocument();
        expect(screen.queryByText('Needs attention')).toBeNull();
        expect(screen.queryByText(/unresolved/)).toBeNull();
        expect(screen.queryByText('Uncertainty')).toBeNull();
        expect(screen.queryByText('No downstream review needed yet')).toBeNull();
        expect(screen.queryByText('Start here')).toBeNull();
    });

    it('offers the guided sharpen flow as the dominant action when questions are answerable', () => {
        const onStartSharpen = vi.fn();
        render(<PlanningStateBar
            {...baseProps}
            answerableCount={5}
            onStartSharpen={onStartSharpen}
        />);

        fireEvent.click(screen.getByRole('button', { name: /Sharpen my plan \(5 questions\)/ }));
        expect(onStartSharpen).toHaveBeenCalled();
    });

    it('uses singular sharpen copy for one open question', () => {
        render(<PlanningStateBar
            {...baseProps}
            answerableCount={1}
            onStartSharpen={vi.fn()}
        />);
        expect(screen.getByRole('button', { name: /Answer 1 quick question/ })).toBeInTheDocument();
    });

    it('keeps conflict readiness and downstream alignment without global counts or actions', () => {
        const conflictReadiness: PlanningReadiness = {
            ...readiness,
            conflictCount: 1,
            criteria: [{
                id: 'alignment',
                label: 'Plan and outputs aligned',
                status: 'attention',
                explanation: 'One output needs review.',
            }],
        };
        render(<PlanningStateBar
            {...baseProps}
            readiness={conflictReadiness}
            answerableCount={5}
            onStartSharpen={vi.fn()}
        />);

        expect(screen.getByText('Needs attention')).toBeInTheDocument();
        expect(screen.queryByText('2 unresolved')).toBeNull();
        expect(screen.queryByText('1 conflict')).toBeNull();
        expect(screen.getByText('Downstream review needs attention')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Sharpen my plan/ })).toBeNull();
        expect(screen.queryByRole('button', { name: /Make this decision/ })).toBeNull();
        expect(screen.queryByText('Start here')).toBeNull();
    });
});
