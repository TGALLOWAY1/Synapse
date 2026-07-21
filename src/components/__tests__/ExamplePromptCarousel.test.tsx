import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ExamplePromptCarousel, type ExamplePrompt } from '../ExamplePromptCarousel';

const EXAMPLES: ExamplePrompt[] = [
    { title: 'Artisan marketplace', full: 'A mobile-friendly marketplace app for local artisans.', platform: 'app' },
    { title: 'Team dashboard', full: 'A real-time project management dashboard for distributed teams.', platform: 'web' },
    { title: 'Recipe community', full: 'A recipe sharing platform where users can post and discover recipes.', platform: 'web' },
];

// Fits by default: scrollWidth === clientWidth (no overflow).
function mockTrackDimensions(scrollWidth: number, clientWidth: number) {
    Object.defineProperty(HTMLElement.prototype, 'scrollWidth', {
        configurable: true,
        get() { return scrollWidth; },
    });
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
        configurable: true,
        get() { return clientWidth; },
    });
}

describe('ExamplePromptCarousel', () => {
    beforeEach(() => {
        mockTrackDimensions(600, 600);
        // jsdom does not implement Element.scrollBy — define a stub so tests can spy on it.
        if (!Element.prototype.scrollBy) {
            Element.prototype.scrollBy = function scrollBy() { /* no-op stub for jsdom */ };
        }
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('renders a card with the title for every example', () => {
        render(<ExamplePromptCarousel examples={EXAMPLES} onSelect={vi.fn()} />);
        expect(screen.getByText('Artisan marketplace')).toBeInTheDocument();
        expect(screen.getByText('Team dashboard')).toBeInTheDocument();
        expect(screen.getByText('Recipe community')).toBeInTheDocument();
    });

    it('distinguishes app vs web examples via platform icon', () => {
        render(<ExamplePromptCarousel examples={EXAMPLES} onSelect={vi.fn()} />);
        expect(screen.getAllByTestId('icon-app')).toHaveLength(1);
        expect(screen.getAllByTestId('icon-web')).toHaveLength(2);
    });

    it('calls onSelect with the matching example when a card is clicked', () => {
        const onSelect = vi.fn();
        render(<ExamplePromptCarousel examples={EXAMPLES} onSelect={onSelect} />);
        fireEvent.click(screen.getByText('Team dashboard'));
        expect(onSelect).toHaveBeenCalledTimes(1);
        expect(onSelect).toHaveBeenCalledWith(EXAMPLES[1]);
    });

    it('hides the chevrons when all cards fit without overflow', () => {
        mockTrackDimensions(600, 600);
        render(<ExamplePromptCarousel examples={EXAMPLES} onSelect={vi.fn()} />);
        expect(screen.queryByRole('button', { name: 'Previous examples' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Next examples' })).not.toBeInTheDocument();
    });

    it('shows chevrons and scrolls the track when content overflows', () => {
        mockTrackDimensions(1200, 600);
        const scrollBySpy = vi.spyOn(Element.prototype, 'scrollBy').mockImplementation(() => {});
        render(<ExamplePromptCarousel examples={EXAMPLES} onSelect={vi.fn()} />);

        const nextButton = screen.getByRole('button', { name: 'Next examples' });
        expect(nextButton).toBeInTheDocument();
        expect(nextButton).not.toBeDisabled();

        fireEvent.click(nextButton);
        expect(scrollBySpy).toHaveBeenCalledWith({ left: 264, behavior: 'smooth' });

        const prevButton = screen.getByRole('button', { name: 'Previous examples' });
        expect(prevButton).toBeDisabled();
    });
});
