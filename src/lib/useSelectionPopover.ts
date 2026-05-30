import { useCallback, useEffect, useState, type RefObject } from 'react';
import {
    getSelectionInfo,
    isValidSelection,
    type SelectionInfo,
} from './selectionPopover';

interface UseSelectionPopoverOptions {
    /** Ref to the PRD content container that selections must live inside. */
    containerRef: RefObject<HTMLElement | null>;
    /** When false, no listeners are attached and no selection is surfaced. */
    enabled: boolean;
    /** Debounce (ms) for the `selectionchange` path — the mobile route. */
    selectionChangeDelay?: number;
    /** Delay (ms) after `pointerup` before reading the selection. */
    pointerUpDelay?: number;
}

interface UseSelectionPopoverResult {
    selection: SelectionInfo | null;
    /** Imperatively dismiss the dialog and drop the native selection. */
    clear: () => void;
}

/**
 * Shared, touch-aware selection pipeline for the PRD action dialog.
 *
 * Detection sources (so mobile works, not just desktop mouse):
 *  - `pointerup` on the document — covers mouse, pen and touch taps; read with a
 *    tiny delay so double-click/word selections finish resolving (preserves the
 *    snappy desktop feel of the previous `mouseup` handler).
 *  - `selectionchange` on the document — the mobile route. Native long-press +
 *    drag-handle selection does not emit a `mouseup`/`pointerup` matching the
 *    final range, but it does fire `selectionchange`. Debounced so dragging a
 *    selection handle doesn't thrash state.
 *
 * Behavior:
 *  - A selection is surfaced only when `isValidSelection` passes (non-collapsed,
 *    non-empty, both endpoints inside `containerRef`).
 *  - A *collapsing* selection never auto-dismisses the dialog. This is what
 *    makes mobile usable: focusing the dialog's input (soft keyboard) collapses
 *    the native selection, which would otherwise close the dialog. Dismissal is
 *    explicit instead — `clear()` (Escape / backdrop tap / outside click /
 *    submit / cancel), wired up by `SelectionActionDialog`.
 *  - When `enabled` is false (read-only / mid-edit) no listeners are attached
 *    and nothing is surfaced.
 */
export function useSelectionPopover({
    containerRef,
    enabled,
    selectionChangeDelay = 300,
    pointerUpDelay = 10,
}: UseSelectionPopoverOptions): UseSelectionPopoverResult {
    const [selection, setSelection] = useState<SelectionInfo | null>(null);

    const clear = useCallback(() => {
        setSelection(null);
        if (typeof window !== 'undefined') {
            window.getSelection()?.removeAllRanges();
        }
    }, []);

    useEffect(() => {
        if (!enabled) return;

        let pointerTimer: ReturnType<typeof setTimeout> | undefined;
        let changeTimer: ReturnType<typeof setTimeout> | undefined;

        // setState here is event-driven (fired from a debounced listener), not
        // synchronous within the effect body, so it doesn't cascade renders.
        const evaluate = () => {
            const sel = window.getSelection();
            if (isValidSelection(sel, containerRef.current)) {
                const info = getSelectionInfo(sel);
                if (info) setSelection(info);
            }
            // Invalid/collapsed selection: keep whatever is open. Dismissal is
            // explicit (see the dialog), which is what keeps mobile usable.
        };

        const onPointerUp = () => {
            clearTimeout(pointerTimer);
            pointerTimer = setTimeout(evaluate, pointerUpDelay);
        };

        const onSelectionChange = () => {
            clearTimeout(changeTimer);
            changeTimer = setTimeout(evaluate, selectionChangeDelay);
        };

        document.addEventListener('pointerup', onPointerUp);
        document.addEventListener('selectionchange', onSelectionChange);

        return () => {
            clearTimeout(pointerTimer);
            clearTimeout(changeTimer);
            document.removeEventListener('pointerup', onPointerUp);
            document.removeEventListener('selectionchange', onSelectionChange);
        };
    }, [enabled, containerRef, selectionChangeDelay, pointerUpDelay]);

    // Gate the surfaced value on `enabled` so toggling read-only / entering an
    // inline edit hides the dialog without a setState-in-effect.
    return { selection: enabled ? selection : null, clear };
}
