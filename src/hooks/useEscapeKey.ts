import { useEffect, useRef } from 'react';

type EscapeHandler = () => void;

// Open overlays, oldest first. One shared window listener dispatches each
// Escape press to the last entry only, so stacked overlays (a confirm dialog
// over a drawer, a compare view over a history panel) unwind one layer at a
// time — and a single keypress can never close two layers, even when the top
// layer unmounts synchronously while the event is still being dispatched.
const layers: EscapeHandler[] = [];

function handleKeyDown(event: KeyboardEvent) {
    // `defaultPrevented`: something inside the overlay (e.g. an inline editor
    // cancelling its own edit) already consumed this Escape. `isComposing`:
    // Escape is cancelling an IME composition, not asking to close anything.
    if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return;
    const top = layers[layers.length - 1];
    if (!top) return;
    event.preventDefault();
    top();
}

function pushLayer(handler: EscapeHandler): () => void {
    if (layers.length === 0) window.addEventListener('keydown', handleKeyDown);
    layers.push(handler);
    return () => {
        const index = layers.indexOf(handler);
        if (index !== -1) layers.splice(index, 1);
        if (layers.length === 0) window.removeEventListener('keydown', handleKeyDown);
    };
}

/**
 * Close an overlay (drawer, modal, confirm dialog) when Escape is pressed.
 *
 * - `enabled` lets an always-mounted overlay (the project drawer) take part
 *   only while it is open; a conditionally rendered overlay can leave it
 *   at the default.
 * - When several overlays are enabled, only the most recently enabled one
 *   responds — the topmost layer.
 * - `onClose` may change identity every render; the latest one is always the
 *   one called, without re-registering the layer (which would reorder it).
 *
 * This is the Escape half of modal keyboard handling only. Focus trapping,
 * focus restoration and scroll locking stay with each component.
 */
export function useEscapeKey(onClose: () => void, enabled = true): void {
    const onCloseRef = useRef(onClose);

    useEffect(() => {
        onCloseRef.current = onClose;
    }, [onClose]);

    useEffect(() => {
        if (!enabled) return;
        return pushLayer(() => onCloseRef.current());
    }, [enabled]);
}
