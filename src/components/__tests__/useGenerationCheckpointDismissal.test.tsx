import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useGenerationCheckpointDismissal } from '../../hooks/useGenerationCheckpointDismissal';
import { clearDismissedGenerationCheckpoints } from '../../lib/generationCheckpointDismissal';
import { WorkflowCheckpointSummaryCard } from '../workflow/WorkflowCheckpointSummaryCard';
import type { WorkflowCheckpointSummary } from '../../lib/workflowCheckpointSummary';

const summary: WorkflowCheckpointSummary = {
    context: 'generation',
    tone: 'advisory',
    headline: 'Generation complete — 7 of 7 outputs ready',
    supportingText: 'Nothing failed.',
    detailsLabel: '1 note',
    planningVerdict: { kind: 'working_plan', label: 'Working plan' },
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

/** Mirrors how ProjectWorkspace gates and dismisses the checkpoint banner. */
function Harness({ projectId, jobKey }: { projectId: string; jobKey: string }) {
    const dismissal = useGenerationCheckpointDismissal(projectId);
    if (dismissal.isDismissed(jobKey)) return <p>no checkpoint</p>;
    return (
        <WorkflowCheckpointSummaryCard
            summary={summary}
            onDismiss={() => dismissal.dismiss(jobKey)}
        />
    );
}

describe('useGenerationCheckpointDismissal', () => {
    beforeEach(() => {
        clearDismissedGenerationCheckpoints();
    });

    it('keeps a dismissed checkpoint dismissed across a remount', () => {
        const first = render(<Harness projectId="project-a" jobKey="spine-1:100" />);
        expect(screen.getByRole('region', { name: 'Generation checkpoint' })).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'Dismiss checkpoint summary' }));
        expect(screen.queryByRole('region', { name: 'Generation checkpoint' })).toBeNull();
        first.unmount();

        render(<Harness projectId="project-a" jobKey="spine-1:100" />);
        expect(screen.queryByRole('region', { name: 'Generation checkpoint' })).toBeNull();
        expect(screen.getByText('no checkpoint')).toBeTruthy();
    });

    it('still shows the checkpoint for a new generation run', () => {
        const first = render(<Harness projectId="project-a" jobKey="spine-1:100" />);
        fireEvent.click(screen.getByRole('button', { name: 'Dismiss checkpoint summary' }));
        first.unmount();

        render(<Harness projectId="project-a" jobKey="spine-1:200" />);
        expect(screen.getByRole('region', { name: 'Generation checkpoint' })).toBeTruthy();
    });

    it('does not leak a dismissal to another project', () => {
        const first = render(<Harness projectId="project-a" jobKey="spine-1:100" />);
        fireEvent.click(screen.getByRole('button', { name: 'Dismiss checkpoint summary' }));
        first.unmount();

        render(<Harness projectId="project-b" jobKey="spine-1:100" />);
        expect(screen.getByRole('region', { name: 'Generation checkpoint' })).toBeTruthy();
    });
});
