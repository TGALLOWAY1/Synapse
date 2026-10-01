import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useEscapeKey } from '../../hooks/useEscapeKey';

function Layer({ name, onClose, enabled }: { name: string; onClose: () => void; enabled?: boolean }) {
    useEscapeKey(onClose, enabled);
    return <div data-testid={name} />;
}

/** Fires Escape the way a browser does: at the focused element, bubbling to window. */
const pressEscape = (target: Element = document.body) => fireEvent.keyDown(target, { key: 'Escape' });

describe('useEscapeKey', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('calls onClose when Escape is pressed, and consumes the keypress', () => {
        const onClose = vi.fn();
        render(<Layer name="a" onClose={onClose} />);

        // fireEvent returns false when the event was default-prevented.
        expect(pressEscape()).toBe(false);
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('ignores other keys and leaves an unclaimed Escape alone', () => {
        const onClose = vi.fn();
        const { unmount } = render(<Layer name="a" onClose={onClose} />);

        fireEvent.keyDown(document.body, { key: 'Enter' });
        fireEvent.keyDown(document.body, { key: 'Tab' });
        expect(onClose).not.toHaveBeenCalled();

        unmount();
        // No layer is open: Escape is not default-prevented.
        expect(pressEscape()).toBe(true);
    });

    it('only responds while enabled', () => {
        const onClose = vi.fn();
        const { rerender } = render(<Layer name="a" onClose={onClose} enabled={false} />);

        pressEscape();
        expect(onClose).not.toHaveBeenCalled();

        rerender(<Layer name="a" onClose={onClose} enabled />);
        pressEscape();
        expect(onClose).toHaveBeenCalledTimes(1);

        rerender(<Layer name="a" onClose={onClose} enabled={false} />);
        pressEscape();
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('stops responding after unmount', () => {
        const onClose = vi.fn();
        const { unmount } = render(<Layer name="a" onClose={onClose} />);
        unmount();

        pressEscape();
        expect(onClose).not.toHaveBeenCalled();
    });

    it('always calls the latest onClose', () => {
        const first = vi.fn();
        const second = vi.fn();
        const { rerender } = render(<Layer name="a" onClose={first} />);
        rerender(<Layer name="a" onClose={second} />);

        pressEscape();
        expect(first).not.toHaveBeenCalled();
        expect(second).toHaveBeenCalledTimes(1);
    });

    it('closes only the topmost of stacked layers, one layer per keypress', () => {
        const drawer = vi.fn();
        const dialog = vi.fn();
        const { rerender } = render(<Layer name="drawer" onClose={drawer} />);
        // The dialog opens later, so it sits on top of the drawer.
        rerender(
            <>
                <Layer name="drawer" onClose={drawer} />
                <Layer name="dialog" onClose={dialog} />
            </>,
        );

        pressEscape();
        expect(dialog).toHaveBeenCalledTimes(1);
        expect(drawer).not.toHaveBeenCalled();

        // Once the dialog is gone the drawer is the top layer again.
        rerender(<Layer name="drawer" onClose={drawer} />);
        pressEscape();
        expect(dialog).toHaveBeenCalledTimes(1);
        expect(drawer).toHaveBeenCalledTimes(1);
    });

    it('does not close the layer beneath when the top layer unmounts during the keypress', () => {
        const beneath = vi.fn();

        function Stack() {
            const [topOpen, setTopOpen] = useState(true);
            return (
                <>
                    <Layer name="beneath" onClose={beneath} />
                    {topOpen && <Layer name="top" onClose={() => setTopOpen(false)} />}
                </>
            );
        }

        render(<Stack />);
        pressEscape();

        expect(screen.queryByTestId('top')).toBeNull();
        expect(beneath).not.toHaveBeenCalled();
    });

    it('treats the most recently enabled layer as the topmost', () => {
        const a = vi.fn();
        const b = vi.fn();
        const { rerender } = render(
            <>
                <Layer name="a" onClose={a} />
                <Layer name="b" onClose={b} />
            </>,
        );

        // Re-opening A (disable, then enable) puts it above B.
        rerender(
            <>
                <Layer name="a" onClose={a} enabled={false} />
                <Layer name="b" onClose={b} />
            </>,
        );
        rerender(
            <>
                <Layer name="a" onClose={a} enabled />
                <Layer name="b" onClose={b} />
            </>,
        );

        pressEscape();
        expect(a).toHaveBeenCalledTimes(1);
        expect(b).not.toHaveBeenCalled();
    });

    it('ignores an Escape that something inside the overlay already handled', () => {
        const onClose = vi.fn();
        render(
            <div>
                <input
                    data-testid="inline-editor"
                    onKeyDown={(event) => {
                        if (event.key === 'Escape') event.preventDefault();
                    }}
                />
                <Layer name="a" onClose={onClose} />
            </div>,
        );

        pressEscape(screen.getByTestId('inline-editor'));
        expect(onClose).not.toHaveBeenCalled();

        // The same key elsewhere still closes the overlay.
        pressEscape();
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('ignores Escape while an IME composition is in progress', () => {
        const onClose = vi.fn();
        render(<Layer name="a" onClose={onClose} />);

        fireEvent.keyDown(document.body, { key: 'Escape', isComposing: true });
        expect(onClose).not.toHaveBeenCalled();
    });

    it('shares one window listener across layers and removes it with the last layer', () => {
        const add = vi.spyOn(window, 'addEventListener');
        const remove = vi.spyOn(window, 'removeEventListener');
        const keydown = (calls: ReadonlyArray<readonly unknown[]>) =>
            calls.filter(([type]) => type === 'keydown').length;

        const { unmount } = render(
            <>
                <Layer name="a" onClose={vi.fn()} />
                <Layer name="b" onClose={vi.fn()} />
            </>,
        );
        expect(keydown(add.mock.calls)).toBe(1);
        expect(keydown(remove.mock.calls)).toBe(0);

        unmount();
        expect(keydown(remove.mock.calls)).toBe(1);
    });
});
