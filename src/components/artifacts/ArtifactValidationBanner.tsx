import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { RefreshCcw, ShieldAlert, ShieldCheck, X } from 'lucide-react';
import type {
    AcceptArtifactValidationIssueResult,
    ArtifactValidationDisposition,
} from '../../types';
import { artifactValidationBlockerSetFingerprint } from '../../lib/artifactValidationPolicy';

interface ArtifactValidationBannerProps {
    disposition: ArtifactValidationDisposition;
    canRegenerate: boolean;
    canAccept: boolean;
    onRegenerate: () => void;
    onAccept: (input: {
        rationale: string;
        expectedBlockerFingerprint: string;
    }) => AcceptArtifactValidationIssueResult;
}

const FOCUSABLE_SELECTOR = [
    'button:not([disabled])',
    'textarea:not([disabled])',
    '[href]',
    '[tabindex]:not([tabindex="-1"])',
].join(',');

const CHANGED_REASONS = new Set([
    'artifact_not_found',
    'version_not_found',
    'not_preferred',
    'blockers_changed',
]);

export function ArtifactValidationBanner({
    disposition,
    canRegenerate,
    canAccept,
    onRegenerate,
    onAccept,
}: ArtifactValidationBannerProps) {
    const [open, setOpen] = useState(false);
    const [rationale, setRationale] = useState('');
    const [error, setError] = useState<string | null>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const bannerRef = useRef<HTMLElement>(null);
    const previousStatusRef = useRef(disposition.effectiveStatus);
    const dialogRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const headingId = useId();
    const descriptionId = useId();
    const rationaleId = useId();

    const close = useCallback(() => {
        setOpen(false);
    }, []);

    const showAcceptanceDialog = () => {
        setRationale('');
        setError(null);
        setOpen(true);
    };

    useEffect(() => {
        if (!open) return;
        textareaRef.current?.focus();
    }, [open]);

    useEffect(() => {
        if (!open) return;
        const trigger = triggerRef.current;
        const banner = bannerRef.current;

        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                close();
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
            if (trigger?.isConnected) {
                trigger.focus();
            } else {
                banner?.focus();
            }
        };
    }, [close, open]);

    const submit = () => {
        const trimmed = rationale.trim();
        if (!trimmed) return;
        setError(null);
        const result = onAccept({
            rationale: trimmed,
            expectedBlockerFingerprint:
                artifactValidationBlockerSetFingerprint(disposition.blockers),
        });
        if (result.status === 'accepted' || result.reason === 'already_accepted') {
            close();
        } else if (CHANGED_REASONS.has(result.reason)) {
            setError('This artifact changed. Review the current version before accepting an issue.');
        } else if (result.reason === 'non_overridable') {
            setError('This issue cannot be accepted and must be regenerated.');
        } else {
            setError('Enter a rationale before recording the accepted issue.');
        }
    };

    const accepted = disposition.effectiveStatus === 'accepted_issue'
        ? disposition.accepted
        : undefined;
    const canOpenAcceptance = canAccept
        && disposition.effectiveStatus === 'needs_review'
        && disposition.overridePolicy === 'rationale_required';

    useEffect(() => {
        const previousStatus = previousStatusRef.current;
        previousStatusRef.current = disposition.effectiveStatus;
        if (
            previousStatus === 'needs_review'
            && disposition.effectiveStatus === 'accepted_issue'
        ) {
            bannerRef.current?.focus();
        }
    }, [disposition.effectiveStatus]);

    return (
        <>
            <section
                ref={bannerRef}
                aria-label={accepted ? 'Accepted validation issue' : 'Artifact validation needs review'}
                tabIndex={-1}
                className={`flex items-start gap-3 rounded-xl border p-4 ${
                    accepted
                        ? 'border-sky-200 bg-sky-50'
                        : 'border-amber-200 bg-amber-50'
                }`}
            >
                {accepted && (
                    <p className="sr-only" role="status" aria-live="polite">
                        Validation issue accepted with a recorded rationale. The original failed checks remain attached.
                    </p>
                )}
                {accepted
                    ? <ShieldCheck size={18} className="mt-0.5 shrink-0 text-sky-700" aria-hidden="true" />
                    : <ShieldAlert size={18} className="mt-0.5 shrink-0 text-amber-700" aria-hidden="true" />}
                <div className="min-w-0 flex-1">
                    <p className={`text-sm font-semibold ${
                        accepted ? 'text-sky-950' : 'text-amber-950'
                    }`}>
                        {accepted
                            ? 'Accepted issue'
                            : 'Needs review — this artifact has a blocking validation issue'}
                    </p>
                    <ul className={`mt-1 list-disc space-y-0.5 pl-4 text-sm ${
                        accepted ? 'text-sky-900' : 'text-amber-900'
                    }`}>
                        {disposition.blockers.map(blocker => (
                            <li key={`${blocker.code}:${blocker.message}`}>{blocker.message}</li>
                        ))}
                    </ul>
                    {accepted ? (
                        <div className="mt-3 rounded-lg border border-sky-200 bg-white/70 p-3">
                            <p className="text-xs font-semibold uppercase tracking-wide text-sky-800">
                                Recorded rationale
                            </p>
                            <p className="mt-1 text-sm text-sky-950">{accepted.rationale}</p>
                        </div>
                    ) : (
                        <p className="mt-2 text-xs text-amber-800">
                            The original failed checks remain attached to this version.
                        </p>
                    )}
                    {(canRegenerate || canOpenAcceptance) && (
                        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                            {canRegenerate && (
                                <button
                                    type="button"
                                    onClick={onRegenerate}
                                    className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg bg-amber-700 px-3 text-xs font-semibold text-white transition hover:bg-amber-800"
                                >
                                    <RefreshCcw size={14} aria-hidden="true" />
                                    Regenerate
                                </button>
                            )}
                            {canOpenAcceptance && (
                                <button
                                    ref={triggerRef}
                                    type="button"
                                    onClick={showAcceptanceDialog}
                                    className="inline-flex min-h-11 items-center justify-center rounded-lg border border-amber-300 bg-white px-3 text-xs font-semibold text-amber-950 transition hover:bg-amber-100"
                                >
                                    Accept with noted issue
                                </button>
                            )}
                        </div>
                    )}
                </div>
            </section>

            {open && (
                <div
                    className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
                    onMouseDown={event => {
                        if (event.target === event.currentTarget) close();
                    }}
                >
                    <div
                        ref={dialogRef}
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby={headingId}
                        aria-describedby={descriptionId}
                        className="w-full rounded-t-2xl bg-white p-5 shadow-2xl sm:max-w-lg sm:rounded-2xl"
                        onMouseDown={event => event.stopPropagation()}
                    >
                        <div className="flex items-start justify-between gap-4">
                            <div>
                                <h2 id={headingId} className="text-base font-semibold text-neutral-950">
                                    Accept with noted issue
                                </h2>
                                <p id={descriptionId} className="mt-1 text-sm text-neutral-600">
                                    Record why this exact artifact version is safe to use.
                                    The failed checks will remain visible.
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={close}
                                aria-label="Close acceptance dialog"
                                className="-m-2 inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800"
                            >
                                <X size={18} aria-hidden="true" />
                            </button>
                        </div>

                        <label
                            htmlFor={rationaleId}
                            className="mt-5 block text-sm font-medium text-neutral-800"
                        >
                            Why is this output safe to use?
                        </label>
                        <textarea
                            ref={textareaRef}
                            id={rationaleId}
                            value={rationale}
                            onChange={event => setRationale(event.target.value)}
                            rows={4}
                            className="mt-2 min-h-11 w-full resize-y rounded-lg border border-neutral-300 px-3 py-2 text-sm text-neutral-950 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                        />
                        {error && (
                            <p role="alert" className="mt-3 text-sm font-medium text-red-700">
                                {error}
                            </p>
                        )}
                        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                            <button
                                type="button"
                                onClick={close}
                                className="min-h-11 rounded-lg border border-neutral-200 px-4 text-sm font-semibold text-neutral-700 hover:bg-neutral-50"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                disabled={!rationale.trim()}
                                onClick={submit}
                                className="min-h-11 rounded-lg bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                Record accepted issue
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
