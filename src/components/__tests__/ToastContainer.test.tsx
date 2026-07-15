import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { ToastContainer } from '../ToastContainer';
import { useToastStore, type Toast } from '../../store/toastStore';

const toast = (id: string, title: string): Toast => ({
    id,
    title,
    type: 'info',
    duration: 0,
});

beforeEach(() => {
    useToastStore.setState({ toasts: [] });
});

describe('ToastContainer responsive presentation', () => {
    it('keeps the latest toast visible on mobile while preserving the desktop stack', () => {
        useToastStore.setState({
            toasts: [
                toast('toast-1', 'First update'),
                toast('toast-2', 'Second update'),
                toast('toast-3', 'Latest update'),
            ],
        });

        const { container } = render(<ToastContainer />);
        const stack = container.firstElementChild;
        expect(stack).toHaveClass('left-4', 'right-4', 'w-auto', 'sm:left-auto', 'sm:max-w-sm');
        expect(screen.getByText('First update').closest('div.pointer-events-auto')).toHaveClass('hidden', 'sm:flex');
        expect(screen.getByText('Second update').closest('div.pointer-events-auto')).toHaveClass('hidden', 'sm:flex');
        expect(screen.getByText('Latest update').closest('div.pointer-events-auto')).toHaveClass('flex');
    });

    it('provides a labeled 44px dismiss target', () => {
        useToastStore.setState({ toasts: [toast('toast-1', 'Validation saved')] });
        render(<ToastContainer />);

        const dismiss = screen.getByRole('button', { name: 'Dismiss Validation saved' });
        expect(dismiss).toHaveClass('min-h-11', 'min-w-11');
        fireEvent.click(dismiss);
        expect(within(document.body).queryByText('Validation saved')).not.toBeInTheDocument();
    });
});
