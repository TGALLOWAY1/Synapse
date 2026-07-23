import { useEffect, useRef, useState } from 'react';
import {
    AlertTriangle,
    ArrowRight,
    CheckCircle2,
    ChevronDown,
    Circle,
    Clock3,
    History,
    ShieldAlert,
    X,
} from 'lucide-react';
import { projectCommitmentCopy } from '../../lib/planning/planningLanguage';

export type ReadinessCheckpointEvidenceView = {
    id: string;
    summary: string;
    quality: 'direct' | 'inferred' | 'incomplete';
    sourceLabel?: string;
};

export type ReadinessCheckpointCriterionView = {
    id: string;
    label: string;
    status: 'met' | 'attention' | 'not_started';
    explanation: string;
    evidence: ReadinessCheckpointEvidenceView[];
};

export type ReadinessCheckpointConcernView = {
    id: string;
    title: string;
    detail: string;
    consequence?: string;
    severity: 'attention' | 'blocker';
    /** Only explicit materiality='blocking' planning records may stop
     * Finalize. Broader readiness blockers remain checkpoint warnings. */
    hardBlocking?: boolean;
    actionLabel?: string;
};

export type ReadinessCheckpointCommitmentView = {
    kind: 'ready' | 'with_open_questions';
    committedAt: number;
    rationale?: string;
    containment?: string;
    acceptedConcernCount?: number;
    reopenedAt?: number;
};

export type ReadinessCheckpointView = {
    id: string;
    versionLabel: string;
    capturedAt: number;
    conclusion: 'ready_to_build' | 'not_ready';
    isCurrent: boolean;
    integrityValid: boolean;
    currentnessReasons?: string[];
    concerns: ReadinessCheckpointConcernView[];
    criteria: ReadinessCheckpointCriterionView[];
    caveats: string[];
    hardBlockerCount?: number;
    commitment?: ReadinessCheckpointCommitmentView;
    priorCommitment?: ReadinessCheckpointCommitmentView;
    comparisonSummary?: string[];
};

export type ReadinessOverrideInput = {
    rationale: string;
    containment?: string;
};

interface ReadinessCheckpointProps {
    review: ReadinessCheckpointView;
    initialConcernId?: string;
    readOnly?: boolean;
    submitting?: boolean;
    submitError?: string | null;
    onClose: () => void;
    onAddressConcern?: (concernId: string) => void;
    onRefresh?: () => void;
    onCommitReady?: () => void;
    onCommitWithOpenQuestions?: (input: ReadinessOverrideInput) => void;
}

const MIN_RATIONALE_LENGTH = 20;

const statusIcon = (status: ReadinessCheckpointCriterionView['status']) => {
    if (status === 'met') return <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-emerald-600" />;
    if (status === 'attention') return <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-600" />;
    return <Circle size={16} className="mt-0.5 shrink-0 text-neutral-400" />;
};

export function ReadinessCheckpoint({
    review,
    initialConcernId,
    readOnly = false,
    submitting = false,
    submitError,
    onClose,
    onAddressConcern,
    onRefresh,
    onCommitReady,
    onCommitWithOpenQuestions,
}: ReadinessCheckpointProps) {
    const [showOverride, setShowOverride] = useState(false);
    const [rationale, setRationale] = useState('');
    const [attemptedSubmit, setAttemptedSubmit] = useState(false);
    const overrideSectionRef = useRef<HTMLElement>(null);
    const rationaleRef = useRef<HTMLTextAreaElement>(null);
    const dialogRef = useRef<HTMLElement>(null);
    const closeRef = useRef<HTMLButtonElement>(null);
    const onCloseRef = useRef(onClose);

    useEffect(() => {
        onCloseRef.current = onClose;
    }, [onClose]);

    useEffect(() => {
        const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        closeRef.current?.focus();
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                onCloseRef.current();
                return;
            }
            if (event.key !== 'Tab' || !dialogRef.current) return;
            const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>(
                'button:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
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
            previouslyFocused?.focus();
        };
    }, []);

    useEffect(() => {
        if (!initialConcernId || !review.concerns.some(concern => concern.id === initialConcernId)) return;
        window.requestAnimationFrame(() => {
            document.getElementById(`readiness-concern-${initialConcernId}`)?.scrollIntoView({ block: 'center' });
        });
    }, [initialConcernId, review.concerns]);

    const rationaleValid = rationale.trim().length >= MIN_RATIONALE_LENGTH;
    const hardBlockerCount = review.hardBlockerCount
        ?? review.concerns.filter(concern => concern.hardBlocking).length;
    const nextConcern = review.concerns.find(concern => concern.hardBlocking)
        ?? review.concerns[0];
    const historical = readOnly || !review.isCurrent || !review.integrityValid;
    const ready = hardBlockerCount === 0;

    useEffect(() => {
        if (!showOverride) return;
        window.requestAnimationFrame(() => {
            if (typeof overrideSectionRef.current?.scrollIntoView === 'function') {
                overrideSectionRef.current.scrollIntoView({ block: 'start', behavior: 'smooth' });
            }
            rationaleRef.current?.focus({ preventScroll: true });
        });
    }, [showOverride]);

    const submitOverride = () => {
        setAttemptedSubmit(true);
        if (!rationaleValid || !onCommitWithOpenQuestions) return;
        onCommitWithOpenQuestions({ rationale: rationale.trim() });
    };

    const outcomeLabel = !review.integrityValid
        ? projectCommitmentCopy('needs_fresh_review').label
        : !review.isCurrent
            ? review.commitment?.kind === 'with_open_questions'
                ? 'Previously proceeded with accepted risk'
                : review.commitment?.kind === 'ready'
                    ? 'Previously committed'
                    : ready
                        ? 'Previously ready to build'
                        : 'Previously not ready'
        : review.commitment?.kind === 'with_open_questions'
        ? projectCommitmentCopy('proceeding_with_accepted_risk').label
        : review.commitment?.kind === 'ready'
            ? 'Plan committed'
            : ready
                ? 'Ready to finalize'
                : 'Blocking decisions need attention';

    return (
        <div
            className="fixed inset-0 z-[1100] flex items-end bg-black/50 sm:items-center sm:justify-center sm:p-4"
            role="presentation"
            onMouseDown={(event) => {
                if (event.target === event.currentTarget) onClose();
            }}
        >
            <section
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby="readiness-checkpoint-title"
                className="flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-2xl bg-white text-neutral-900 shadow-2xl sm:max-w-2xl sm:rounded-2xl"
            >
                <header className="sticky top-0 z-10 flex shrink-0 items-start justify-between gap-4 border-b border-neutral-100 bg-white px-4 py-4 sm:px-6">
                    <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-neutral-500">
                            <span>Readiness review</span>
                            <span aria-hidden="true">·</span>
                            <span>{review.versionLabel}</span>
                            {!review.integrityValid ? (
                                <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-1 text-red-700">
                                    <ShieldAlert size={12} /> Fresh review needed
                                </span>
                            ) : !review.isCurrent && (
                                <span className="inline-flex items-center gap-1 rounded-full bg-neutral-100 px-2 py-1 text-neutral-600">
                                    <History size={12} /> Historical
                                </span>
                            )}
                        </div>
                        <h2 id="readiness-checkpoint-title" className="mt-1 text-xl font-bold tracking-tight">
                            {outcomeLabel}
                        </h2>
                        <p className="mt-1 flex items-center gap-1.5 text-xs text-neutral-500">
                            <Clock3 size={12} />
                            Reviewed {new Date(review.capturedAt).toLocaleString()}
                        </p>
                    </div>
                    <button
                        ref={closeRef}
                        type="button"
                        onClick={onClose}
                        aria-label="Close readiness review"
                        className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-xl text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800"
                    >
                        <X size={19} />
                    </button>
                </header>

                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-5 sm:px-6">
                    {!review.integrityValid ? (
                        <div role="alert" className="mb-5 rounded-xl border border-red-200 bg-red-50 p-4 text-red-950">
                            <p className="font-semibold">This checkpoint needs a fresh review.</p>
                            <p className="mt-1 text-sm leading-6 text-red-800">
                                Synapse cannot safely rely on this saved checkpoint. Review the current plan before committing.
                            </p>
                            <details className="mt-3">
                                <summary className="min-h-10 cursor-pointer py-2 text-sm font-semibold text-red-900">Technical details</summary>
                                <p className="text-sm leading-6 text-red-800">
                                    The saved contents no longer match the checkpoint integrity record, so its conclusion and commitment are not authoritative.
                                </p>
                                {(review.currentnessReasons?.length ?? 0) > 0 && (
                                    <ul className="mt-2 space-y-1 text-sm text-red-800">
                                        {review.currentnessReasons!.map(reason => <li key={reason}>• {reason}</li>)}
                                    </ul>
                                )}
                            </details>
                        </div>
                    ) : !review.isCurrent && (
                        <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-950">
                            <p className="font-semibold">This checkpoint no longer represents the current plan.</p>
                            <p className="mt-1 text-sm leading-6 text-amber-800">
                                It remains available as the reasoning recorded for {review.versionLabel}.
                            </p>
                            {(review.currentnessReasons?.length ?? 0) > 0 && (
                                <ul className="mt-2 space-y-1 text-sm text-amber-800">
                                    {review.currentnessReasons!.map(reason => <li key={reason}>• {reason}</li>)}
                                </ul>
                            )}
                        </div>
                    )}

                    {submitError && (
                        <div role="alert" className="mb-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
                            <p className="font-semibold">The plan changed before commitment could be recorded.</p>
                            <p className="mt-1">{submitError}</p>
                        </div>
                    )}

                    {review.comparisonSummary && review.comparisonSummary.length > 0 && (
                        <details className="group mb-5 rounded-xl border border-neutral-200 bg-neutral-50 p-4">
                            <summary className="flex min-h-10 cursor-pointer list-none items-center gap-2 text-sm font-semibold text-neutral-800">
                                <ChevronDown size={15} className="transition group-open:rotate-180" />
                                What changed after this checkpoint
                            </summary>
                            <ul className="mt-2 space-y-2 text-sm leading-6 text-neutral-600">
                                {review.comparisonSummary.map(item => <li key={item}>• {item}</li>)}
                            </ul>
                        </details>
                    )}

                    {review.concerns.length > 0 ? (
                        <section aria-labelledby="readiness-open-items-heading">
                            <div className="flex items-center justify-between gap-3">
                                <div>
                                    <h3 id="readiness-open-items-heading" className="font-bold text-neutral-900">Needs attention</h3>
                                    <p className="mt-1 text-sm text-neutral-600">
                                        {review.concerns.length} open item{review.concerns.length === 1 ? ' remains' : 's remain'} part of this assessment.
                                    </p>
                                </div>
                            </div>
                            <div className="mt-3 space-y-3">
                                {review.concerns.map(concern => (
                                    <article id={`readiness-concern-${concern.id}`} key={concern.id} className="scroll-mt-20 rounded-xl border border-neutral-200 p-4">
                                        <div className="flex items-start gap-3">
                                            {concern.hardBlocking
                                                ? <ShieldAlert size={18} className="mt-0.5 shrink-0 text-red-600" />
                                                : <AlertTriangle size={18} className="mt-0.5 shrink-0 text-amber-600" />}
                                            <div className="min-w-0 flex-1">
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <h4 className="font-semibold text-neutral-900">{concern.title}</h4>
                                                    {concern.hardBlocking && (
                                                        <span className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-red-700">Finalize blocker</span>
                                                    )}
                                                    {concern.id === nextConcern?.id && (
                                                        <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-indigo-700">Recommended next</span>
                                                    )}
                                                </div>
                                                <p className="mt-1 text-sm leading-6 text-neutral-600">{concern.detail}</p>
                                                {concern.consequence && (
                                                    <p className="mt-2 text-xs leading-5 text-neutral-500">Why it matters: {concern.consequence}</p>
                                                )}
                                                {!historical && concern.actionLabel && onAddressConcern && (
                                                    <button
                                                        type="button"
                                                        onClick={() => onAddressConcern(concern.id)}
                                                        className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-neutral-200 px-3 text-sm font-semibold text-neutral-800 hover:bg-neutral-50 sm:w-auto"
                                                    >
                                                        {concern.actionLabel}<ArrowRight size={14} />
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    </article>
                                ))}
                            </div>
                        </section>
                    ) : (
                        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-950">
                            <div className="flex items-start gap-3">
                                <CheckCircle2 size={19} className="mt-0.5 shrink-0 text-emerald-600" />
                                <div>
                                    <p className="font-semibold">No readiness blocker remains in this checkpoint.</p>
                                    <p className="mt-1 text-sm leading-6 text-emerald-800">The current reasoning foundation is explicit, challenged, and aligned.</p>
                                </div>
                            </div>
                        </div>
                    )}

                    {review.commitment?.kind === 'with_open_questions' && review.commitment.rationale && (
                        <section className="mt-5 rounded-xl border border-indigo-200 bg-indigo-50 p-4" aria-labelledby="accepted-risk-heading">
                            <h3 id="accepted-risk-heading" className="font-semibold text-indigo-950">Accepted for this commitment</h3>
                            <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-indigo-700">
                                {review.commitment.acceptedConcernCount ?? review.concerns.length} open item{(review.commitment.acceptedConcernCount ?? review.concerns.length) === 1 ? '' : 's'} accepted
                            </p>
                            <p className="mt-3 text-sm leading-6 text-indigo-900">{review.commitment.rationale}</p>
                            {review.commitment.containment && (
                                <div className="mt-3 border-t border-indigo-200 pt-3">
                                    <p className="text-xs font-bold uppercase tracking-wide text-indigo-700">Risk containment</p>
                                    <p className="mt-1 text-sm leading-6 text-indigo-900">{review.commitment.containment}</p>
                                </div>
                            )}
                        </section>
                    )}

                    {review.priorCommitment && (
                        <section className="mt-5 rounded-xl border border-neutral-200 bg-neutral-50 p-4" aria-labelledby="prior-commitment-heading">
                            <h3 id="prior-commitment-heading" className="font-semibold text-neutral-900">Previously committed, then reopened</h3>
                            <p className="mt-1 text-xs text-neutral-500">
                                Reopened {review.priorCommitment.reopenedAt ? new Date(review.priorCommitment.reopenedAt).toLocaleString() : 'after this commitment'}.
                            </p>
                            {review.priorCommitment.rationale && (
                                <p className="mt-3 text-sm leading-6 text-neutral-700">{review.priorCommitment.rationale}</p>
                            )}
                        </section>
                    )}

                    {review.caveats.length > 0 && (
                        <section className="mt-5 rounded-xl bg-neutral-50 p-4" aria-labelledby="readiness-caveats-heading">
                            <h3 id="readiness-caveats-heading" className="text-sm font-semibold text-neutral-800">Known limits of this review</h3>
                            <ul className="mt-2 space-y-1 text-sm leading-6 text-neutral-600">
                                {review.caveats.map(caveat => <li key={caveat}>• {caveat}</li>)}
                            </ul>
                        </section>
                    )}

                    <details className="mt-5 group rounded-xl border border-neutral-200">
                        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-semibold text-neutral-800">
                            <ChevronDown size={15} className="transition group-open:rotate-180" />
                            Criteria and supporting evidence
                        </summary>
                        <div className="space-y-3 border-t border-neutral-100 p-4">
                            {review.criteria.map(criterion => (
                                <article key={criterion.id} className="rounded-lg bg-neutral-50 p-3">
                                    <div className="flex items-start gap-2">
                                        {statusIcon(criterion.status)}
                                        <div className="min-w-0">
                                            <p className="text-sm font-semibold text-neutral-900">{criterion.label}</p>
                                            <p className="mt-1 text-xs leading-5 text-neutral-600">{criterion.explanation}</p>
                                        </div>
                                    </div>
                                    {criterion.evidence.length > 0 && (
                                        <ul className="mt-3 space-y-2 border-l-2 border-neutral-200 pl-3">
                                            {criterion.evidence.map(evidence => (
                                                <li key={evidence.id} className="text-xs leading-5 text-neutral-600">
                                                    <span className="font-semibold text-neutral-700">{evidence.sourceLabel ?? 'Evidence'}:</span> {evidence.summary}
                                                    {evidence.quality !== 'direct' && (
                                                        <span className="ml-1 text-neutral-400">({evidence.quality})</span>
                                                    )}
                                                </li>
                                            ))}
                                        </ul>
                                    )}
                                </article>
                            ))}
                        </div>
                    </details>

                    {!historical && !ready && showOverride && (
                        <section ref={overrideSectionRef} className="scroll-mt-4 mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4" aria-labelledby="override-heading">
                            <h3 id="override-heading" className="font-semibold text-amber-950">Finalize with accepted risk</h3>
                            <p className="mt-1 text-sm leading-6 text-amber-800">
                                This records your decision to proceed past {hardBlockerCount} explicit blocking item{hardBlockerCount === 1 ? '' : 's'}.
                                It does not resolve the planning records above.
                            </p>
                            <label className="mt-4 block text-sm font-semibold text-amber-950" htmlFor="readiness-rationale">Why proceed now?</label>
                            <textarea
                                ref={rationaleRef}
                                id="readiness-rationale"
                                value={rationale}
                                onChange={event => setRationale(event.target.value)}
                                rows={3}
                                placeholder="Explain why proceeding is worth the remaining uncertainty."
                                className="mt-2 w-full rounded-xl border border-amber-300 bg-white px-3 py-2 text-sm leading-6 outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-200"
                            />
                            {attemptedSubmit && !rationaleValid && (
                                <p className="mt-1 text-xs font-medium text-red-700">Provide a meaningful rationale of at least {MIN_RATIONALE_LENGTH} characters.</p>
                            )}
                        </section>
                    )}
                </div>

                {!historical && !review.commitment && (
                    <footer className="sticky bottom-0 z-10 shrink-0 border-t border-neutral-100 bg-white p-4 sm:px-6">
                        {ready ? (
                            <button
                                type="button"
                                onClick={onCommitReady}
                                disabled={submitting || !onCommitReady}
                                className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-neutral-950 px-4 text-sm font-semibold text-white hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                {submitting ? 'Finalizing plan…' : 'Finalize plan'}
                            </button>
                        ) : showOverride ? (
                            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                                <button
                                    type="button"
                                    onClick={() => setShowOverride(false)}
                                    disabled={submitting}
                                    className="min-h-11 w-full rounded-xl border border-neutral-200 px-4 text-sm font-semibold text-neutral-700 hover:bg-neutral-50 sm:w-auto"
                                >
                                    Back to open items
                                </button>
                                <button
                                    type="button"
                                    onClick={submitOverride}
                                    disabled={submitting}
                                    className="min-h-11 w-full rounded-xl bg-amber-700 px-4 text-sm font-semibold text-white hover:bg-amber-800 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
                                >
                                    {submitting ? 'Finalizing plan…' : `Finalize with ${hardBlockerCount} accepted blocker${hardBlockerCount === 1 ? '' : 's'}`}
                                </button>
                            </div>
                        ) : (
                            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                <button
                                    type="button"
                                    onClick={() => setShowOverride(true)}
                                    className="min-h-11 w-full px-2 text-sm font-semibold text-neutral-600 underline decoration-neutral-300 underline-offset-4 hover:text-neutral-900 sm:w-auto"
                                >
                                    Finalize with accepted risk
                                </button>
                                <button
                                    type="button"
                                    onClick={() => nextConcern && onAddressConcern?.(nextConcern.id)}
                                    disabled={!nextConcern || !onAddressConcern}
                                    className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-neutral-950 px-4 text-sm font-semibold text-white hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
                                >
                                    {nextConcern?.actionLabel ?? 'Address next open item'}<ArrowRight size={15} />
                                </button>
                            </div>
                        )}
                    </footer>
                )}

                {(!review.isCurrent || !review.integrityValid) && onRefresh && !readOnly && (
                    <footer className="sticky bottom-0 z-10 shrink-0 border-t border-neutral-100 bg-white p-4 sm:px-6">
                        <button type="button" onClick={onRefresh} className="min-h-11 w-full rounded-xl bg-neutral-950 px-4 text-sm font-semibold text-white hover:bg-neutral-800">
                            Review current plan
                        </button>
                    </footer>
                )}
            </section>
        </div>
    );
}
