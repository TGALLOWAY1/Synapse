/**
 * Pure, framework-agnostic helpers for the PRD text-selection action dialog.
 *
 * Consumed by `StructuredPRDView.tsx` so the selection-validation
 * and viewport-clamping rules can be unit tested and shared by the
 * desktop popover and the mobile bottom sheet.
 */

export interface SelectionRect {
    top: number;
    bottom: number;
    left: number;
    width: number;
    height: number;
}

export interface SelectionInfo {
    text: string;
    rect: SelectionRect;
    /**
     * A cloned live DOM `Range` for the selection, when one was available at
     * capture time. Used by `SelectionActionDialog` to paint a persistent
     * anchor highlight via the CSS Custom Highlight API (so the highlight
     * survives the native selection collapsing when the dialog's textarea takes
     * focus). Optional: legacy call sites and environments without a live range
     * (e.g. jsdom paths that build `SelectionInfo` by hand) simply omit it and
     * fall back to the native selection.
     */
    range?: Range;
}

export interface Viewport {
    width: number;
    height: number;
}

export interface PopoverSize {
    width: number;
    height: number;
}

export interface PopoverPosition {
    top: number;
    left: number;
}

/**
 * True when `sel` is a usable text selection wholly anchored inside
 * `container`. Rejects: null selection, collapsed (caret-only) selections,
 * whitespace-only text, and selections whose endpoints are not contained by
 * the PRD content element (so selecting chrome/UI outside the PRD never opens
 * the dialog).
 */
export function isValidSelection(
    sel: Selection | null,
    container: HTMLElement | null,
): boolean {
    if (!sel || !container) return false;
    if (sel.isCollapsed) return false;
    if (sel.rangeCount === 0) return false;
    if (sel.toString().trim().length === 0) return false;

    const { anchorNode, focusNode } = sel;
    if (!anchorNode || !focusNode) return false;

    // Both endpoints must live inside the PRD container.
    return container.contains(anchorNode) && container.contains(focusNode);
}

/**
 * Reads the trimmed text and bounding rect from the first range of `sel`.
 * Returns null if there is no range. Caller should validate with
 * `isValidSelection` first.
 */
export function getSelectionInfo(sel: Selection | null): SelectionInfo | null {
    if (!sel || sel.rangeCount === 0) return null;
    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    return {
        text: sel.toString().trim(),
        rect: {
            top: rect.top,
            bottom: rect.bottom,
            left: rect.left,
            width: rect.width,
            height: rect.height,
        },
        // Snapshot the range so the anchor highlight persists after the native
        // selection collapses (guarded — `cloneRange` may be absent in some
        // non-browser environments).
        ...(typeof range.cloneRange === 'function' ? { range: range.cloneRange() } : {}),
    };
}

/**
 * Computes a viewport-clamped position for the floating desktop popover.
 *
 * - Horizontally centers on the selection, then clamps so the (centered)
 *   popover stays fully on screen with an 8px margin.
 * - Vertically PREFERS sitting 8px above the selection when it fits, and only
 *   falls back to 8px below when there is no room above. Rationale: a
 *   below-placement covers the text the user has not read yet, while an
 *   above-placement covers text they have already read. In the below case it
 *   still flips back above if the below position would overflow the bottom.
 * - Enforces an 8px top floor.
 *
 * The returned `left` is the popover's horizontal center (the popover element
 * uses `-translate-x-1/2`).
 */
export function computePopoverPosition(
    rect: SelectionRect,
    viewport: Viewport,
    size: PopoverSize,
): PopoverPosition {
    const rawLeft = rect.left + rect.width / 2;
    const aboveTop = rect.top - size.height - 8;
    const belowTop = rect.bottom + 8;

    const clampedLeft = Math.max(
        size.width / 2 + 8,
        Math.min(rawLeft, viewport.width - size.width / 2 - 8),
    );

    let placedTop: number;
    if (aboveTop >= 8) {
        // Preferred: sits above the (already-read) selection when it fits.
        placedTop = aboveTop;
    } else {
        // No room above → sit below, but flip back above if that overflows the
        // bottom edge (keeps the original below-case clamp/flip behavior).
        placedTop = belowTop + size.height > viewport.height ? aboveTop : belowTop;
    }

    return {
        top: Math.max(8, placedTop),
        left: clampedLeft,
    };
}
