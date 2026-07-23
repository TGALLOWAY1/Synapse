import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { JourneyRail } from '../JourneyRail';
import { deriveJourneyPresentation } from '../../lib/journeyPresentation';

describe('JourneyRail', () => {
    it('renders the six stable journey steps in order', () => {
        render(
            <JourneyRail
                presentation={deriveJourneyPresentation({
                    currentStage: 'prd',
                    hasStructuredPlan: true,
                })}
                onStepChange={() => undefined}
            />,
        );

        expect(screen.getAllByRole('button').map(button => (
            button.textContent?.match(/Define|Refine|Finalize|Generate|Review|Build/)?.[0]
        ))).toEqual(['Define', 'Refine', 'Finalize', 'Generate', 'Review', 'Build']);
        expect(screen.queryByRole('button', { name: /History/i })).toBeNull();
        expect(screen.getByRole('button', { name: /Refine/i })).toHaveAttribute(
            'aria-current',
            'step',
        );
    });

    it('keeps disabled steps inert and emits enabled step identities', () => {
        const onStepChange = vi.fn();
        render(
            <JourneyRail
                presentation={deriveJourneyPresentation({
                    currentStage: 'prd',
                    hasStructuredPlan: false,
                })}
                onStepChange={onStepChange}
            />,
        );

        const review = screen.getAllByRole('button').find(button => (
            button.textContent?.includes('Review')
            && button.textContent?.includes('5 ·')
        ))!;
        expect(review).toBeDisabled();
        fireEvent.click(review);
        expect(onStepChange).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: /Define/i }));
        expect(onStepChange).toHaveBeenCalledWith('define');
    });
});
