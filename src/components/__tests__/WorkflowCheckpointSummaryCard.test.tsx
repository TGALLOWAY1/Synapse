import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { WorkflowCheckpointSummaryCard } from '../workflow/WorkflowCheckpointSummaryCard';
import type { WorkflowCheckpointSummary } from '../../lib/workflowCheckpointSummary';

const summary: WorkflowCheckpointSummary = {
    context: 'generation',
    headline: 'Generation complete — 1 item to review',
    supportingText: 'Review the combined notes below.',
    planningVerdict: { kind: 'working_plan', label: 'Working plan' },
    counts: {
        totalArtifacts: 1,
        readyArtifacts: 0,
        rowCount: 1,
        attentionSignals: 1,
        advisorySignals: 1,
    },
    rows: [{
        id: 'artifact:data',
        label: 'Data Model',
        severity: 'attention',
        destination: { kind: 'artifact', artifactId: 'data', nodeId: 'data_model' },
        signals: [
            {
                id: 'data:blocker',
                kind: 'blocking_validation',
                severity: 'attention',
                label: 'Validation issue',
                detail: 'No API surface',
            },
            {
                id: 'data:warning',
                kind: 'advisory_validation',
                severity: 'advisory',
                label: 'Validation note',
                detail: 'Review ownership',
            },
        ],
    }],
};

describe('WorkflowCheckpointSummaryCard', () => {
    it('renders combined signals and routes one review row without nested actions', () => {
        const onOpen = vi.fn();
        render(<WorkflowCheckpointSummaryCard summary={summary} onOpen={onOpen} />);

        expect(screen.getByRole('region', { name: 'Generation checkpoint' })).toBeTruthy();
        expect(screen.getByRole('region', { name: 'Generation checkpoint' }).textContent?.match(/Working plan/g)).toHaveLength(1);
        expect(screen.getByText('Validation issue')).toBeTruthy();
        expect(screen.getByText('Validation note')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Review Data Model' }));
        expect(onOpen).toHaveBeenCalledWith(summary.rows[0]);
    });

    it('dismisses from one accessible control', () => {
        const onDismiss = vi.fn();
        render(<WorkflowCheckpointSummaryCard summary={summary} onDismiss={onDismiss} />);
        fireEvent.click(screen.getByRole('button', { name: 'Dismiss checkpoint summary' }));
        expect(onDismiss).toHaveBeenCalledTimes(1);
    });

    it('shows accepted planning risks without describing them as passed validation', () => {
        render(
            <WorkflowCheckpointSummaryCard
                summary={{
                    ...summary,
                    planningVerdict: {
                        kind: 'finalized',
                        label: 'Proceeding with accepted risk',
                        acceptedRisks: ['Guest checkout remains deferred.'],
                        rationale: 'The first release can proceed without it.',
                        containment: 'Keep account creation reversible.',
                    },
                }}
            />,
        );

        expect(screen.getByText('Accepted planning risks')).toBeTruthy();
        expect(screen.getByText('Guest checkout remains deferred.')).toBeTruthy();
        expect(screen.getByText('The first release can proceed without it.')).toBeTruthy();
        expect(screen.getByText('Keep account creation reversible.')).toBeTruthy();
        expect(screen.queryByText(/passed validation/i)).toBeNull();
    });

    it('does not style an accepted-risk verdict as a clean checkpoint', () => {
        render(
            <WorkflowCheckpointSummaryCard
                summary={{
                    ...summary,
                    headline: 'Ready to export',
                    rows: [],
                    counts: {
                        totalArtifacts: 1,
                        readyArtifacts: 1,
                        rowCount: 0,
                        attentionSignals: 0,
                        advisorySignals: 0,
                    },
                    planningVerdict: {
                        kind: 'finalized',
                        label: 'Proceeding with accepted risk',
                        acceptedRisks: ['Guest checkout remains deferred.'],
                    },
                }}
            />,
        );

        expect(screen.getByRole('region', { name: 'Generation checkpoint' }).className)
            .toContain('border-amber-200');
    });
});
