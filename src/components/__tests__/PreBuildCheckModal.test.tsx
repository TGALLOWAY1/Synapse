import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PreBuildCheckModal, type PreBuildCheckItem } from '../planning/PreBuildCheckModal';

const items: PreBuildCheckItem[] = [
    { id: 'r1', title: 'Should guests start without an account?', type: 'decision' },
    { id: 'r2', title: 'Musicians will pay before finishing a song', type: 'assumption' },
];

const callbacks = () => ({
    onReviewFirst: vi.fn(),
    onGenerateAnyway: vi.fn(),
    onClose: vi.fn(),
});

describe('PreBuildCheckModal', () => {
    it('lists the open items and never blocks generation', () => {
        const props = callbacks();
        render(<PreBuildCheckModal items={items} {...props} />);

        expect(screen.getByRole('heading', { name: 'Quick check before you build' })).toBeInTheDocument();
        expect(screen.getByText(/2 open questions haven’t been answered yet/)).toBeInTheDocument();
        expect(screen.getByText('Should guests start without an account?')).toBeInTheDocument();
        expect(screen.getByText('Decision')).toBeInTheDocument();
        expect(screen.getByText('Assumption')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: /Generate anyway/ }));
        expect(props.onGenerateAnyway).toHaveBeenCalledTimes(1);
        expect(props.onReviewFirst).not.toHaveBeenCalled();
    });

    it('routes to a review of the decisions instead when asked', () => {
        const props = callbacks();
        render(<PreBuildCheckModal items={items} {...props} />);
        fireEvent.click(screen.getByRole('button', { name: 'Review decisions first' }));
        expect(props.onReviewFirst).toHaveBeenCalledTimes(1);
        expect(props.onGenerateAnyway).not.toHaveBeenCalled();
    });

    it('caps the visible list and counts the remainder', () => {
        const many = Array.from({ length: 8 }, (_, index): PreBuildCheckItem => ({
            id: `r${index}`, title: `Open question ${index}`, type: 'open_question',
        }));
        render(<PreBuildCheckModal items={many} {...callbacks()} />);
        expect(screen.getByText('+3 more in the Decision Center')).toBeInTheDocument();
    });
});
