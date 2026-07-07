import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { UpdateAssetsPlanModal, type UpdatePlanRow } from '../versions/UpdateAssetsPlanModal';

const rows: UpdatePlanRow[] = [
    {
        id: 'design_system',
        title: 'Design System',
        statusLabel: 'Needs update',
        isStale: true,
        changeHeadline: 'Since Version 1: 1 feature removed',
        likelyUnaffected: true,
        defaultChoice: 'update',
        canMarkCurrent: true,
    },
    {
        id: 'data_model',
        title: 'Data Model',
        statusLabel: 'Up to date',
        isStale: false,
        defaultChoice: 'skip',
        canMarkCurrent: false,
    },
    {
        id: 'mockup',
        title: 'Mockups',
        statusLabel: 'Needs update',
        isStale: true,
        removedFeatureNames: ['Team Chat'],
        defaultChoice: 'update',
        canMarkCurrent: true,
    },
];

const setup = () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
        <UpdateAssetsPlanModal
            prdLabel="Version 2"
            changeHeadline="1 feature removed · Architecture changed"
            baselineLabel="since Version 1"
            rows={rows}
            onConfirm={onConfirm}
            onCancel={onCancel}
        />,
    );
    return { onConfirm, onCancel };
};

describe('UpdateAssetsPlanModal', () => {
    it('shows the change summary, per-row detail, and removed-feature warnings', () => {
        setup();
        expect(screen.getByText(/Update assets for PRD Version 2/)).toBeTruthy();
        expect(screen.getByText(/1 feature removed · Architecture changed/)).toBeTruthy();
        expect(screen.getByText(/Since Version 1: 1 feature removed/)).toBeTruthy();
        expect(screen.getByText('Team Chat')).toBeTruthy();
    });

    it('confirms with the default choices (recommended rows regenerate)', () => {
        const { onConfirm } = setup();
        fireEvent.click(screen.getByText(/Finalize & regenerate 2/));
        expect(onConfirm).toHaveBeenCalledWith({
            design_system: 'update',
            data_model: 'skip',
            mockup: 'update',
        });
    });

    it('lets the user switch a row to mark-current and reflects it in the confirm payload', () => {
        const { onConfirm } = setup();
        // First row's "Mark up to date" segment.
        fireEvent.click(screen.getAllByText('Mark up to date')[0]);
        fireEvent.click(screen.getByText(/Finalize & regenerate 1 · keep 1/));
        expect(onConfirm).toHaveBeenCalledWith({
            design_system: 'mark_current',
            data_model: 'skip',
            mockup: 'update',
        });
    });

    it('disables mark-current where there is nothing to confirm and cancel aborts', () => {
        const { onCancel, onConfirm } = setup();
        const markButtons = screen.getAllByText('Mark up to date');
        // data_model row (index 1) cannot be marked current.
        expect((markButtons[1] as HTMLButtonElement).disabled).toBe(true);
        fireEvent.click(screen.getByText('Cancel'));
        expect(onCancel).toHaveBeenCalled();
        expect(onConfirm).not.toHaveBeenCalled();
    });
});
