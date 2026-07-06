import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { ScreensStatusDot } from '../ArtifactWorkspace';

// The Screens sidebar row is fed by two slots — screen_inventory (the screen
// "breakdown") and mockup. The breakdown almost always finishes before the
// mockups, and a flat green check on the row used to imply the mockups were
// ready too. ScreensStatusDot keeps the two sub-statuses distinct.

describe('ScreensStatusDot', () => {
    it('shows the breakdown status while the breakdown is still generating', () => {
        const { container } = render(
            <ScreensStatusDot inventory="generating" mockup="idle" />,
        );
        // Spinner (Loader2) present, no partial tooltip.
        expect(container.querySelector('.animate-spin')).not.toBeNull();
        expect(container.querySelector('[title]')).toBeNull();
    });

    it('pairs a done check with a spinner while mockups are still generating', () => {
        const { container } = render(
            <ScreensStatusDot inventory="done" mockup="generating" />,
        );
        const wrapper = container.querySelector('[title]');
        expect(wrapper?.getAttribute('title')).toMatch(/mockups still generating/i);
        // Both a completed check and a live spinner are shown.
        expect(container.querySelector('.text-green-500')).not.toBeNull();
        expect(container.querySelector('.animate-spin')).not.toBeNull();
    });

    it('treats queued mockups as still in progress', () => {
        const { container } = render(
            <ScreensStatusDot inventory="done" mockup="queued" />,
        );
        expect(container.querySelector('[title]')?.getAttribute('title')).toMatch(
            /mockups still generating/i,
        );
    });

    it('flags mockup errors on the row once the breakdown is done', () => {
        const { container } = render(
            <ScreensStatusDot inventory="done" mockup="error" />,
        );
        expect(container.querySelector('[title]')?.getAttribute('title')).toMatch(
            /mockups need attention/i,
        );
        expect(container.querySelector('.text-red-500')).not.toBeNull();
    });

    it('shows a plain completed check when both breakdown and mockups are done', () => {
        const { container } = render(
            <ScreensStatusDot inventory="done" mockup="done" />,
        );
        expect(container.querySelector('[title]')).toBeNull();
        expect(container.querySelector('.animate-spin')).toBeNull();
        expect(container.querySelector('.text-green-500')).not.toBeNull();
    });

    it('shows a plain completed check when the breakdown is done and mockups were never requested', () => {
        const { container } = render(
            <ScreensStatusDot inventory="done" mockup="idle" />,
        );
        expect(container.querySelector('[title]')).toBeNull();
        expect(container.querySelector('.animate-spin')).toBeNull();
        expect(container.querySelector('.text-green-500')).not.toBeNull();
    });
});
