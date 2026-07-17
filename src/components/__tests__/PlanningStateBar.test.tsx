import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { PlanningAttentionSummary, PlanningReadiness } from '../../lib/planning';
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
    conflictCount: 0,
    assumptionCount: 1,
    changedSourceCount: 0,
    isReadyToBuild: false,
};

const attention: PlanningAttentionSummary = {
    readiness,
    totalCount: 2,
    hiddenCount: 0,
    primary: {
        key: 'record:decision-1',
        condition: 'needs_decision',
        title: 'Should guests require an account?',
        why: 'Onboarding and persistence depend on this choice.',
        actionLabel: 'Make this decision',
        destination: { kind: 'planning_record', recordId: 'decision-1' },
        materiality: 'high',
        dependencyCount: 2,
        actionableNow: true,
        sourceRefs: [{ kind: 'planning_record', id: 'decision-1' }],
    },
    secondary: [{
        key: 'challenge:issue-1',
        condition: 'challenge_finding',
        title: 'Recovery conflicts with guest access',
        why: 'The recovery flow assumes an account exists.',
        actionLabel: 'Address challenge finding',
        destination: { kind: 'challenge', reviewId: 'review-1', issueId: 'issue-1' },
        materiality: 'high',
        dependencyCount: 1,
        actionableNow: true,
        sourceRefs: [{ kind: 'challenge', id: 'issue-1' }],
    }],
};

describe('PlanningStateBar', () => {
    it('shows one dominant action and links secondary attention to its canonical target', () => {
        const onNextAction = vi.fn();
        const onOpenAttention = vi.fn();
        render(<PlanningStateBar
            readiness={readiness}
            planSummary="A focused guest onboarding experience that preserves work without forcing early account creation."
            attention={attention}
            committed={false}
            onNextAction={onNextAction}
            onReviewReadiness={vi.fn()}
            onOpenDecisions={vi.fn()}
            onOpenChallenge={vi.fn()}
            onOpenAttention={onOpenAttention}
        />);

        fireEvent.click(screen.getByRole('button', { name: /Make this decision/ }));
        expect(onNextAction).toHaveBeenCalledTimes(1);
        expect(screen.getByText('2 unresolved · 1 assumption')).toBeInTheDocument();
        expect(screen.getByText(/A focused guest onboarding experience/)).toBeInTheDocument();
        expect(screen.getByText('Downstream review needs attention')).toBeInTheDocument();
        expect(screen.getByText('Should guests require an account?')).toBeInTheDocument();

        const planningTools = screen.getByText('Review details and planning tools').closest('details');
        expect(planningTools).not.toHaveAttribute('open');
        fireEvent.click(screen.getByText('Review details and planning tools'));
        expect(planningTools).toHaveAttribute('open');
        expect(screen.getByRole('button', { name: 'Open Decision Center' })).toBeInTheDocument();

        fireEvent.click(screen.getByText('Other items needing attention'));
        fireEvent.click(screen.getByRole('button', { name: /Recovery conflicts with guest access/ }));
        expect(onOpenAttention).toHaveBeenCalledWith({
            kind: 'challenge', reviewId: 'review-1', issueId: 'issue-1',
        });
    });
});
