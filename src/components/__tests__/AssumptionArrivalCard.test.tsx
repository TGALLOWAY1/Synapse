import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { PlanningRecord } from '../../types';
import { deriveAssumptionArrival } from '../../lib/planning';
import { AssumptionArrivalCard } from '../planning/AssumptionArrivalCard';

const assumption = (
    id: string,
    statement: string,
    materiality: NonNullable<PlanningRecord['materiality']>,
): PlanningRecord => ({
    id,
    projectId: 'p1',
    type: 'assumption',
    status: 'open',
    title: statement,
    statement,
    evidence: [],
    sourceFindingIds: [],
    createdBy: 'user',
    createdAt: 1,
    updatedAt: 1,
    materiality,
});

const records = [
    assumption('historical', 'Historical assumption', 'blocking'),
    assumption('normal', 'Normal assumption', 'normal'),
    assumption('blocking', 'Blocking assumption', 'blocking'),
    assumption('high', 'High assumption', 'high'),
];

const summary = deriveAssumptionArrival(
    records,
    ['normal', 'blocking', 'high'],
)!;

describe('AssumptionArrivalCard', () => {
    it('shows two material highlights and emits only exact pending ids', () => {
        const accept = vi.fn();
        const review = vi.fn();
        const later = vi.fn();
        render(
            <AssumptionArrivalCard
                summary={summary}
                onAcceptDefaults={accept}
                onReviewEach={review}
                onLater={later}
            />,
        );

        expect(screen.getByText('Blocking assumption')).toBeInTheDocument();
        expect(screen.getByText('High assumption')).toBeInTheDocument();
        expect(screen.queryByText('Historical assumption')).toBeNull();
        expect(screen.getByText('1 blocking · 1 high impact · 1 normal')).toBeInTheDocument();
        const acceptButton = screen.getByRole('button', {
            name: 'Accept defaults for 3 imported assumptions',
        });
        expect(acceptButton).toHaveClass('min-h-11');
        fireEvent.click(acceptButton);
        fireEvent.click(screen.getByRole('button', {
            name: 'Review each of 3 imported assumptions',
        }));
        fireEvent.click(screen.getByRole('button', {
            name: 'Review 3 imported assumptions later',
        }));
        expect(accept).toHaveBeenCalledWith(['normal', 'blocking', 'high']);
        expect(review).toHaveBeenCalledWith(['normal', 'blocking', 'high']);
        expect(later).toHaveBeenCalledWith(['normal', 'blocking', 'high']);
    });

    it('announces partial results, disables busy controls, and hides read-only mutation', () => {
        const props = {
            summary,
            onAcceptDefaults: vi.fn(),
            onReviewEach: vi.fn(),
            onLater: vi.fn(),
        };
        const { rerender } = render(
            <AssumptionArrivalCard
                {...props}
                batchResult={{
                    succeeded: ['normal'],
                    skipped: [{ recordId: 'blocking', reason: 'Changed' }],
                    failed: [{ recordId: 'high', reason: 'Unavailable' }],
                }}
            />,
        );
        const status = screen.getByRole('status', {
            name: 'Assumption batch result',
        });
        expect(status).toHaveAttribute('aria-live', 'polite');
        expect(status).toHaveTextContent('1 recorded · 1 skipped · 1 failed');

        rerender(<AssumptionArrivalCard {...props} busy />);
        screen.getAllByRole('button').forEach(button => {
            expect(button).toBeDisabled();
        });

        rerender(<AssumptionArrivalCard {...props} readOnly />);
        expect(screen.queryByRole('region', { name: 'New assumptions' })).toBeNull();
    });
});
