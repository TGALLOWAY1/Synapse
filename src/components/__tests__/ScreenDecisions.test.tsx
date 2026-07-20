import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ScreenDecisions from '../tour/screens/ScreenDecisions';

// jsdom has no matchMedia — framer-motion probes it for reduced motion.
beforeEach(() => {
    vi.stubGlobal(
        'matchMedia',
        vi.fn().mockImplementation((query: string) => ({
            matches: false,
            media: query,
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            addListener: vi.fn(),
            removeListener: vi.fn(),
            dispatchEvent: vi.fn(),
        })),
    );
});

// reducedMotion skips the fake preview-generation delay, keeping the test sync.
const renderScreen = () => render(<ScreenDecisions isActive reducedMotion />);

describe('ScreenDecisions', () => {
    it('requires an explicit choice before the decision can be saved', () => {
        renderScreen();
        const save = screen.getByRole('button', { name: 'Save decision' });
        expect(save).toBeDisabled();
        // The recommendation is visible but never preselected.
        expect(screen.getByText(/Recommended/i)).toBeInTheDocument();
        expect(screen.getAllByRole('radio').every((r) => r.getAttribute('aria-checked') === 'false')).toBe(true);

        fireEvent.click(screen.getByRole('radio', { name: /Async comments on shared tracks/i }));
        expect(save).toBeEnabled();
    });

    it('walks verdict → impact preview → explicit apply', () => {
        renderScreen();
        fireEvent.click(screen.getByRole('radio', { name: /Async comments on shared tracks/i }));
        fireEvent.click(screen.getByRole('button', { name: 'Save decision' }));
        expect(screen.getAllByText(/Answer recorded/i).length).toBeGreaterThan(0);

        fireEvent.click(screen.getByRole('button', { name: 'Preview impact' }));
        expect(screen.getByText(/Plan alignment · Review changes/i)).toBeInTheDocument();

        // Nothing applies until at least one proposal is explicitly accepted.
        const apply = screen.getByRole('button', { name: 'Apply accepted changes' });
        expect(apply).toBeDisabled();
        fireEvent.click(screen.getAllByRole('button', { name: 'Accept' })[0]);
        expect(apply).toBeEnabled();
        fireEvent.click(apply);
        expect(screen.getByText(/Plan alignment · Change applied/i)).toBeInTheDocument();
        expect(screen.getByText(/version-safe write/i)).toBeInTheDocument();
    });

    it('lets an assumption be accepted for planning without pretending it was validated', () => {
        renderScreen();
        fireEvent.click(screen.getByRole('button', { name: /Musicians will pay before finishing/i }));
        fireEvent.click(screen.getByRole('button', { name: "Yes, that's right" }));
        expect(screen.getByText('Accepted for planning · not validated')).toBeInTheDocument();
    });
});
