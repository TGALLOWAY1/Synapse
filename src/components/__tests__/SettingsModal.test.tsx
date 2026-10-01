import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SettingsModal } from '../SettingsModal';

// The three sections below talk to /api (key vault, account linking) or read
// the stores; this suite is about the modal's own keyboard / naming contract.
vi.mock('../settings/ProviderKeysSection', () => ({ ProviderKeysSection: () => null }));
vi.mock('../settings/ConnectedAccountsSection', () => ({ ConnectedAccountsSection: () => null }));
vi.mock('../settings/ArtifactModelsSection', () => ({ ArtifactModelsSection: () => null }));

function renderModal() {
    const onClose = vi.fn();
    render(
        <MemoryRouter>
            <SettingsModal onClose={onClose} />
        </MemoryRouter>,
    );
    return { onClose };
}

describe('SettingsModal keyboard and screen-reader behavior', () => {
    it('closes on Escape', () => {
        const { onClose } = renderModal();

        fireEvent.keyDown(document.body, { key: 'Escape' });

        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('closes on Escape from inside a settings field', () => {
        const { onClose } = renderModal();
        // The Gemini billing project field lives in a collapsed disclosure.
        fireEvent.click(screen.getByRole('button', { name: /Gemini billing project/ }));
        const field = screen.getByPlaceholderText('e.g. my-gcp-project-123');

        fireEvent.keyDown(field, { key: 'Escape' });

        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('gives the icon-only close button an accessible name', () => {
        const { onClose } = renderModal();

        fireEvent.click(screen.getByRole('button', { name: 'Close settings' }));

        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('does not apply the settings when dismissed with Escape', () => {
        localStorage.removeItem('GEMINI_PROJECT_ID');
        renderModal();
        fireEvent.click(screen.getByRole('button', { name: /Gemini billing project/ }));
        const field = screen.getByPlaceholderText('e.g. my-gcp-project-123');
        fireEvent.change(field, { target: { value: 'unsaved-project' } });

        fireEvent.keyDown(field, { key: 'Escape' });

        // Same as Cancel: edits are discarded, only "Apply Changes" persists.
        expect(localStorage.getItem('GEMINI_PROJECT_ID')).toBeNull();
    });
});
