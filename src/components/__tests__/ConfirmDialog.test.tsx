import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ConfirmDialog } from '../common/ConfirmDialog';

describe('ConfirmDialog', () => {
    it('renders the title, body, and button labels', () => {
        render(
            <ConfirmDialog
                title="Regenerate Mockup"
                cancelLabel="Cancel"
                confirmLabel="Regenerate"
                onCancel={vi.fn()}
                onConfirm={vi.fn()}
            >
                <p>Creates Version 2.</p>
            </ConfirmDialog>,
        );
        expect(screen.getByText('Regenerate Mockup')).toBeTruthy();
        expect(screen.getByText('Creates Version 2.')).toBeTruthy();
        expect(screen.getByText('Cancel')).toBeTruthy();
        expect(screen.getByText('Regenerate')).toBeTruthy();
    });

    it('fires onConfirm when the confirm button is clicked', () => {
        const onConfirm = vi.fn();
        render(
            <ConfirmDialog
                title="Update this artifact?"
                cancelLabel="Cancel"
                confirmLabel="Update"
                onCancel={vi.fn()}
                onConfirm={onConfirm}
            />,
        );
        fireEvent.click(screen.getByRole('button', { name: 'Update' }));
        expect(onConfirm).toHaveBeenCalledTimes(1);
    });

    it('fires onCancel when the cancel button is clicked', () => {
        const onCancel = vi.fn();
        render(
            <ConfirmDialog
                title="Update this artifact?"
                cancelLabel="Cancel"
                confirmLabel="Update"
                onCancel={onCancel}
                onConfirm={vi.fn()}
            />,
        );
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it('dismisses via backdrop click by default, but not when disabled', () => {
        const onCancel = vi.fn();
        const { rerender } = render(
            <ConfirmDialog
                title="Update this artifact?"
                cancelLabel="Cancel"
                confirmLabel="Update"
                onCancel={onCancel}
                onConfirm={vi.fn()}
            />,
        );
        fireEvent.click(screen.getByRole('presentation'));
        expect(onCancel).toHaveBeenCalledTimes(1);

        onCancel.mockClear();
        rerender(
            <ConfirmDialog
                title="Update this artifact?"
                cancelLabel="Cancel"
                confirmLabel="Update"
                onCancel={onCancel}
                onConfirm={vi.fn()}
                dismissOnBackdropClick={false}
            />,
        );
        expect(screen.queryByRole('presentation')).toBeNull();
    });

    it('applies the amber tone confirm-button styling', () => {
        render(
            <ConfirmDialog
                tone="amber"
                title="Generate anyway?"
                cancelLabel="Retry sections first"
                confirmLabel="Generate anyway"
                onCancel={vi.fn()}
                onConfirm={vi.fn()}
            />,
        );
        const confirmButton = screen.getByText('Generate anyway');
        expect(confirmButton.className).toContain('bg-amber-600');
    });

    it('uses the indigo confirm-button styling for the default tone', () => {
        render(
            <ConfirmDialog
                title="Update this artifact?"
                cancelLabel="Cancel"
                confirmLabel="Update"
                onCancel={vi.fn()}
                onConfirm={vi.fn()}
            />,
        );
        const confirmButton = screen.getByRole('button', { name: 'Update' });
        expect(confirmButton.className).toContain('bg-indigo-600');
    });
});
