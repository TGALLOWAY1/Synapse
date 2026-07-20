import { describe, it, expect } from 'vitest';
import {
    isValidSelection,
    getSelectionInfo,
    computePopoverPosition,
    type SelectionRect,
} from '../selectionPopover';

/**
 * Builds a minimal fake `Selection` for validation tests. Only the fields read
 * by `isValidSelection` are populated.
 */
function fakeSelection(opts: {
    text?: string;
    collapsed?: boolean;
    rangeCount?: number;
    anchorNode?: Node | null;
    focusNode?: Node | null;
}): Selection {
    return {
        isCollapsed: opts.collapsed ?? false,
        rangeCount: opts.rangeCount ?? 1,
        anchorNode: opts.anchorNode ?? null,
        focusNode: opts.focusNode ?? null,
        toString: () => opts.text ?? '',
    } as unknown as Selection;
}

describe('isValidSelection', () => {
    const container = document.createElement('div');
    container.textContent = 'Some PRD content here';
    const inside = container.firstChild as Node;

    const outside = document.createElement('p');
    outside.textContent = 'chrome outside the PRD';
    const outsideNode = outside.firstChild as Node;

    it('rejects a null selection', () => {
        expect(isValidSelection(null, container)).toBe(false);
    });

    it('rejects when there is no container', () => {
        expect(isValidSelection(fakeSelection({ text: 'x', anchorNode: inside, focusNode: inside }), null)).toBe(false);
    });

    it('rejects a collapsed (caret-only) selection', () => {
        expect(
            isValidSelection(
                fakeSelection({ text: 'x', collapsed: true, anchorNode: inside, focusNode: inside }),
                container,
            ),
        ).toBe(false);
    });

    it('rejects when rangeCount is 0', () => {
        expect(
            isValidSelection(
                fakeSelection({ text: 'x', rangeCount: 0, anchorNode: inside, focusNode: inside }),
                container,
            ),
        ).toBe(false);
    });

    it('rejects whitespace-only text', () => {
        expect(
            isValidSelection(
                fakeSelection({ text: '   \n ', anchorNode: inside, focusNode: inside }),
                container,
            ),
        ).toBe(false);
    });

    it('rejects a selection whose endpoints are outside the container', () => {
        expect(
            isValidSelection(
                fakeSelection({ text: 'outside', anchorNode: outsideNode, focusNode: outsideNode }),
                container,
            ),
        ).toBe(false);
    });

    it('accepts a non-empty selection anchored inside the container', () => {
        expect(
            isValidSelection(
                fakeSelection({ text: 'PRD content', anchorNode: inside, focusNode: inside }),
                container,
            ),
        ).toBe(true);
    });
});

describe('getSelectionInfo', () => {
    /**
     * Builds a fake `Selection` whose first range exposes `getBoundingClientRect`
     * and `cloneRange`, so we can assert the range snapshot without a real DOM
     * selection (jsdom does not resolve live selection ranges).
     */
    function fakeSelectionWithRange(over: { cloneRange?: () => Range } = {}) {
        const rect = { top: 10, bottom: 30, left: 40, width: 50, height: 20 } as DOMRect;
        const cloned = { __cloned: true } as unknown as Range;
        const range = {
            getBoundingClientRect: () => rect,
            cloneRange: over.cloneRange ?? (() => cloned),
        } as unknown as Range;
        const sel = {
            rangeCount: 1,
            getRangeAt: () => range,
            toString: () => '  hello  ',
        } as unknown as Selection;
        return { sel, cloned };
    }

    it('captures a cloned range when one is available', () => {
        const { sel, cloned } = fakeSelectionWithRange();
        const info = getSelectionInfo(sel);
        expect(info).not.toBeNull();
        expect(info?.text).toBe('hello');
        expect(info?.range).toBe(cloned);
        expect(info?.rect).toEqual({ top: 10, bottom: 30, left: 40, width: 50, height: 20 });
    });

    it('omits range when the environment has no cloneRange', () => {
        const rect = { top: 0, bottom: 0, left: 0, width: 0, height: 0 } as DOMRect;
        const range = { getBoundingClientRect: () => rect } as unknown as Range;
        const sel = {
            rangeCount: 1,
            getRangeAt: () => range,
            toString: () => 'x',
        } as unknown as Selection;
        const info = getSelectionInfo(sel);
        expect(info?.range).toBeUndefined();
    });

    it('returns null when there is no range', () => {
        const sel = { rangeCount: 0 } as unknown as Selection;
        expect(getSelectionInfo(sel)).toBeNull();
    });
});

describe('computePopoverPosition', () => {
    const viewport = { width: 1000, height: 800 };
    const size = { width: 480, height: 280 };

    const rect = (over: Partial<SelectionRect> = {}): SelectionRect => ({
        top: 100,
        bottom: 120,
        left: 400,
        width: 100,
        height: 20,
        ...over,
    });

    it('prefers sitting above the selection when there is room', () => {
        // A selection well down the page has room above it.
        const pos = computePopoverPosition(rect({ top: 400, bottom: 420 }), viewport, size);
        expect(pos.left).toBe(450); // 400 + 100/2
        expect(pos.top).toBe(112); // above: 400 - 280 - 8
    });

    it('clamps to the left edge so the centered popover stays on screen', () => {
        const pos = computePopoverPosition(rect({ top: 400, bottom: 420, left: 0, width: 10 }), viewport, size);
        expect(pos.left).toBe(size.width / 2 + 8); // 248
    });

    it('clamps to the right edge', () => {
        const pos = computePopoverPosition(rect({ top: 400, bottom: 420, left: 990, width: 10 }), viewport, size);
        expect(pos.left).toBe(viewport.width - size.width / 2 - 8); // 752
    });

    it('falls back below the selection when there is no room above (near viewport top)', () => {
        // top 100 → above would be 100 - 280 - 8 = -188 (< 8), so sit below.
        const pos = computePopoverPosition(rect({ top: 100, bottom: 120 }), viewport, size);
        expect(pos.top).toBe(128); // below: 120 + 8
    });

    it('enforces an 8px top floor', () => {
        const pos = computePopoverPosition(
            rect({ top: 5, bottom: 790 }),
            viewport,
            size,
        );
        expect(pos.top).toBe(8);
    });
});
