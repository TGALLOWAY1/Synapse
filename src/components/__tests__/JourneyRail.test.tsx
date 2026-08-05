import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { JourneyRail } from '../JourneyRail';
import { deriveJourneyPresentation } from '../../lib/journeyPresentation';

describe('JourneyRail', () => {
    it('renders the four phases, with Plan sub-pills only while Plan is current', () => {
        render(
            <JourneyRail
                presentation={deriveJourneyPresentation({
                    currentStage: 'prd',
                    hasStructuredPlan: true,
                })}
                onStepChange={() => undefined}
            />,
        );

        // Top-level phase buttons (numbered) stay a four-chunk rail.
        const phaseButtons = screen.getAllByRole('button').filter(button =>
            /\d+ ·/.test(button.textContent ?? ''),
        );
        expect(phaseButtons.map(button => (
            button.textContent?.match(/Plan|Generate|Review|Build/)?.[0]
        ))).toEqual(['Plan', 'Generate', 'Review', 'Build']);
        expect(screen.queryByRole('button', { name: /History/i })).toBeNull();

        // Active step refine ⇒ Plan phase is current and its sub-pills render.
        const plan = phaseButtons[0];
        expect(plan).toHaveAttribute('aria-current', 'step');
        const substepList = screen.getByRole('list', { name: 'Plan sub-steps' });
        expect(substepList.textContent).toContain('Define');
        expect(substepList.textContent).toContain('Refine');
        expect(substepList.textContent).toContain('Finalize');
    });

    it('hides Plan sub-pills while another phase is current', () => {
        render(
            <JourneyRail
                presentation={deriveJourneyPresentation({
                    currentStage: 'workspace',
                    hasStructuredPlan: true,
                    outputsAvailable: true,
                })}
                onStepChange={() => undefined}
            />,
        );

        expect(screen.queryByRole('list', { name: 'Plan sub-steps' })).toBeNull();
    });

    it('keeps disabled phases inert and routes clicks to step identities', () => {
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
            && button.textContent?.includes('3 ·')
        ))!;
        expect(review).toBeDisabled();
        fireEvent.click(review);
        expect(onStepChange).not.toHaveBeenCalled();

        // With no structured plan, only define is enabled, so clicking the
        // Plan phase routes to the define step id.
        fireEvent.click(screen.getAllByRole('button').find(button => (
            button.textContent?.includes('Plan') && button.textContent?.includes('1 ·')
        ))!);
        expect(onStepChange).toHaveBeenCalledWith('define');
    });

    it('routes a Plan sub-pill click to its own step id', () => {
        const onStepChange = vi.fn();
        render(
            <JourneyRail
                presentation={deriveJourneyPresentation({
                    currentStage: 'prd',
                    hasStructuredPlan: true,
                })}
                onStepChange={onStepChange}
            />,
        );

        const substepList = screen.getByRole('list', { name: 'Plan sub-steps' });
        const finalize = Array.from(substepList.querySelectorAll('button'))
            .find(button => button.textContent?.includes('Finalize'))!;
        fireEvent.click(finalize);
        expect(onStepChange).toHaveBeenCalledWith('finalize');
    });
});
