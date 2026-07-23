import { useEffect, useRef } from 'react';
import { IntentHelperInline } from '../lib/intentHelper';
import { useIsMobile } from '../lib/useIsMobile';
import { PRD_EDIT_ACTIONS, intentPrefixFor } from '../lib/prdEditActions';
import {
    computePopoverPosition,
    type SelectionInfo,
} from '../lib/selectionPopover';

/**
 * Action chip labels shown in the dialog, derived from the PRD edit-action
 * registry (the single source of truth). Desktop prefills the intent; mobile
 * one-taps to create a branch.
 */
export const SELECTION_ACTIONS = PRD_EDIT_ACTIONS.map(a => a.label);

const POPOVER_SIZE = { width: 480, height: 280 };

/** Registry key for the live selection-anchor highlight (CSS Custom Highlight API). */
const ANCHOR_HIGHLIGHT_NAME = 'prd-refine-anchor';

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

    // Live anchor highlight (CSS Custom Highlight API). While the dialog is open
    // we paint the selected range with `::highlight(prd-refine-anchor)` so the
    // anchor stays visible even after the native selection collapses — which it
    // does the moment the desktop textarea takes focus (`autoFocus`) or the
    // mobile soft keyboard opens. Feature-detected: environments without the API
    // (jsdom, older browsers) silently fall back to the native selection.
    // Shared by both the desktop and mobile branches (runs above the split).
    const anchorRange = selection.range;
    useEffect(() => {
        if (typeof CSS === 'undefined' || !('highlights' in CSS)) return;
        if (!anchorRange) return;
        CSS.highlights.set(ANCHOR_HIGHLIGHT_NAME, new Highlight(anchorRange));
        return () => {
            CSS.highlights.delete(ANCHOR_HIGHLIGHT_NAME);
        };
    }, [anchorRange]);

    const anchorPreview =
        selection.text.length > 50 ? `${selection.text.substring(0, 50)}...` : selection.text;

    // Which action chip prefilled the current intent (if any). Derived from the
    // intent string so no extra state is needed — the chips set `"<tag>: "`.
    const activeTag = PRD_EDIT_ACTIONS.find(a => intent.startsWith(intentPrefixFor(a)))?.label;

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
                        {PRD_EDIT_ACTIONS.map(action => {
                            const Icon = action.icon;
                            return (
                                <button
                                    key={action.id}
                                    type="button"
                                    disabled={isSubmitting}
                                    onClick={() => onQuickAction(action.label)}
                                    className="flex min-h-[44px] flex-1 basis-[28%] items-center justify-center gap-1.5 rounded-lg border border-neutral-200 bg-neutral-50 px-3 text-sm font-medium text-neutral-700 transition hover:bg-neutral-100 active:bg-neutral-200 disabled:opacity-50"
                                >
                                    <Icon size={15} className="text-indigo-500" aria-hidden="true" />
                                    {action.label}
                                </button>
                            );
                        })}
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
            className="fixed z-50 flex w-[480px] -translate-x-1/2 flex-col gap-3 rounded-xl border border-neutral-200 bg-white p-4 shadow-2xl"
            style={{ top: pos.top, left: pos.left }}
        >
            <div className="text-xs text-neutral-500">
                <span className="font-semibold text-neutral-700">Anchor:</span> "{anchorPreview}"
            </div>

            <div className="mb-2 mt-1 flex flex-wrap gap-1.5">
                {PRD_EDIT_ACTIONS.map(action => {
                    const isActive = action.label === activeTag;
                    const Icon = action.icon;
                    return (
                        <button
                            key={action.id}
                            type="button"
                            aria-pressed={isActive}
                            title={action.helper}
                            onClick={() => setIntent(intentPrefixFor(action))}
                            className={
                                isActive
                                    ? 'flex flex-1 basis-[30%] items-center justify-center gap-1 rounded-full border border-indigo-600 bg-indigo-600 px-2 py-1.5 text-xs font-medium text-white shadow-sm transition'
                                    : 'flex flex-1 basis-[30%] items-center justify-center gap-1 rounded-full border border-neutral-200 bg-neutral-50 px-2 py-1.5 text-xs text-neutral-700 shadow-sm transition hover:border-neutral-300 hover:bg-neutral-100'
                            }
                        >
                            <Icon size={13} aria-hidden="true" className={isActive ? 'text-white' : 'text-indigo-500'} />
                            {action.label}
                        </button>
                    );
                })}
            </div>

            <IntentHelperInline text={intent} />

            <form onSubmit={onSubmit} className="flex flex-col gap-2">
                <textarea
                    autoFocus
                    rows={3}
                    value={intent}
                    onChange={e => setIntent(e.target.value)}
                    onKeyDown={e => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            onSubmit(e);
                        }
                    }}
                    placeholder="How should this change?"
                    className="w-full resize-none rounded-lg border border-neutral-200 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
                    disabled={isSubmitting}
                />
                <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] text-neutral-400">
                        Enter to branch · Shift+Enter for a new line
                    </span>
                    <button
                        type="submit"
                        disabled={isSubmitting || !intent.trim()}
                        className="min-w-[60px] rounded bg-indigo-600 px-3 py-1.5 text-sm text-white transition hover:bg-indigo-700 disabled:opacity-50"
                    >
                        {isSubmitting ? 'Creating...' : 'Branch'}
                    </button>
                </div>
            </form>
        </div>
    );
}
