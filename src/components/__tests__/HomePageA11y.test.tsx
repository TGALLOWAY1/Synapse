import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { HomePage } from '../HomePage';
import { resetGalleryStatusForTests } from '../../lib/galleryStatus';
import { useAuthStore } from '../../store/authStore';

// Heavy / networked settings sections are irrelevant to the Home shell contract.
vi.mock('../settings/ProviderKeysSection', () => ({ ProviderKeysSection: () => null }));
vi.mock('../settings/ConnectedAccountsSection', () => ({ ConnectedAccountsSection: () => null }));
vi.mock('../settings/ArtifactModelsSection', () => ({ ArtifactModelsSection: () => null }));

beforeEach(() => {
    resetGalleryStatusForTests();
    useAuthStore.setState({ user: null, loading: false, authError: null });
    localStorage.clear();
    // The public gallery-mode probe is a plain fetch.
    vi.stubGlobal('fetch', vi.fn(async () => ({
        ok: true,
        json: async () => ({ mode: 'demo', size: 6, entries: [] }),
    })));
});

afterEach(() => {
    vi.unstubAllGlobals();
});

function renderHome() {
    render(
        <MemoryRouter>
            <HomePage />
        </MemoryRouter>,
    );
}

describe('HomePage accessibility shell', () => {
    it('exposes exactly one main landmark that holds the prompt form', () => {
        renderHome();

        const main = screen.getByRole('main');
        expect(screen.getAllByRole('main')).toHaveLength(1);
        expect(within(main).getByRole('textbox', { name: 'Describe the product you want to design' })).toBeTruthy();
    });

    it('labels the idea textarea and the project name field with real labels', () => {
        renderHome();

        const idea = screen.getByLabelText('Describe the product you want to design');
        expect(idea.tagName).toBe('TEXTAREA');
        const name = screen.getByLabelText('Project name');
        expect(name.tagName).toBe('INPUT');
    });

    it('names every icon-only header and toolbar button', () => {
        renderHome();

        for (const name of ['Settings', 'Projects', 'Attach a file']) {
            expect(screen.getByRole('button', { name })).toBeTruthy();
        }
    });

    it('opens Settings from the header and closes it with Escape', () => {
        renderHome();

        fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
        expect(screen.getByRole('heading', { name: 'Project Settings' })).toBeTruthy();

        fireEvent.keyDown(document.body, { key: 'Escape' });

        expect(screen.queryByRole('heading', { name: 'Project Settings' })).toBeNull();
    });
});
