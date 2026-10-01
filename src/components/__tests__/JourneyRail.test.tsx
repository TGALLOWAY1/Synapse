import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { JourneyRail } from '../JourneyRail';
import { deriveJourneyPresentation } from '../../lib/journeyPresentation';

describe('JourneyRail', () => {
    it('renders Plan · Decide · Build in order with the current step marked', () => {
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
            button.textContent?.match(/Plan|Decide|Build/)?.[0]
        ))).toEqual(['Plan', 'Decide', 'Build']);
        const nav = screen.getByRole('navigation', { name: 'Product journey' });
        expect(nav.textContent).not.toMatch(/Finalize|History|Review readiness/);
        expect(screen.getByRole('button', { name: /Plan/ })).toHaveAttribute('aria-current', 'step');
        // No status captions — in particular no "Unavailable" state.
        expect(nav.textContent).not.toMatch(/unavailable|current step|complete/i);
    });

    it('shows the open-item count on Decide', () => {
        render(
            <JourneyRail
                presentation={deriveJourneyPresentation({
                    currentStage: 'prd',
                    hasStructuredPlan: true,
                    openItemCount: 3,
                })}
                onStepChange={() => undefined}
            />,
        );

        expect(screen.getByRole('button', { name: /Decide/ }).textContent).toContain('3 open items');
    });

    it('keeps inert steps disabled and emits enabled step identities', () => {
        const onStepChange = vi.fn();
        const { rerender } = render(
            <JourneyRail
                presentation={deriveJourneyPresentation({
                    currentStage: 'prd',
                    hasStructuredPlan: false,
                })}
                onStepChange={onStepChange}
            />,
        );

        const build = screen.getByRole('button', { name: /Build/ });
        expect(build).toBeDisabled();
        fireEvent.click(build);
        expect(onStepChange).not.toHaveBeenCalled();

        rerender(
            <JourneyRail
                presentation={deriveJourneyPresentation({
                    currentStage: 'prd',
                    hasStructuredPlan: true,
                })}
                onStepChange={onStepChange}
            />,
        );
        fireEvent.click(screen.getByRole('button', { name: /Decide/ }));
        expect(onStepChange).toHaveBeenCalledWith('decide');
        fireEvent.click(screen.getByRole('button', { name: /Build/ }));
        expect(onStepChange).toHaveBeenCalledWith('build');
    });
});
