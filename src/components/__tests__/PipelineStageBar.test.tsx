import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PipelineStageBar } from '../PipelineStageBar';

describe('PipelineStageBar review stage', () => {
    it('places Challenge before Build as soon as a working plan exists', () => {
        const onStageChange = vi.fn();
        render(<PipelineStageBar currentStage="prd" onStageChange={onStageChange} canExploreOutputs isReadyToBuild={false} />);

        const review = screen.getByRole('button', { name: /Challenge: Decisions and adversarial review/i });
        expect(review).not.toBeDisabled();
        fireEvent.click(review);
        expect(onStageChange).toHaveBeenCalledWith('review');
        expect(screen.getByRole('button', { name: /Explore: Explore or review downstream outputs/i })).not.toBeDisabled();
    });

    it('keeps Challenge and Build unavailable until a structured working plan exists', () => {
        render(<PipelineStageBar currentStage="prd" onStageChange={() => undefined} canExploreOutputs={false} isReadyToBuild={false} />);
        expect(screen.getByRole('button', { name: /Challenge: Decisions and adversarial review/i })).toBeDisabled();
        expect(screen.getByRole('button', { name: /Explore: Explore or review downstream outputs/i })).toBeDisabled();
    });

    it('labels the output stage from live readiness rather than commitment', () => {
        const { rerender } = render(
            <PipelineStageBar currentStage="workspace" onStageChange={() => undefined} canExploreOutputs isReadyToBuild={false} />,
        );
        expect(screen.getByRole('button', { name: /Explore: Explore or review downstream outputs/i })).toBeInTheDocument();

        rerender(<PipelineStageBar currentStage="workspace" onStageChange={() => undefined} canExploreOutputs isReadyToBuild />);
        expect(screen.getByRole('button', { name: /Build: Explore or review downstream outputs/i })).toBeInTheDocument();
    });
});
