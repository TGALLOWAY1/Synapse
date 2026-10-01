import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ProjectDrawer } from '../ProjectDrawer';
import { useProjectStore } from '../../store/projectStore';
import { useAuthStore } from '../../store/authStore';

function renderDrawer(props: { isOpen: boolean; onClose?: () => void }) {
    const onClose = props.onClose ?? vi.fn();
    render(
        <MemoryRouter>
            <ProjectDrawer isOpen={props.isOpen} onClose={onClose} />
        </MemoryRouter>,
    );
    return { onClose };
}

beforeEach(() => {
    useAuthStore.setState({ user: null, loading: false, authError: null });
    useProjectStore.setState({
        projects: { p1: { id: 'p1', name: 'Acme', createdAt: 1 } },
    });
});

describe('ProjectDrawer keyboard and screen-reader behavior', () => {
    it('names its icon-only buttons', () => {
        renderDrawer({ isOpen: true });

        expect(screen.getByRole('button', { name: 'Close projects' })).toBeTruthy();
        // The per-project delete control says which project it deletes.
        expect(screen.getByRole('button', { name: 'Delete project Acme' })).toBeTruthy();
    });

    it('closes on Escape while open', () => {
        const { onClose } = renderDrawer({ isOpen: true });

        fireEvent.keyDown(document.body, { key: 'Escape' });

        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('ignores Escape while closed (the drawer stays mounted, off-screen)', () => {
        const { onClose } = renderDrawer({ isOpen: false });

        fireEvent.keyDown(document.body, { key: 'Escape' });

        expect(onClose).not.toHaveBeenCalled();
    });

    it('asks through a dialog before deleting; Escape cancels only the dialog, not the drawer', () => {
        const { onClose } = renderDrawer({ isOpen: true });

        fireEvent.click(screen.getByRole('button', { name: 'Delete project Acme' }));

        const dialog = screen.getByRole('dialog');
        expect(within(dialog).getByText('Delete "Acme"?')).toBeTruthy();
        // Nothing is deleted until the owner confirms.
        expect(useProjectStore.getState().projects.p1).toBeTruthy();

        fireEvent.keyDown(document.body, { key: 'Escape' });

        expect(screen.queryByRole('dialog')).toBeNull();
        expect(onClose).not.toHaveBeenCalled();
        expect(useProjectStore.getState().projects.p1).toBeTruthy();

        // With the dialog gone, the next Escape closes the drawer.
        fireEvent.keyDown(document.body, { key: 'Escape' });
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('deletes the project once the dialog is confirmed', () => {
        renderDrawer({ isOpen: true });

        fireEvent.click(screen.getByRole('button', { name: 'Delete project Acme' }));
        fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }));

        expect(screen.queryByRole('dialog')).toBeNull();
        expect(useProjectStore.getState().projects.p1).toBeUndefined();
    });

    it('does not open the project when the delete control is used (the row is itself clickable)', () => {
        const { onClose } = renderDrawer({ isOpen: true });

        fireEvent.click(screen.getByRole('button', { name: 'Delete project Acme' }));

        // The row's click handler navigates and then closes the drawer.
        expect(onClose).not.toHaveBeenCalled();
        expect(screen.getByRole('dialog')).toBeTruthy();
    });
});
