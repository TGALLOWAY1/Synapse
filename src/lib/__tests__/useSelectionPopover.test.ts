import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSelectionPopover } from '../useSelectionPopover';

/**
 * Exercises the shared selection pipeline that powers both the desktop popover
 * and the mobile bottom sheet. Verifies the two detection routes:
 *  - `pointerup` (mouse/pen/touch — the desktop regression path)
 *  - `selectionchange` (the mobile long-press route)
 */

function makeFakeSelection(opts: {
    text: string;
    node: Node | null;
    collapsed?: boolean;
}): Selection {
    return {
        isCollapsed: opts.collapsed ?? false,
        rangeCount: 1,
        anchorNode: opts.node,
        focusNode: opts.node,
        toString: () => opts.text,
        getRangeAt: () => ({
            getBoundingClientRect: () => ({
                top: 10,
                bottom: 30,
                left: 40,
                width: 60,
                height: 20,
            }),
        }),
        removeAllRanges: () => {},
    } as unknown as Selection;
}

describe('useSelectionPopover', () => {
    let container: HTMLDivElement;
    let ref: { current: HTMLElement | null };

    beforeEach(() => {
        vi.useFakeTimers();
        container = document.createElement('div');
        container.textContent = 'Hello PRD world';
        document.body.appendChild(container);
        ref = { current: container };
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
        document.body.innerHTML = '';
    });

    it('surfaces a valid selection after pointerup (desktop path)', () => {
        const node = container.firstChild;
        vi.spyOn(window, 'getSelection').mockReturnValue(
            makeFakeSelection({ text: 'PRD', node }),
        );

        const { result } = renderHook(() =>
            useSelectionPopover({ containerRef: ref, enabled: true }),
        );

        act(() => {
            document.dispatchEvent(new Event('pointerup'));
            vi.advanceTimersByTime(20);
        });

        expect(result.current.selection?.text).toBe('PRD');
        expect(result.current.selection?.rect.left).toBe(40);
    });

    it('surfaces a valid selection after a debounced selectionchange (mobile path)', () => {
        const node = container.firstChild;
        vi.spyOn(window, 'getSelection').mockReturnValue(
            makeFakeSelection({ text: 'world', node }),
        );

        const { result } = renderHook(() =>
            useSelectionPopover({ containerRef: ref, enabled: true }),
        );

        act(() => {
            document.dispatchEvent(new Event('selectionchange'));
            vi.advanceTimersByTime(300);
        });

        expect(result.current.selection?.text).toBe('world');
    });

    it('ignores selections outside the container', () => {
        const stray = document.createElement('span');
        stray.textContent = 'elsewhere';
        document.body.appendChild(stray);

        vi.spyOn(window, 'getSelection').mockReturnValue(
            makeFakeSelection({ text: 'elsewhere', node: stray.firstChild }),
        );

        const { result } = renderHook(() =>
            useSelectionPopover({ containerRef: ref, enabled: true }),
        );

        act(() => {
            document.dispatchEvent(new Event('pointerup'));
            vi.advanceTimersByTime(20);
        });

        expect(result.current.selection).toBeNull();
    });

    it('does not dismiss an open dialog when the selection later collapses', () => {
        const node = container.firstChild;
        const getSel = vi.spyOn(window, 'getSelection');

        const { result } = renderHook(() =>
            useSelectionPopover({ containerRef: ref, enabled: true }),
        );

        // First: a real selection opens the dialog.
        getSel.mockReturnValue(makeFakeSelection({ text: 'PRD', node }));
        act(() => {
            document.dispatchEvent(new Event('pointerup'));
            vi.advanceTimersByTime(20);
        });
        expect(result.current.selection?.text).toBe('PRD');

        // Then: focusing the input collapses the native selection. The dialog
        // must stay open (this is the mobile-keyboard failure mode).
        getSel.mockReturnValue(makeFakeSelection({ text: '', node, collapsed: true }));
        act(() => {
            document.dispatchEvent(new Event('selectionchange'));
            vi.advanceTimersByTime(300);
        });
        expect(result.current.selection?.text).toBe('PRD');
    });

    describe('manual-commit (mobile) mode', () => {
        it('tracks but does not surface a selection until commit()', () => {
            const node = container.firstChild;
            vi.spyOn(window, 'getSelection').mockReturnValue(
                makeFakeSelection({ text: 'world', node }),
            );

            const { result } = renderHook(() =>
                useSelectionPopover({ containerRef: ref, enabled: true, manualCommit: true }),
            );

            act(() => {
                document.dispatchEvent(new Event('selectionchange'));
                vi.advanceTimersByTime(300);
            });

            // The action sheet must NOT auto-open — only the pending text is set.
            expect(result.current.selection).toBeNull();
            expect(result.current.pendingText).toBe('world');

            act(() => {
                result.current.commit();
            });

            expect(result.current.selection?.text).toBe('world');
        });

        it('commit() is a no-op when nothing is tracked', () => {
            const { result } = renderHook(() =>
                useSelectionPopover({ containerRef: ref, enabled: true, manualCommit: true }),
            );

            act(() => {
                result.current.commit();
            });

            expect(result.current.selection).toBeNull();
        });

        it('clear() resets the tracked pending selection', () => {
            const node = container.firstChild;
            vi.spyOn(window, 'getSelection').mockReturnValue(
                makeFakeSelection({ text: 'PRD', node }),
            );

            const { result } = renderHook(() =>
                useSelectionPopover({ containerRef: ref, enabled: true, manualCommit: true }),
            );

            act(() => {
                document.dispatchEvent(new Event('pointerup'));
                vi.advanceTimersByTime(20);
            });
            expect(result.current.pendingText).toBe('PRD');

            act(() => {
                result.current.clear();
            });
            expect(result.current.pendingText).toBeNull();
            expect(result.current.selection).toBeNull();
        });

        it('surfaces immediately when manualCommit is false (desktop regression guard)', () => {
            const node = container.firstChild;
            vi.spyOn(window, 'getSelection').mockReturnValue(
                makeFakeSelection({ text: 'PRD', node }),
            );

            const { result } = renderHook(() =>
                useSelectionPopover({ containerRef: ref, enabled: true, manualCommit: false }),
            );

            act(() => {
                document.dispatchEvent(new Event('pointerup'));
                vi.advanceTimersByTime(20);
            });

            expect(result.current.selection?.text).toBe('PRD');
            expect(result.current.pendingText).toBeNull();
        });
    });

    it('clears when disabled', () => {
        const node = container.firstChild;
        vi.spyOn(window, 'getSelection').mockReturnValue(
            makeFakeSelection({ text: 'PRD', node }),
        );

        const { result, rerender } = renderHook(
            ({ enabled }) => useSelectionPopover({ containerRef: ref, enabled }),
            { initialProps: { enabled: true } },
        );

        act(() => {
            document.dispatchEvent(new Event('pointerup'));
            vi.advanceTimersByTime(20);
        });
        expect(result.current.selection?.text).toBe('PRD');

        rerender({ enabled: false });
        expect(result.current.selection).toBeNull();
    });
});
