import { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { UpdateAssetsPlanModal, type UpdatePlanRow } from '../versions/UpdateAssetsPlanModal';

const rows: UpdatePlanRow[] = [
    {
        id: 'design_system',
        artifactId: 'design-system',
        title: 'Design System',
        statusLabel: 'Needs update',
        needsSync: true,
        isDrifted: true,
        changeHeadline: 'Since Version 1: 1 feature removed',
        likelyUnaffected: true,
        manuallyEdited: true,
        defaultChoice: 'update',
        canMarkCurrent: true,
        carefulSupported: false,
    },
    {
        id: 'data_model',
        artifactId: 'data-model',
        title: 'Data Model',
        statusLabel: 'Up to date',
        needsSync: false,
        isDrifted: false,
        defaultChoice: 'skip',
        canMarkCurrent: false,
        carefulSupported: true,
    },
    {
        id: 'mockup',
        artifactId: 'mockup',
        title: 'Mockups',
        statusLabel: 'Needs update',
        needsSync: true,
        isDrifted: true,
        defaultChoice: 'update',
        canMarkCurrent: true,
        carefulSupported: false,
    },
    {
        id: 'screen_inventory',
        artifactId: 'screens',
        title: 'Screen Inventory',
        statusLabel: 'Needs update',
        needsSync: true,
        isDrifted: true,
        defaultChoice: 'update',
        canMarkCurrent: true,
        carefulSupported: true,
        carefulPlanId: 'screen-plan',
        carefulItemCount: 2,
    },
];

const setup = (props: { quickDisabled?: boolean; regenerationDisabledReason?: string } = {}) => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const onOpenCareful = vi.fn();
    render(
        <UpdateAssetsPlanModal
            prdLabel="Version 2"
            changeHeadline="1 feature removed · Architecture changed"
            rows={rows}
            onConfirm={onConfirm}
            onOpenCareful={onOpenCareful}
            onCancel={onCancel}
            {...props}
        />,
    );
    return { onConfirm, onCancel, onOpenCareful };
};

describe('UpdateAssetsPlanModal', () => {
    it('shows the change summary, per-row detail, and removed-feature warnings', () => {
        setup();
        expect(screen.getByText(/Sync outputs with PRD Version 2/)).toBeTruthy();
        expect(screen.getByText(/1 feature removed · Architecture changed/)).toBeTruthy();
        expect(screen.getByText(/Since Version 1: 1 feature removed/)).toBeTruthy();
        expect(screen.getByText(/includes manual edits/)).toBeTruthy();
    });

    it('confirms with the default choices (recommended rows regenerate)', () => {
        const { onConfirm } = setup();
        fireEvent.click(screen.getByText(/^Sync 3$/));
        expect(onConfirm).toHaveBeenCalledWith({
            design_system: 'update',
            data_model: 'skip',
            mockup: 'update',
            screen_inventory: 'update',
        });
    });

    it('lets the user switch a row to mark-current and reflects it in the confirm payload', () => {
        const { onConfirm } = setup();
        fireEvent.click(screen.getAllByRole('radio', { name: 'Mark up to date' })[0]);
        fireEvent.click(screen.getByText(/Sync 2 · keep 1 current/));
        expect(onConfirm).toHaveBeenCalledWith({
            design_system: 'mark_current',
            data_model: 'skip',
            mockup: 'update',
            screen_inventory: 'update',
        });
    });

    it('disables mark-current where there is nothing to confirm and cancel aborts', () => {
        const { onCancel, onConfirm } = setup();
        const markButtons = screen.getAllByRole('radio', { name: 'Mark up to date' });
        // data_model row (index 1) cannot be marked current.
        expect(markButtons[1]).toBeDisabled();
        fireEvent.click(screen.getByText('Cancel'));
        expect(onCancel).toHaveBeenCalled();
        expect(onConfirm).not.toHaveBeenCalled();
    });

    it('opens an existing Careful plan and explains unsupported output types', () => {
        const { onOpenCareful } = setup();
        fireEvent.click(screen.getByText('Careful sync · review region by region'));
        expect(screen.getByText((_, element) => (
            element?.tagName === 'P'
            && element.textContent?.includes('not available for Design System or Mockups') === true
        ))).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Review regions' }));
        expect(onOpenCareful).toHaveBeenCalledWith('screen-plan');
    });

    it('disables Quick regeneration while a job is active or a hard prerequisite is missing', () => {
        const { rerender } = render(
            <UpdateAssetsPlanModal
                prdLabel="Version 2"
                rows={rows}
                onConfirm={() => {}}
                onCancel={() => {}}
                quickDisabled
            />,
        );
        expect(screen.getByRole('button', { name: /^Sync 3$/ })).toBeDisabled();
        expect(screen.getByText(/generation job is active/)).toBeInTheDocument();

        rerender(
            <UpdateAssetsPlanModal
                prdLabel="Version 2"
                rows={rows}
                onConfirm={() => {}}
                onCancel={() => {}}
                regenerationDisabledReason="Choose a design direction before regenerating outputs."
            />,
        );
        expect(screen.getByRole('button', { name: /^Sync 3$/ })).toBeDisabled();
        expect(screen.getByText(/Choose a design direction/)).toBeInTheDocument();
    });

    it('exposes one labeled radio group per output', () => {
        setup();
        const group = screen.getByRole('group', { name: 'Sync action for Design System' });
        expect(within(group).getAllByRole('radio')).toHaveLength(3);
        expect(within(group).getByRole('radio', { name: 'Regenerate' })).toBeChecked();
        fireEvent.click(within(group).getByRole('radio', { name: 'Decide later' }));
        expect(within(group).getByRole('radio', { name: 'Decide later' })).toBeChecked();
    });

    it('clearly defers an unsafe dependent mark-current choice', () => {
        render(
            <UpdateAssetsPlanModal
                prdLabel="Version 2"
                rows={rows}
                onConfirm={() => {}}
                onCancel={() => {}}
                previewExecution={(choices) => ({
                    markCurrent: [],
                    regenerate: choices.mockup === 'mark_current'
                        ? ['design_system']
                        : ['design_system', 'mockup', 'screen_inventory'],
                    deferredMarkCurrent: choices.mockup === 'mark_current' ? ['mockup'] : [],
                })}
            />,
        );
        fireEvent.click(screen.getAllByRole('radio', { name: 'Mark up to date' })[2]);

        expect(screen.getByRole('status')).toHaveTextContent(
            'Mockups cannot be marked current while an upstream is regenerated or remains unresolved.',
        );
        expect(screen.getByRole('button', { name: /^Sync 2$/ })).toBeInTheDocument();
    });

    it('focuses the dialog, traps Tab, closes on Escape, and restores trigger focus', () => {
        function Harness() {
            const [open, setOpen] = useState(false);
            return (
                <>
                    <button type="button" onClick={() => setOpen(true)}>Open sync</button>
                    {open && (
                        <UpdateAssetsPlanModal
                            prdLabel="Version 2"
                            rows={rows}
                            onConfirm={() => {}}
                            onCancel={() => setOpen(false)}
                        />
                    )}
                </>
            );
        }
        render(<Harness />);
        const trigger = screen.getByRole('button', { name: 'Open sync' });
        trigger.focus();
        fireEvent.click(trigger);

        const close = screen.getByRole('button', { name: 'Cancel output sync' });
        const confirm = screen.getByRole('button', { name: /^Sync 3$/ });
        expect(close).toHaveFocus();

        fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
        expect(confirm).toHaveFocus();
        fireEvent.keyDown(document, { key: 'Tab' });
        expect(close).toHaveFocus();

        fireEvent.keyDown(document, { key: 'Escape' });
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(trigger).toHaveFocus();
    });
});
