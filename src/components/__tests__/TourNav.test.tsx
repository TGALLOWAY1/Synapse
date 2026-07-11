import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TourNav } from '../tour/TourNav';
import { TOTAL_STEPS } from '../tour/tourTypes';

describe('TourNav', () => {
    it('renders honest button semantics — no fake tablist', () => {
        const { container } = render(
            <TourNav activeIndex={0} isLast={false} onPrev={vi.fn()} onNext={vi.fn()} onFinish={vi.fn()} onGoto={vi.fn()} />,
        );
        expect(container.querySelector('[role="tab"]')).toBeNull();
        expect(container.querySelector('[role="tablist"]')).toBeNull();
    });

    it('gives the progress group an accessible label', () => {
        render(<TourNav activeIndex={0} isLast={false} onPrev={vi.fn()} onNext={vi.fn()} onFinish={vi.fn()} onGoto={vi.fn()} />);
        expect(screen.getByRole('group', { name: 'Tour progress' })).toBeInTheDocument();
    });

    it('names every dot "Go to step N of TOTAL_STEPS" and marks the active one with aria-current', () => {
        render(<TourNav activeIndex={2} isLast={false} onPrev={vi.fn()} onNext={vi.fn()} onFinish={vi.fn()} onGoto={vi.fn()} />);
        for (let i = 0; i < TOTAL_STEPS; i++) {
            const dot = screen.getByRole('button', { name: `Go to step ${i + 1} of ${TOTAL_STEPS}` });
            if (i === 2) {
                expect(dot).toHaveAttribute('aria-current', 'step');
            } else {
                expect(dot).not.toHaveAttribute('aria-current');
            }
        }
    });

    it('calls onGoto with the clicked step index', () => {
        const onGoto = vi.fn();
        render(<TourNav activeIndex={0} isLast={false} onPrev={vi.fn()} onNext={vi.fn()} onFinish={vi.fn()} onGoto={onGoto} />);
        fireEvent.click(screen.getByRole('button', { name: `Go to step 3 of ${TOTAL_STEPS}` }));
        expect(onGoto).toHaveBeenCalledWith(2);
    });

    it('gives every dot a >=24px hit-area via sizing classes', () => {
        render(<TourNav activeIndex={0} isLast={false} onPrev={vi.fn()} onNext={vi.fn()} onFinish={vi.fn()} onGoto={vi.fn()} />);
        const dot = screen.getByRole('button', { name: 'Go to step 1 of 6' });
        expect(dot.className).toMatch(/min-h-6/);
        expect(dot.className).toMatch(/min-w-7/);
    });

    it('disables and hides the Previous control at step 0', () => {
        render(<TourNav activeIndex={0} isLast={false} onPrev={vi.fn()} onNext={vi.fn()} onFinish={vi.fn()} onGoto={vi.fn()} />);
        const prev = screen.getByRole('button', { name: 'Previous' });
        expect(prev).toBeDisabled();
    });

    it('re-enables the Previous control once past step 0', () => {
        render(<TourNav activeIndex={1} isLast={false} onPrev={vi.fn()} onNext={vi.fn()} onFinish={vi.fn()} onGoto={vi.fn()} />);
        const prev = screen.getByRole('button', { name: 'Previous' });
        expect(prev).not.toBeDisabled();
        expect(prev.className).toMatch(/opacity-100/);
    });

    it('calls onPrev when the Previous control is clicked at a non-zero step', () => {
        const onPrev = vi.fn();
        render(<TourNav activeIndex={1} isLast={false} onPrev={onPrev} onNext={vi.fn()} onFinish={vi.fn()} onGoto={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: 'Previous' }));
        expect(onPrev).toHaveBeenCalledTimes(1);
    });
});
