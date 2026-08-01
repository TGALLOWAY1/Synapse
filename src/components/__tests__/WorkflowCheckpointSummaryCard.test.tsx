import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { WorkflowCheckpointSummaryCard } from '../workflow/WorkflowCheckpointSummaryCard';
import type { WorkflowCheckpointSummary } from '../../lib/workflowCheckpointSummary';

const summary: WorkflowCheckpointSummary = {
    context: 'generation',
    tone: 'attention',
    headline: 'Generation complete — 1 item to review',
    supportingText: 'Review the combined notes below.',
    detailsLabel: '1 item to review',
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

/** A run that finished successfully with a single advisory validation note. */
const advisorySummary: WorkflowCheckpointSummary = {
    ...summary,
    tone: 'advisory',
    headline: 'Generation complete — 7 of 7 outputs ready',
    supportingText: 'Nothing failed. One advisory note is available below.',
    detailsLabel: '1 note',
    counts: {
        totalArtifacts: 7,
        readyArtifacts: 7,
        rowCount: 1,
        attentionSignals: 0,
        advisorySignals: 1,
    },
    rows: [{
        id: 'artifact:inventory',
        label: 'Screen Inventory',
        severity: 'advisory',
        destination: { kind: 'artifact', artifactId: 'inventory', nodeId: 'screen_inventory' },
        signals: [{
            id: 'inventory:warning',
            kind: 'advisory_validation',
            severity: 'advisory',
            label: 'Validation note',
            detail: 'Two screens have no entry point',
        }],
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
                    tone: 'attention',
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

    it('renders a successful advisory-only run as success, compact, with notes collapsed', () => {
        render(<WorkflowCheckpointSummaryCard summary={advisorySummary} onOpen={vi.fn()} />);

        const region = screen.getByRole('region', { name: 'Generation checkpoint' });
        // Severity matches outcome: no caution chrome for a run that succeeded.
        expect(region.className).not.toContain('amber');
        expect(region.className).toContain('bg-white');
        // One line: the outcome plus the plan verdict. No expanded note cards.
        expect(screen.getByText('Generation complete — 7 of 7 outputs ready')).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Review Screen Inventory' })).toBeNull();
        const toggle = screen.getByRole('button', { name: /1 note/ });
        expect(toggle.getAttribute('aria-expanded')).toBe('false');
    });

    it('keeps advisory notes reachable behind the disclosure with Review intact', () => {
        const onOpen = vi.fn();
        render(<WorkflowCheckpointSummaryCard summary={advisorySummary} onOpen={onOpen} />);

        fireEvent.click(screen.getByRole('button', { name: /1 note/ }));
        expect(screen.getByRole('button', { name: /1 note/ }).getAttribute('aria-expanded')).toBe('true');
        expect(screen.getByText('Validation note')).toBeTruthy();
        expect(screen.getByText(/Two screens have no entry point/)).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Review Screen Inventory' }));
        expect(onOpen).toHaveBeenCalledWith(advisorySummary.rows[0]);
    });

    it('keeps a failed slot expanded and in warning chrome', () => {
        const failed: WorkflowCheckpointSummary = {
            ...summary,
            headline: 'Generation complete — 1 item to review',
            rows: [{
                id: 'artifact:flows',
                label: 'User Flows',
                severity: 'attention',
                destination: { kind: 'artifact', artifactId: 'flows', nodeId: 'user_flows' },
                signals: [{
                    id: 'flows:error',
                    kind: 'generation_failure',
                    severity: 'attention',
                    label: 'Generation failed',
                    detail: 'The model returned no content.',
                }],
            }],
        };
        render(<WorkflowCheckpointSummaryCard summary={failed} onOpen={vi.fn()} />);

        const region = screen.getByRole('region', { name: 'Generation checkpoint' });
        expect(region.className).toContain('border-amber-200');
        // The failure is visible without any interaction.
        expect(screen.getByText('Generation failed')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Review User Flows' })).toBeTruthy();
        expect(screen.getByRole('button', { name: /1 item to review/ }).getAttribute('aria-expanded'))
            .toBe('true');
    });
});
