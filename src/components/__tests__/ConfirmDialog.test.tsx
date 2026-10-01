import { useState } from 'react';
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

    it('applies the danger tone confirm-button styling', () => {
        render(
            <ConfirmDialog
                tone="danger"
                title='Delete "Acme"?'
                cancelLabel="Cancel"
                confirmLabel="Delete"
                onCancel={vi.fn()}
                onConfirm={vi.fn()}
            />,
        );
        const confirmButton = screen.getByRole('button', { name: 'Delete' });
        expect(confirmButton.className).toContain('bg-red-600');
        expect(confirmButton.className).not.toContain('bg-indigo-600');
    });

    it('cancels on Escape, even when backdrop dismissal is disabled', () => {
        const onCancel = vi.fn();
        const onConfirm = vi.fn();
        render(
            <ConfirmDialog
                title="Generate anyway?"
                cancelLabel="Go back"
                confirmLabel="Generate"
                dismissOnBackdropClick={false}
                onCancel={onCancel}
                onConfirm={onConfirm}
            />,
        );
        fireEvent.keyDown(document.body, { key: 'Escape' });
        expect(onCancel).toHaveBeenCalledTimes(1);
        expect(onConfirm).not.toHaveBeenCalled();
    });

    it('moves focus to Cancel on open and returns it to the opener on close', () => {
        function Harness() {
            const [open, setOpen] = useState(false);
            return (
                <>
                    <button type="button" onClick={() => setOpen(true)}>Delete project</button>
                    {open && (
                        <ConfirmDialog
                            title="Delete?"
                            cancelLabel="Cancel"
                            confirmLabel="Delete"
                            onCancel={() => setOpen(false)}
                            onConfirm={() => setOpen(false)}
                        />
                    )}
                </>
            );
        }
        render(<Harness />);
        const opener = screen.getByRole('button', { name: 'Delete project' });
        // fireEvent.click does not focus the button the way a real click does.
        opener.focus();
        fireEvent.click(opener);

        expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }));

        fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(document.activeElement).toBe(opener);
    });

    it('keeps Tab focus inside the dialog', () => {
        render(
            <ConfirmDialog
                title="Delete?"
                cancelLabel="Cancel"
                confirmLabel="Delete"
                onCancel={vi.fn()}
                onConfirm={vi.fn()}
            />,
        );
        const cancel = screen.getByRole('button', { name: 'Cancel' });
        const confirm = screen.getByRole('button', { name: 'Delete' });

        confirm.focus();
        fireEvent.keyDown(confirm, { key: 'Tab' });
        expect(document.activeElement).toBe(cancel);

        fireEvent.keyDown(cancel, { key: 'Tab', shiftKey: true });
        expect(document.activeElement).toBe(confirm);
    });

    it('renders in place by default and into document.body with portal', () => {
        const { container, unmount } = render(
            <ConfirmDialog
                title="In place"
                cancelLabel="Cancel"
                confirmLabel="OK"
                onCancel={vi.fn()}
                onConfirm={vi.fn()}
            />,
        );
        expect(container.querySelector('[role="dialog"]')).not.toBeNull();
        unmount();

        const portaled = render(
            <div data-testid="transformed-host">
                <ConfirmDialog
                    portal
                    title="Portaled"
                    cancelLabel="Cancel"
                    confirmLabel="OK"
                    onCancel={vi.fn()}
                    onConfirm={vi.fn()}
                />
            </div>,
        );
        expect(portaled.getByTestId('transformed-host').querySelector('[role="dialog"]')).toBeNull();
        expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
    });

    it('lets Escape dismiss only the topmost of two stacked dialogs', () => {
        const lower = vi.fn();
        const upper = vi.fn();
        const { rerender } = render(
            <ConfirmDialog title="Lower" cancelLabel="Cancel lower" confirmLabel="OK" onCancel={lower} onConfirm={vi.fn()} />,
        );
        rerender(
            <>
                <ConfirmDialog title="Lower" cancelLabel="Cancel lower" confirmLabel="OK" onCancel={lower} onConfirm={vi.fn()} />
                <ConfirmDialog title="Upper" cancelLabel="Cancel upper" confirmLabel="OK" onCancel={upper} onConfirm={vi.fn()} />
            </>,
        );
        fireEvent.keyDown(document.body, { key: 'Escape' });
        expect(upper).toHaveBeenCalledTimes(1);
        expect(lower).not.toHaveBeenCalled();
    });
});
