import { describe, it, expect } from 'vitest';
import {
    isValidSelection,
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

describe('computePopoverPosition', () => {
    const viewport = { width: 1000, height: 800 };
    const size = { width: 320, height: 220 };

    const rect = (over: Partial<SelectionRect> = {}): SelectionRect => ({
        top: 100,
        bottom: 120,
        left: 400,
        width: 100,
        height: 20,
        ...over,
    });

    it('centers horizontally on the selection and sits below it', () => {
        const pos = computePopoverPosition(rect(), viewport, size);
        expect(pos.left).toBe(450); // 400 + 100/2
        expect(pos.top).toBe(128); // 120 + 8
    });

    it('clamps to the left edge so the centered popover stays on screen', () => {
        const pos = computePopoverPosition(rect({ left: 0, width: 10 }), viewport, size);
        expect(pos.left).toBe(size.width / 2 + 8); // 168
    });

    it('clamps to the right edge', () => {
        const pos = computePopoverPosition(rect({ left: 990, width: 10 }), viewport, size);
        expect(pos.left).toBe(viewport.width - size.width / 2 - 8); // 832
    });

    it('flips above the selection when it would overflow the bottom', () => {
        const pos = computePopoverPosition(
            rect({ top: 700, bottom: 720 }),
            viewport,
            size,
        );
        // 720 + 8 + 220 > 800 -> flip above: 700 - 220 - 8 = 472
        expect(pos.top).toBe(472);
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
