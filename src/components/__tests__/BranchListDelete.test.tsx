import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { BranchList } from '../BranchList';
import { useProjectStore } from '../../store/projectStore';

const PROJECT_ID = 'p1';
const SPINE_ID = 'spine1';

const branchCount = () => (useProjectStore.getState().branches[PROJECT_ID] ?? []).length;

beforeEach(() => {
    useProjectStore.setState({
        projects: { [PROJECT_ID]: { id: PROJECT_ID, name: 'Test', createdAt: 1 } },
        branches: {},
    });
    useProjectStore.getState().createBranch(PROJECT_ID, SPINE_ID, 'Some anchored sentence.', 'Clarify: what does this mean?');
});

function renderList() {
    return render(
        <BranchList projectId={PROJECT_ID} spineVersionId={SPINE_ID} onConsolidate={vi.fn()} />,
    );
}

describe('BranchList delete confirmation', () => {
    it('names the icon-only delete control', () => {
        renderList();

        expect(screen.getByRole('button', { name: 'Delete branch' })).toBeTruthy();
    });

    it('asks first and keeps the branch on Cancel', () => {
        const { container } = renderList();

        fireEvent.click(screen.getByRole('button', { name: 'Delete branch' }));

        const dialog = screen.getByRole('dialog');
        expect(within(dialog).getByText('Are you sure you want to delete this branch?')).toBeTruthy();
        // Portaled out of the branch rail so its backdrop covers the page.
        expect(container.querySelector('[role="dialog"]')).toBeNull();
        expect(branchCount()).toBe(1);

        fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

        expect(screen.queryByRole('dialog')).toBeNull();
        expect(branchCount()).toBe(1);
    });

    it('Escape cancels without deleting', () => {
        renderList();

        fireEvent.click(screen.getByRole('button', { name: 'Delete branch' }));
        fireEvent.keyDown(document.body, { key: 'Escape' });

        expect(screen.queryByRole('dialog')).toBeNull();
        expect(branchCount()).toBe(1);
    });

    it('deletes the branch only after the destructive confirm', () => {
        renderList();

        fireEvent.click(screen.getByRole('button', { name: 'Delete branch' }));
        const confirm = within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' });
        expect(confirm.className).toContain('bg-red-600');
        fireEvent.click(confirm);

        expect(screen.queryByRole('dialog')).toBeNull();
        expect(branchCount()).toBe(0);
    });
});
