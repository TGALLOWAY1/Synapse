import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { OutputSyncReviewQueueItem } from '../../lib/planning/outputSyncReviewQueue';
import { OutputSyncReviewQueue } from '../review/OutputSyncReviewQueue';

const item: OutputSyncReviewQueueItem = {
    proposalId: 'proposal',
    planId: 'plan',
    itemId: 'item',
    artifactId: 'screens',
    artifactTitle: 'Screen Inventory',
    region: {
        kind: 'screen',
        screenId: 'workspace',
        screenName: 'Workspace',
        aspect: 'state',
        aspectId: 'syncing',
        label: 'Syncing',
    },
    regionLabel: 'Workspace · Syncing',
    operation: 'remove',
    certainty: 'definite',
    sourceSummary: 'Storage became local only.',
    reasoning: 'The exact cloud-sync state now contradicts the current plan.',
    createdAt: 20,
};

describe('OutputSyncReviewQueue', () => {
    it('announces that proposals are unapplied and opens the exact plan item', () => {
        const onOpen = vi.fn();
        render(<OutputSyncReviewQueue items={[item]} onOpen={onOpen} />);

        expect(screen.getByRole('region', { name: 'Output updates ready to review' }))
            .toHaveTextContent('Nothing has been applied to your outputs.');
        expect(screen.getByText('Workspace · Syncing')).toBeInTheDocument();
        const open = screen.getByRole('button', {
            name: 'Review Screen Inventory: Workspace · Syncing',
        });
        expect(open).toHaveClass('min-h-11');
        fireEvent.click(open);
        expect(onOpen).toHaveBeenCalledWith({
            planId: 'plan',
            itemId: 'item',
            proposalId: 'proposal',
        });
    });

    it('renders no attention surface when the current queue is empty', () => {
        const { container } = render(<OutputSyncReviewQueue items={[]} onOpen={() => {}} />);
        expect(container).toBeEmptyDOMElement();
    });
});
