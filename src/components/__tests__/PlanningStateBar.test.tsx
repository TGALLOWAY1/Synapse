import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { BuildPacketReadiness, PlanningReadiness } from '../../lib/planning';
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
    it('keeps plan context and surfaces the ordered planning tools', () => {
        render(<PlanningStateBar
            {...baseProps}
            planSummary="A focused guest onboarding experience that preserves work without forcing early account creation."
        />);

        expect(screen.getByText(/A focused guest onboarding experience/)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Make this decision/ })).toBeNull();
        expect(screen.queryByText(/Other items needing attention/)).toBeNull();

        // The three planning tools are always visible (not buried in the
        // collapsed readiness-checks disclosure) and carry a when-to-use cue.
        expect(screen.getByRole('button', { name: /Decision Center/ })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Challenge this plan/ })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Review readiness/ })).toBeInTheDocument();
        expect(screen.getByText('Start here')).toBeInTheDocument();

        // The 7-check breakdown stays behind a collapsed disclosure.
        const checks = screen.getByText(/Product-reasoning checks/).closest('details');
        expect(checks).not.toHaveAttribute('open');
    });

    it('routes each planning tool to its own handler', () => {
        const onReviewReadiness = vi.fn();
        const onOpenDecisions = vi.fn();
        const onOpenChallenge = vi.fn();
        render(<PlanningStateBar
            {...baseProps}
            onReviewReadiness={onReviewReadiness}
            onOpenDecisions={onOpenDecisions}
            onOpenChallenge={onOpenChallenge}
        />);

        fireEvent.click(screen.getByRole('button', { name: /Decision Center/ }));
        fireEvent.click(screen.getByRole('button', { name: /Challenge this plan/ }));
        fireEvent.click(screen.getByRole('button', { name: /Review readiness/ }));
        expect(onOpenDecisions).toHaveBeenCalledTimes(1);
        expect(onOpenChallenge).toHaveBeenCalledTimes(1);
        expect(onReviewReadiness).toHaveBeenCalledTimes(1);
    });

    it('links the scope check to the Features view when scope is unconfirmed', () => {
        const onOpenFeatures = vi.fn();
        render(<PlanningStateBar
            {...baseProps}
            readiness={{
                ...readiness,
                criteria: [{
                    id: 'scope',
                    label: 'Feature scope confirmed',
                    status: 'attention',
                    explanation: 'The generated first-release feature set is still a proposal.',
                }],
            }}
            onOpenFeatures={onOpenFeatures}
        />);

        fireEvent.click(screen.getByText(/Product-reasoning checks/));
        fireEvent.click(screen.getByRole('button', { name: /Confirm features/ }));
        expect(onOpenFeatures).toHaveBeenCalledTimes(1);
    });

    it('presents a healthy fresh draft calmly, without counters of problems', () => {
        render(<PlanningStateBar {...baseProps} />);

        expect(screen.getByText('Your draft is ready')).toBeInTheDocument();
        expect(screen.queryByText('Needs attention')).toBeNull();
        expect(screen.queryByText(/unresolved/)).toBeNull();
        expect(screen.queryByText('Uncertainty')).toBeNull();
        expect(screen.queryByText('No downstream review needed yet')).toBeNull();
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
    });
});

// The build-packet state (plan §W6) is a SECOND, separate readiness state. These
// tests hold the line that the two are shown side by side and never conflated.
const buildPacket = (overrides: Partial<BuildPacketReadiness> = {}): BuildPacketReadiness => ({
    isPacketComplete: false,
    status: 'incomplete',
    headline: 'Implementation packet incomplete',
    summary: '2 blockers must be resolved before this packet can be handed to a build.',
    criteria: [
        {
            id: 'sources_current',
            label: 'Packet inputs current',
            status: 'attention',
            blocking: true,
            explanation: '1 output is stale or built on an input that is not sound.',
            evidence: [],
            actionTarget: { kind: 'artifact_slot', nodeId: 'data_model' },
            blockerIds: ['blocker-1'],
            warningIds: [],
        },
        {
            id: 'reasoning_committed',
            label: 'Product reasoning committed',
            status: 'not_started',
            blocking: true,
            explanation: 'The reasoning behind this packet is not backed by a current committed readiness review.',
            evidence: [],
            actionTarget: { kind: 'readiness_commitment' },
            blockerIds: ['blocker-2'],
            warningIds: [],
        },
        {
            id: 'validation_clear',
            label: 'Output validation clear',
            status: 'met',
            blocking: false,
            explanation: 'No output carries an unresolved blocking validation issue.',
            evidence: [],
            actionTarget: { kind: 'artifact_slot', nodeId: 'data_model' },
            blockerIds: [],
            warningIds: [],
        },
    ],
    blockers: [
        {
            id: 'blocker-1',
            criterionId: 'sources_current',
            title: 'Data Model is out of date',
            consequence: 'The packet would be built from an output that no longer matches its inputs.',
            remedy: 'Regenerate Data Model.',
            evidenceQuality: 'direct',
            actionTarget: { kind: 'artifact_slot', nodeId: 'data_model' },
        },
        {
            id: 'blocker-2',
            criterionId: 'reasoning_committed',
            title: 'The product reasoning has not been committed',
            consequence: 'The packet would be built on reasoning nobody has approved.',
            remedy: 'Commit the plan from Review readiness.',
            evidenceQuality: 'incomplete',
            actionTarget: { kind: 'readiness_commitment' },
        },
    ],
    warnings: [],
    evaluatedAt: 1,
    ...overrides,
});

describe('PlanningStateBar — build-packet state', () => {
    it('renders nothing about the packet until one exists', () => {
        render(<PlanningStateBar {...baseProps} />);

        expect(screen.queryByText('Implementation packet')).toBeNull();
        expect(screen.queryByText(/Packet checks/)).toBeNull();
    });

    it('shows the packet state separately from the product-reasoning checks', () => {
        render(<PlanningStateBar {...baseProps} buildPacket={buildPacket()} />);

        expect(screen.getByText('Implementation packet')).toBeInTheDocument();
        expect(screen.getByText('Implementation packet incomplete')).toBeInTheDocument();
        expect(screen.getByText('2 blockers')).toBeInTheDocument();
        // Two independent disclosures, one per readiness question.
        expect(screen.getByText(/Packet checks/)).toBeInTheDocument();
        expect(screen.getByText(/Product-reasoning checks/)).toBeInTheDocument();
        expect(screen.getByText(/whether the product\s+reasoning is sound/)).toBeInTheDocument();
    });

    it('counts packet criteria by blocking state, not by planning readiness', () => {
        render(<PlanningStateBar {...baseProps} buildPacket={buildPacket()} />);

        expect(screen.getByText('(1/3 passing)')).toBeInTheDocument();
        fireEvent.click(screen.getByText(/Packet checks/));
        expect(screen.getByText('Packet inputs current')).toBeInTheDocument();
        expect(screen.getByText('Product reasoning committed')).toBeInTheDocument();
    });

    it('lists non-blocking warnings as recorded rather than blocking', () => {
        render(<PlanningStateBar
            {...baseProps}
            buildPacket={buildPacket({
                isPacketComplete: true,
                status: 'complete',
                headline: 'Implementation packet complete',
                blockers: [],
                criteria: buildPacket().criteria.map(item => ({ ...item, blocking: false, blockerIds: [] })),
                warnings: [{
                    id: 'warning-1',
                    criterionId: 'sources_current',
                    title: 'Data Model carries manual edits',
                    owner: 'user',
                    impact: 'A regeneration appends a new version rather than overwriting this one.',
                    rationale: 'User authorship is preserved, not overridden.',
                    actionTarget: { kind: 'artifact_slot', nodeId: 'data_model' },
                }],
            })}
        />);

        expect(screen.queryByText(/blockers$/)).toBeNull();
        fireEvent.click(screen.getByText(/Packet checks/));
        expect(screen.getByText('Recorded, not blocking')).toBeInTheDocument();
        expect(screen.getByText(/Data Model carries manual edits/)).toBeInTheDocument();
    });
});
