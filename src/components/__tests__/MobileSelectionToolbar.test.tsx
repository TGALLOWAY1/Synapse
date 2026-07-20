import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MobileSelectionToolbar } from '../MobileSelectionToolbar';

function renderToolbar(
    overrides: Partial<React.ComponentProps<typeof MobileSelectionToolbar>> = {},
) {
    const props = {
        active: false,
        hasSelection: false,
        pendingText: null,
        onActivate: vi.fn(),
        onEdit: vi.fn(),
        onCancel: vi.fn(),
        ...overrides,
    };
    return { props, ...render(<MobileSelectionToolbar {...props} />) };
}

describe('MobileSelectionToolbar', () => {
    it('shows the entry button when inactive and activates on tap', () => {
        const { props } = renderToolbar({ active: false });

        const button = screen.getByRole('button', { name: 'Select text to edit' });
        expect(screen.queryByRole('toolbar')).toBeNull();
        // Idle pill is pinned (fixed) bottom-right so it stays visible while
        // scrolling; the band is non-interactive except the pill itself.
        expect(button.parentElement).toHaveClass('fixed');
        expect(button.parentElement).toHaveClass('justify-end');

        fireEvent.click(button);
        expect(props.onActivate).toHaveBeenCalledTimes(1);
    });

    it('shows the footer with hint when active and no selection yet', () => {
        renderToolbar({ active: true, hasSelection: false });

        expect(screen.getByRole('toolbar')).toBeInTheDocument();
        expect(screen.getByText('Select text, then tap Edit selection')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Edit selection' })).toBeDisabled();
    });

    it('echoes the tracked selection and enables Edit selection', () => {
        const { props } = renderToolbar({
            active: true,
            hasSelection: true,
            pendingText: 'provides',
        });

        expect(screen.getByText(/Selected:/)).toBeInTheDocument();
        expect(screen.getByText(/"provides"/)).toBeInTheDocument();

        const edit = screen.getByRole('button', { name: 'Edit selection' });
        expect(edit).toBeEnabled();
        fireEvent.click(edit);
        expect(props.onEdit).toHaveBeenCalledTimes(1);
    });

    it('cancels out of selection mode', () => {
        const { props } = renderToolbar({ active: true, hasSelection: true, pendingText: 'x' });

        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(props.onCancel).toHaveBeenCalledTimes(1);
    });
});
