import { useId, type ReactNode } from 'react';

export type ConfirmDialogTone = 'default' | 'amber';

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
     * amber confirm button, no backdrop-dismiss).
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
}

/**
 * Shared presentational confirm modal — a fixed-inset backdrop + centered
 * white card + Cancel/Confirm button row. Extracted from five duplicated
 * inline overlays (ArtifactWorkspace mockup/design regenerate + missing
 * mockups, DependencyGraphView update, ProjectWorkspace incomplete-PRD gate).
 * Bespoke per-call-site copy/content goes in as `children`.
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
}: ConfirmDialogProps) {
    const titleId = useId();
    const isAmber = tone === 'amber';

    return (
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
                                : 'inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-indigo-600 text-white hover:bg-indigo-700 rounded-md transition disabled:opacity-60'
                        }
                    >
                        {confirmLabel}
                    </button>
                </div>
            </div>
        </div>
    );
}
