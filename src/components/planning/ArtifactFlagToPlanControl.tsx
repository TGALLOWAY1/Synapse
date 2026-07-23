import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { FlagPlanningConcernResult } from '../../lib/planning/flagToPlan';

export interface ArtifactFlagToPlanControlProps {
    artifactTitle: string;
    onCreate: (input: {
        title: string;
        statement: string;
    }) => FlagPlanningConcernResult;
    onReviewNow?: (recordId: string) => void;
}

const FOCUSABLE_SELECTOR = [
    'button:not([disabled])',
    '[href]',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
].join(', ');

function rejectionCopy(result: Extract<FlagPlanningConcernResult, { status: 'rejected' }>): string {
    if (result.reason === 'source_changed') {
        return 'This artifact changed since you opened it. Review the latest version, then try again.';
    }
    return 'This artifact source is no longer available. Close this dialog and open the current artifact to try again.';
}

export function ArtifactFlagToPlanControl({
    artifactTitle,
    onCreate,
    onReviewNow,
}: ArtifactFlagToPlanControlProps) {
    const [open, setOpen] = useState(false);
    const [title, setTitle] = useState('');
    const [statement, setStatement] = useState('');
    const [result, setResult] = useState<FlagPlanningConcernResult | null>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const dialogRef = useRef<HTMLDivElement>(null);
    const titleRef = useRef<HTMLInputElement>(null);
    const headingId = useId();
    const titleId = useId();
    const statementId = useId();

    const closeDialog = useCallback(() => {
        setOpen(false);
    }, []);

    const openDialog = () => {
        setResult(null);
        setOpen(true);
    };

    useEffect(() => {
        if (open && result === null) titleRef.current?.focus();
    }, [open, result]);

    useEffect(() => {
        if (!open) return;
        const trigger = triggerRef.current;

        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                closeDialog();
                return;
            }
            if (event.key !== 'Tab' || !dialogRef.current) return;

            const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>(
                FOCUSABLE_SELECTOR,
            )];
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

        window.addEventListener('keydown', onKeyDown);
        return () => {
            window.removeEventListener('keydown', onKeyDown);
            trigger?.focus();
        };
    }, [closeDialog, open]);

    const submitConcern = () => {
        const trimmedTitle = title.trim();
        const trimmedStatement = statement.trim();
        if (!trimmedTitle || !trimmedStatement || (result && result.status !== 'rejected')) {
            return;
        }
        setResult(onCreate({
            title: trimmedTitle,
            statement: trimmedStatement,
        }));
    };

    const acceptedResult = result?.status === 'created' || result?.status === 'existing'
        ? result
        : null;

    return (
        <>
            <button
                ref={triggerRef}
                type="button"
                aria-label={`Flag ${artifactTitle} to plan`}
                onClick={openDialog}
                className="inline-flex min-h-11 items-center justify-center rounded-md border border-neutral-200 bg-white px-3 text-xs font-medium text-neutral-700 transition hover:bg-neutral-50"
            >
                Flag to plan
            </button>

            {open && (
                <div
                    role="presentation"
                    className="fixed inset-0 z-[1200] flex items-end bg-black/50 sm:items-center sm:justify-center sm:p-4"
                    onMouseDown={(event) => {
                        if (event.target === event.currentTarget) closeDialog();
                    }}
                >
                    <div
                        ref={dialogRef}
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby={headingId}
                        className="w-full max-w-md rounded-t-2xl bg-white p-5 text-neutral-900 shadow-2xl sm:rounded-2xl"
                    >
                        <div className="flex items-start justify-between gap-4">
                            <div className="min-w-0">
                                <h2 id={headingId} className="text-lg font-semibold">
                                    Flag {artifactTitle} to plan
                                </h2>
                                <p className="mt-1 text-sm leading-5 text-neutral-600">
                                    Capture a concern without leaving this artifact.
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={closeDialog}
                                className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-lg px-3 text-sm font-medium text-neutral-600 hover:bg-neutral-100"
                            >
                                Close
                            </button>
                        </div>

                        {acceptedResult ? (
                            <div className="mt-5">
                                <div
                                    role="status"
                                    aria-live="polite"
                                    className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900"
                                >
                                    <p className="font-semibold">
                                        {acceptedResult.status === 'created'
                                            ? 'Added to plan.'
                                            : 'Already in plan.'}
                                    </p>
                                    <p className="mt-1 text-emerald-800">
                                        You can keep reviewing here or open the planning record now.
                                    </p>
                                </div>
                                <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:justify-end">
                                    <button
                                        type="button"
                                        onClick={() => setResult(null)}
                                        className="min-h-11 w-full rounded-lg border border-neutral-200 px-4 text-sm font-medium text-neutral-700 hover:bg-neutral-50 sm:w-auto"
                                    >
                                        Keep reviewing
                                    </button>
                                    {onReviewNow && (
                                        <button
                                            type="button"
                                            onClick={() => onReviewNow(acceptedResult.planningRecordId)}
                                            className="min-h-11 w-full rounded-lg bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-700 sm:w-auto"
                                        >
                                            Review now
                                        </button>
                                    )}
                                </div>
                            </div>
                        ) : (
                            <form
                                className="mt-5 space-y-4"
                                onSubmit={(event) => {
                                    event.preventDefault();
                                    submitConcern();
                                }}
                            >
                                <div>
                                    <label htmlFor={titleId} className="text-sm font-medium text-neutral-800">
                                        Concern title
                                    </label>
                                    <input
                                        ref={titleRef}
                                        id={titleId}
                                        value={title}
                                        onChange={(event) => setTitle(event.target.value)}
                                        className="mt-1 min-h-11 w-full rounded-lg border border-neutral-300 px-3 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                                    />
                                </div>
                                <div>
                                    <label htmlFor={statementId} className="text-sm font-medium text-neutral-800">
                                        What should the plan address?
                                    </label>
                                    <textarea
                                        id={statementId}
                                        value={statement}
                                        onChange={(event) => setStatement(event.target.value)}
                                        rows={4}
                                        className="mt-1 min-h-11 w-full resize-y rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                                    />
                                </div>

                                {result?.status === 'rejected' && (
                                    <div
                                        role="alert"
                                        className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
                                    >
                                        {rejectionCopy(result)}
                                    </div>
                                )}

                                <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
                                    <button
                                        type="submit"
                                        disabled={!title.trim() || !statement.trim()}
                                        className="min-h-11 w-full rounded-lg bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
                                    >
                                        Add to plan
                                    </button>
                                </div>
                            </form>
                        )}
                    </div>
                </div>
            )}
        </>
    );
}
