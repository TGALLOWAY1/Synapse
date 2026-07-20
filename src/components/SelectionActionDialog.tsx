import { useEffect, useRef } from 'react';
import { IntentHelperInline } from '../lib/intentHelper';
import { useIsMobile } from '../lib/useIsMobile';
import {
    computePopoverPosition,
    type SelectionInfo,
} from '../lib/selectionPopover';

/** Action chips shown in the dialog. Desktop prefills; mobile one-taps. */
export const SELECTION_ACTIONS = ['Clarify', 'Expand', 'Specify', 'Alternative', 'Replace'] as const;

const POPOVER_SIZE = { width: 340, height: 220 };

interface SelectionActionDialogProps {
    selection: SelectionInfo;
    intent: string;
    setIntent: (value: string) => void;
    isSubmitting: boolean;
    /** Submit the typed intent (form submit / Branch button). */
    onSubmit: (e: React.FormEvent) => void;
    /** One-tap action — create a branch directly with `"<tag>: "` intent. */
    onQuickAction: (tag: string) => void;
    /** Dismiss the dialog (Escape, backdrop tap, cancel). */
    onDismiss: () => void;
}

/**
 * Shared action UI for the PRD highlight feature.
 *
 * - Desktop / tablet: a floating popover anchored to the selection rect
 *   (preserves the original behavior — chips prefill the intent input, the
 *   form submits to create a branch).
 * - Mobile (< md): a bottom sheet with safe-area insets and ≥44px tap targets.
 *   Chips create the branch in one tap; a free-text field remains for custom
 *   intent. Backdrop tap dismisses.
 *
 * Both presentations call the same branch/history handlers passed in by the
 * parent — there is no parallel editing path.
 */
export function SelectionActionDialog({
    selection,
    intent,
    setIntent,
    isSubmitting,
    onSubmit,
    onQuickAction,
    onDismiss,
}: SelectionActionDialogProps) {
    const isMobile = useIsMobile();
    const desktopRef = useRef<HTMLDivElement>(null);

    // Escape dismisses on every platform. On desktop, a pointerdown outside the
    // popover also dismisses (mobile uses the backdrop instead).
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onDismiss();
        };
        window.addEventListener('keydown', onKeyDown);

        let onPointerDown: ((e: PointerEvent) => void) | undefined;
        if (!isMobile) {
            onPointerDown = (e: PointerEvent) => {
                if (desktopRef.current && !desktopRef.current.contains(e.target as Node)) {
                    onDismiss();
                }
            };
            document.addEventListener('pointerdown', onPointerDown);
        }

        return () => {
            window.removeEventListener('keydown', onKeyDown);
            if (onPointerDown) document.removeEventListener('pointerdown', onPointerDown);
        };
    }, [onDismiss, isMobile]);

    const anchorPreview =
        selection.text.length > 50 ? `${selection.text.substring(0, 50)}...` : selection.text;

    // Which action chip prefilled the current intent (if any). Derived from the
    // intent string so no extra state is needed — the chips set `"<tag>: "`.
    const activeTag = SELECTION_ACTIONS.find(t => intent.startsWith(t + ': '));

    if (isMobile) {
        return (
            <>
                {/* Backdrop — tap to dismiss */}
                <div
                    data-testid="selection-dialog-backdrop"
                    className="fixed inset-0 z-50 bg-black/40"
                    onPointerDown={onDismiss}
                    aria-hidden="true"
                />
                {/* Bottom sheet */}
                <div
                    role="dialog"
                    aria-label="PRD edit actions"
                    className="fixed inset-x-0 bottom-0 z-50 flex max-h-[70vh] flex-col gap-3 rounded-t-2xl border-t border-neutral-200 bg-white p-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] shadow-2xl"
                >
                    <div className="mx-auto mb-1 h-1 w-10 rounded-full bg-neutral-300" aria-hidden="true" />
                    <div className="text-xs text-neutral-500">
                        <span className="font-semibold text-neutral-700">Anchor:</span> "{anchorPreview}"
                    </div>

                    <div className="flex flex-wrap gap-2">
                        {SELECTION_ACTIONS.map(tag => (
                            <button
                                key={tag}
                                type="button"
                                disabled={isSubmitting}
                                onClick={() => onQuickAction(tag)}
                                className="min-h-[44px] flex-1 basis-[28%] rounded-lg border border-neutral-200 bg-neutral-50 px-3 text-sm font-medium text-neutral-700 transition hover:bg-neutral-100 active:bg-neutral-200 disabled:opacity-50"
                            >
                                {tag}
                            </button>
                        ))}
                    </div>

                    <IntentHelperInline text={intent} />

                    <form onSubmit={onSubmit} className="flex gap-2">
                        <input
                            type="text"
                            value={intent}
                            onChange={e => setIntent(e.target.value)}
                            placeholder="Or type a custom change…"
                            className="min-h-[44px] flex-1 rounded-lg border border-neutral-200 bg-white px-3 text-sm text-neutral-900 outline-none transition focus:border-indigo-500"
                            disabled={isSubmitting}
                        />
                        <button
                            type="submit"
                            disabled={isSubmitting || !intent.trim()}
                            className="min-h-[44px] rounded-lg bg-indigo-600 px-4 text-sm font-medium text-white transition hover:bg-indigo-700 disabled:opacity-50"
                        >
                            {isSubmitting ? '…' : 'Branch'}
                        </button>
                    </form>
                </div>
            </>
        );
    }

    // Desktop / tablet floating popover.
    const pos = computePopoverPosition(
        selection.rect,
        { width: window.innerWidth, height: window.innerHeight },
        POPOVER_SIZE,
    );

    return (
        <div
            ref={desktopRef}
            role="dialog"
            aria-label="PRD edit actions"
            onMouseDown={e => e.preventDefault()}
            onMouseUp={e => e.stopPropagation()}
            className="fixed z-50 flex w-[340px] -translate-x-1/2 flex-col gap-3 rounded-xl border border-neutral-200 bg-white p-4 shadow-2xl"
            style={{ top: pos.top, left: pos.left }}
        >
            <div className="text-xs text-neutral-500">
                <span className="font-semibold text-neutral-700">Anchor:</span> "{anchorPreview}"
            </div>

            <div className="mb-2 mt-1 flex flex-wrap gap-1.5">
                {SELECTION_ACTIONS.map(tag => {
                    const isActive = tag === activeTag;
                    return (
                        <button
                            key={tag}
                            type="button"
                            aria-pressed={isActive}
                            onClick={() => setIntent(tag + ': ')}
                            className={
                                isActive
                                    ? 'rounded-full border border-indigo-600 bg-indigo-600 px-2.5 py-1.5 text-xs font-medium text-white shadow-sm transition'
                                    : 'rounded-full border border-neutral-200 bg-neutral-50 px-2.5 py-1.5 text-xs text-neutral-700 shadow-sm transition hover:border-neutral-300 hover:bg-neutral-100'
                            }
                        >
                            {tag}
                        </button>
                    );
                })}
            </div>

            <IntentHelperInline text={intent} />

            <form onSubmit={onSubmit} className="flex gap-2">
                <input
                    autoFocus
                    type="text"
                    value={intent}
                    onChange={e => setIntent(e.target.value)}
                    placeholder="How should this change?"
                    className="flex-1 rounded border border-neutral-200 bg-white px-2 py-1.5 text-sm text-neutral-900 outline-none transition focus:border-indigo-500"
                    disabled={isSubmitting}
                />
                <button
                    type="submit"
                    disabled={isSubmitting || !intent.trim()}
                    className="min-w-[60px] rounded bg-indigo-600 px-3 py-1.5 text-sm text-white transition hover:bg-indigo-700 disabled:opacity-50"
                >
                    {isSubmitting ? 'Creating...' : 'Branch'}
                </button>
            </form>
        </div>
    );
}
