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

const baseProps = {
    readiness,
    committed: false,
    onNextAction: vi.fn(),
    onReviewReadiness: vi.fn(),
    onOpenDecisions: vi.fn(),
    onOpenChallenge: vi.fn(),
};

describe('PlanningStateBar', () => {
    it('shows one dominant action and links secondary attention to its canonical target', () => {
        const onNextAction = vi.fn();
        const onOpenAttention = vi.fn();
        render(<PlanningStateBar
            {...baseProps}
            planSummary="A focused guest onboarding experience that preserves work without forcing early account creation."
            attention={attention}
            onNextAction={onNextAction}
            onOpenAttention={onOpenAttention}
        />);

        fireEvent.click(screen.getByRole('button', { name: /Make this decision/ }));
        expect(onNextAction).not.toHaveBeenCalled();
        expect(onOpenAttention).toHaveBeenCalledWith({ kind: 'planning_record', recordId: 'decision-1' });
        expect(screen.getByText(/A focused guest onboarding experience/)).toBeInTheDocument();
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

    it('presents a healthy fresh draft calmly, without counters of problems', () => {
        render(<PlanningStateBar {...baseProps} attention={attention} onOpenAttention={vi.fn()} />);

        expect(screen.getByText('Your draft is ready')).toBeInTheDocument();
        expect(screen.queryByText('Needs attention')).toBeNull();
        expect(screen.queryByText(/unresolved/)).toBeNull();
        expect(screen.queryByText('Uncertainty')).toBeNull();
        expect(screen.queryByText('No downstream review needed yet')).toBeNull();
        expect(screen.getByText('Start here')).toBeInTheDocument();
    });

    it('offers the guided sharpen flow as the dominant action when questions are answerable', () => {
        const onStartSharpen = vi.fn();
        render(<PlanningStateBar
            {...baseProps}
            attention={attention}
            onOpenAttention={vi.fn()}
            answerableCount={5}
            onStartSharpen={onStartSharpen}
        />);

        fireEvent.click(screen.getByRole('button', { name: /Sharpen my plan \(5 questions\)/ }));
        expect(onStartSharpen).toHaveBeenCalled();
    });

    it('uses singular sharpen copy for one open question', () => {
        render(<PlanningStateBar
            {...baseProps}
            attention={attention}
            onOpenAttention={vi.fn()}
            answerableCount={1}
            onStartSharpen={vi.fn()}
        />);
        expect(screen.getByRole('button', { name: /Answer 1 quick question/ })).toBeInTheDocument();
    });

    it('keeps the caution treatment and counts for a genuine conflict', () => {
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
            attention={{ ...attention, readiness: conflictReadiness }}
            onOpenAttention={vi.fn()}
            answerableCount={5}
            onStartSharpen={vi.fn()}
        />);

        expect(screen.getByText('Needs attention')).toBeInTheDocument();
        expect(screen.getByText('2 unresolved')).toBeInTheDocument();
        expect(screen.getByText('1 conflict')).toBeInTheDocument();
        expect(screen.getByText('Downstream review needs attention')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Sharpen my plan/ })).toBeNull();
        expect(screen.getByRole('button', { name: /Make this decision/ })).toBeInTheDocument();
    });
});
