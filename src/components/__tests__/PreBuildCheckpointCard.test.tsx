import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PreBuildCheckpointCard } from '../planning/PreBuildCheckpointCard';

const primaryItem = {
    id: 'record-1',
    title: 'Confirm guest checkout',
};

describe('PreBuildCheckpointCard', () => {
    it('is advisory, announces itself, and avoids repeating an aggregate planning count', async () => {
        render(
            <PreBuildCheckpointCard
                primaryItem={primaryItem}
                onGenerate={vi.fn()}
                onReview={vi.fn()}
                onCancel={vi.fn()}
            />,
        );

        const region = screen.getByRole('region', { name: /before generating/i });
        expect(region).toBeInTheDocument();
        await waitFor(() => expect(region).toHaveFocus());
        expect(screen.getByRole('status')).toHaveTextContent('Generation checkpoint opened');
        expect(screen.getByText(/generation can proceed/i)).toBeInTheDocument();
        expect(screen.queryByText(/1 open|1 unresolved/i)).not.toBeInTheDocument();
    });

    it('invokes each inline action', () => {
        const onGenerate = vi.fn();
        const onReview = vi.fn();
        const onCancel = vi.fn();
        render(
            <PreBuildCheckpointCard
                primaryItem={primaryItem}
                onGenerate={onGenerate}
                onReview={onReview}
                onCancel={onCancel}
            />,
        );

        fireEvent.click(screen.getByRole('button', { name: 'Review first' }));
        fireEvent.click(screen.getByRole('button', { name: 'Generate outputs' }));
        fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
        expect(onReview).toHaveBeenCalledOnce();
        expect(onGenerate).toHaveBeenCalledOnce();
        expect(onCancel).toHaveBeenCalledOnce();
    });
});
