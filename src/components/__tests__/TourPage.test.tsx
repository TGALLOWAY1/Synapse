import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { TourPage } from '../tour/TourPage';
import { TOUR_COMPLETED_KEY } from '../../lib/tourPersistence';

// jsdom has no matchMedia — provide a non-matching stub so useIsMobile /
// usePrefersReducedMotion resolve to false.
beforeEach(() => {
    localStorage.clear();
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

const renderTour = () =>
    render(
        <MemoryRouter>
            <TourPage />
        </MemoryRouter>,
    );

describe('TourPage', () => {
    it('starts a first-timer in guided mode at step 1', () => {
        renderTour();
        expect(screen.getByText(/Step 1 of 6/)).toBeInTheDocument();
        // Guided mode → no overview rail.
        expect(screen.queryByRole('button', { name: /Restart tour/i })).not.toBeInTheDocument();
    });

    it('advances with the Right arrow key', () => {
        renderTour();
        fireEvent.keyDown(document.body, { key: 'ArrowRight' });
        expect(screen.getByText(/Step 2 of 6/)).toBeInTheDocument();
        fireEvent.keyDown(document.body, { key: 'ArrowLeft' });
        expect(screen.getByText(/Step 1 of 6/)).toBeInTheDocument();
    });

    it('starts a returning user in overview mode with a section rail', () => {
        localStorage.setItem(TOUR_COMPLETED_KEY, 'true');
        renderTour();
        expect(screen.getByRole('button', { name: /Restart tour/i })).toBeInTheDocument();
    });
});
