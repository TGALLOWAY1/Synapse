import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PipelineStageBar } from '../PipelineStageBar';

describe('PipelineStageBar review stage', () => {
    it('exposes Review as a first-class stage after the PRD is finalized', () => {
        const onStageChange = vi.fn();
        render(<PipelineStageBar currentStage="prd" onStageChange={onStageChange} hasPRD />);

        const review = screen.getByRole('button', { name: /Review: Specialist review findings/i });
        expect(review).not.toBeDisabled();
        fireEvent.click(review);
        expect(onStageChange).toHaveBeenCalledWith('review');
    });

    it('keeps Review unavailable until a finalized PRD exists', () => {
        render(<PipelineStageBar currentStage="prd" onStageChange={() => undefined} hasPRD={false} />);
        expect(screen.getByRole('button', { name: /Review: Specialist review findings/i })).toBeDisabled();
    });
});
