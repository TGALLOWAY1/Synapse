import { useEffect, useId, useRef, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useEscapeKey } from '../../hooks/useEscapeKey';

export type ConfirmDialogTone = 'default' | 'amber' | 'danger';

const FOCUSABLE_SELECTOR = [
    'button:not([disabled])',
    '[href]',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
].join(', ');

interface ConfirmDialogProps {
    /** Dialog heading. */
    title: string;
    /** Bespoke body content (paragraphs, lists, inline warning boxes, …). */
    children?: ReactNode;
    cancelLabel: string;
    /** Confirm button content — may include an inline icon alongside text. */
    confirmLabel: ReactNode;
    onCancel: () => void;
    onConfirm: () => void;
    /**
     * `default` matches the compact indigo-accented confirm dialogs used
     * across ArtifactWorkspace/DependencyGraphView; `amber` matches the
     * warning-styled confirm used for the incomplete-PRD gate (icon header,
     * amber confirm button, no backdrop-dismiss); `danger` is the default
     * layout with a red confirm button, for deletions and other irreversible
     * actions.
     */
    tone?: ConfirmDialogTone;
    /** Icon rendered beside the title (amber tone only convention, but not enforced). */
    icon?: ReactNode;
    /** Whether clicking the backdrop cancels the dialog. Defaults to true. */
    dismissOnBackdropClick?: boolean;
    /** Tailwind max-width class for the card. Defaults to `max-w-sm`. */
    maxWidthClassName?: string;
    /** Disables the confirm button (e.g. while a bulk action is in flight). */
    confirmDisabled?: boolean;
    /**
     * Render into `document.body` instead of in place. Set it when the dialog
     * is opened from inside a transformed container or a z-indexed stacking
     * context (a sliding drawer, a rail, a sticky banner): a fixed-position
     * backdrop there would be confined to that container or painted beneath
     * sibling UI, which the native `confirm()` it replaces could never be.
     */
    portal?: boolean;
}

/**
 * Shared presentational confirm modal — a fixed-inset backdrop + centered
 * white card + Cancel/Confirm button row. Extracted from five duplicated
 * inline overlays (ArtifactWorkspace mockup/design regenerate + missing
 * mockups, DependencyGraphView update, ProjectWorkspace incomplete-PRD gate).
 * Bespoke per-call-site copy/content goes in as `children`.
 *
 * This is also the app's replacement for the native `window.confirm()`, so it
 * carries the keyboard behavior that dialog had: Escape cancels (layered
 * through `useEscapeKey`, so it dismisses only this dialog when it sits over a
 * drawer or panel), focus lands on Cancel (the least destructive action), Tab
 * stays inside, and focus returns to the opener when the dialog closes. Render
 * it conditionally — mounting is opening.
 */
export function ConfirmDialog({
    title,
    children,
    cancelLabel,
    confirmLabel,
    onCancel,
    onConfirm,
    tone = 'default',
    icon,
    dismissOnBackdropClick = true,
    maxWidthClassName = 'max-w-sm',
    confirmDisabled = false,
    portal = false,
}: ConfirmDialogProps) {
    const titleId = useId();
    const cancelRef = useRef<HTMLButtonElement>(null);
    const isAmber = tone === 'amber';
    const isDanger = tone === 'danger';

    useEscapeKey(onCancel);

    useEffect(() => {
        const previouslyFocused = document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;
        cancelRef.current?.focus();
        return () => previouslyFocused?.focus();
    }, []);

    const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
        if (event.key !== 'Tab') return;
        const focusable = [...event.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)];
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
    };

    const dialog = (
        <div
            className={
                isAmber
                    ? 'fixed inset-0 z-[1100] flex items-center justify-center bg-black/50 p-4'
                    : 'fixed inset-0 z-50 bg-black/40 flex items-end md:items-center justify-center p-4'
            }
            onClick={dismissOnBackdropClick ? onCancel : undefined}
            role={dismissOnBackdropClick ? 'presentation' : undefined}
        >
            <div
                className={`bg-white rounded-xl w-full ${maxWidthClassName} overflow-hidden ${
                    isAmber ? 'shadow-2xl' : 'shadow-xl border border-neutral-200'
                }`}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={handleKeyDown}
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
            >
                {icon ? (
                    <div className="flex items-start gap-3 p-5 border-b border-neutral-100">
                        {icon}
                        <div>
                            <h3 id={titleId} className="font-semibold text-neutral-900">
                                {title}
                            </h3>
                            {children}
                        </div>
                    </div>
                ) : (
                    <div className="px-5 pt-5 pb-3">
                        <h3 id={titleId} className="text-base font-bold text-neutral-900">
                            {title}
                        </h3>
                        {children}
                    </div>
                )}
                <div className="px-5 pb-4 flex items-center justify-end gap-2">
                    <button
                        ref={cancelRef}
                        type="button"
                        onClick={onCancel}
                        className={
                            isAmber
                                ? 'px-3 py-1.5 text-sm rounded-lg bg-neutral-100 hover:bg-neutral-200 text-neutral-700 transition'
                                : 'px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-100 rounded-md transition'
                        }
                    >
                        {cancelLabel}
                    </button>
                    <button
                        type="button"
                        onClick={onConfirm}
                        disabled={confirmDisabled}
                        className={
                            isAmber
                                ? 'px-3 py-1.5 text-sm rounded-lg bg-amber-600 hover:bg-amber-700 text-white transition disabled:opacity-60'
                                : isDanger
                                    ? 'inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-red-600 text-white hover:bg-red-700 rounded-md transition disabled:opacity-60'
                                    : 'inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-indigo-600 text-white hover:bg-indigo-700 rounded-md transition disabled:opacity-60'
                        }
                    >
                        {confirmLabel}
                    </button>
                </div>
            </div>
        </div>
    );

    return portal ? createPortal(dialog, document.body) : dialog;
}
