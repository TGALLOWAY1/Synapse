import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
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
    /**
     * Manual-commit (mobile) mode. When true, a valid selection is *tracked*
     * (exposed via `pendingText`) but is **not** surfaced as `selection` until
     * `commit()` is called. This is what lets the user finish dragging the
     * native iOS selection handles to a full phrase before the Synapse action
     * sheet opens — instead of it popping on the first selected word and
     * fighting the iOS Copy/Look Up toolbar. When false (desktop), a valid
     * selection is surfaced immediately as before.
     */
    manualCommit?: boolean;
    /** Debounce (ms) for the `selectionchange` path — the mobile route. */
    selectionChangeDelay?: number;
    /** Delay (ms) after `pointerup` before reading the selection. */
    pointerUpDelay?: number;
}

interface UseSelectionPopoverResult {
    selection: SelectionInfo | null;
    /**
     * In manual-commit mode, the text of the latest tracked-but-uncommitted
     * selection (for the mobile toolbar to echo). `null` when nothing is
     * tracked or in immediate (desktop) mode.
     */
    pendingText: string | null;
    /** Surface the tracked selection (manual-commit mode). No-op otherwise. */
    commit: () => void;
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
    manualCommit = false,
    selectionChangeDelay = 300,
    pointerUpDelay = 10,
}: UseSelectionPopoverOptions): UseSelectionPopoverResult {
    const [selection, setSelection] = useState<SelectionInfo | null>(null);
    // The latest valid selection tracked but not yet surfaced (manual-commit
    // mode). A ref so `commit()` reads the freshest value without re-binding,
    // mirrored into state so the toolbar re-renders as the selection grows.
    const pendingRef = useRef<SelectionInfo | null>(null);
    const [pendingText, setPendingText] = useState<string | null>(null);

    const clear = useCallback(() => {
        setSelection(null);
        pendingRef.current = null;
        setPendingText(null);
        if (typeof window !== 'undefined') {
            window.getSelection()?.removeAllRanges();
        }
    }, []);

    // Surface the tracked selection (manual-commit mode). Reads the tracked
    // value rather than `window.getSelection()` so a button tap that collapses
    // the native range can't lose the selection.
    const commit = useCallback(() => {
        if (pendingRef.current) setSelection(pendingRef.current);
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
                if (info) {
                    if (manualCommit) {
                        // Track only — opening the action sheet waits for commit().
                        pendingRef.current = info;
                        setPendingText(info.text);
                    } else {
                        setSelection(info);
                    }
                }
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
    }, [enabled, manualCommit, containerRef, selectionChangeDelay, pointerUpDelay]);

    // Gate the surfaced value on `enabled` so toggling read-only / entering an
    // inline edit hides the dialog without a setState-in-effect.
    return {
        selection: enabled ? selection : null,
        pendingText: enabled ? pendingText : null,
        commit,
        clear,
    };
}
