import { useState } from 'react';
import { Check, X } from 'lucide-react';
import type { Assumption } from '../../types';

// "Review & Confirm" — the actionable replacement for the old passive
// Assumptions / Open Decisions sections. Every unresolved assumption gets an
// obvious next action: accept it as working planning context or mark it
// incorrect with an optional correction. Acceptance is deliberately not
// described as validation; consequential assumptions link to their durable
// validation record in the Decision Center.
// Decided items disappear from here and surface in the Decision Log below.
// Calm by design — these are ordinary product decisions, not warnings.

const confidenceTone: Record<string, string> = {
    high: 'bg-emerald-100 text-emerald-800',
    med: 'bg-amber-100 text-amber-800',
    low: 'bg-neutral-100 text-neutral-700',
};

function ConfidenceChip({ confidence }: { confidence?: string }) {
    if (!confidence) return null;
    const tone = confidenceTone[confidence] ?? confidenceTone.low;
    return (
        <span className={`inline-block shrink-0 text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${tone}`}>
            {confidence} confidence
        </span>
    );
}

function MaterialityLabel({ materiality }: { materiality?: Assumption['materiality'] }) {
    if (!materiality || materiality === 'normal') return null;
    const label = materiality === 'blocking' ? 'Shapes the whole plan' : materiality === 'high' ? 'High impact if wrong' : 'Low impact';
    return <span className="text-[10px] font-bold uppercase tracking-wider text-amber-700">{label}</span>;
}

interface Props {
    /** Unresolved assumptions, already sorted by confidence (highest first). */
    assumptions: Assumption[];
    /** Accept the assumption as working planning context, without validating it. */
    onConfirm: (assumptionId: string) => void;
    /** Open the exact durable PlanningRecord for consequential validation. */
    onPlanValidation?: (assumptionId: string) => void;
    /** Mark the assumption incorrect, with an optional correction/clarification. */
    onReject: (assumptionId: string, note: string) => void;
    readOnly: boolean;
    /** Section heading. Defaults to "Review & Confirm" (legacy usage). */
    title?: string;
    /** Explanatory copy under the heading. */
    description?: string;
    /** DOM id / scroll anchor. */
    id?: string;
    /** Label for the confirm action ("Confirm" | "Confirm answer" …). */
    confirmLabel?: string;
}

const requiresValidation = (assumption: Assumption): boolean =>
    assumption.materiality === undefined || assumption.materiality === 'blocking' || assumption.materiality === 'high';

export function ReviewConfirmSection({
    assumptions,
    onConfirm,
    onPlanValidation,
    onReject,
    readOnly,
    title = 'Review & Confirm',
    description = 'Synapse made these judgment calls while drafting the PRD. Confirm the ones that match your reality or correct them. Confirming records your call — it does not validate the underlying belief.',
    id = 'prd-review-confirm',
    confirmLabel = "That's right",
}: Props) {
    const [rejectingId, setRejectingId] = useState<string | null>(null);
    const [note, setNote] = useState('');

    if (assumptions.length === 0) return null;

    const startReject = (id: string) => {
        setRejectingId(id);
        setNote('');
    };

    const submitReject = (id: string) => {
        onReject(id, note.trim());
        setRejectingId(null);
        setNote('');
    };

    return (
        <div id={id} className="mb-8 scroll-mt-24">
            <div className="flex items-center gap-2 mb-3 border-b border-neutral-200 pb-2">
                <h3 className="text-lg font-extrabold text-neutral-900 tracking-tight whitespace-nowrap">
                    {title}
                </h3>
                <span className="text-[11px] text-neutral-400">{assumptions.length}</span>
            </div>
            <p className="text-sm text-neutral-600 mb-3">{description}</p>
            <ul className="space-y-2">
                {assumptions.map(a => (
                    <li key={a.id} className="rounded-lg border border-neutral-200 bg-white px-4 py-3">
                        <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-start sm:justify-between">
                            <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2"><MaterialityLabel materiality={a.materiality} /><ConfidenceChip confidence={a.confidence} /></div>
                                <p className="text-sm text-neutral-900 mt-1.5">{a.statement}</p>
                                {a.whyItMatters && <p className="mt-1 text-xs leading-5 text-neutral-500">Why it matters: {a.whyItMatters}</p>}
                                {a.affectedPrdSections && a.affectedPrdSections.length > 0 && <p className="mt-1 text-xs text-neutral-400">Affects {a.affectedPrdSections.join(', ')}</p>}
                            </div>
                            {!readOnly && rejectingId !== a.id && (
                                <div className="flex w-full shrink-0 flex-col items-stretch gap-1.5 sm:w-auto sm:items-end">
                                    <button
                                        type="button"
                                        onClick={() => onConfirm(a.id)}
                                        className="inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-800 transition hover:bg-neutral-50 sm:w-auto"
                                        aria-label={`Accept as planning context, not validated: ${a.statement}`}
                                    >
                                        <Check size={13} /> {confirmLabel}
                                    </button>
                                    {requiresValidation(a) && onPlanValidation && (
                                        <button
                                            type="button"
                                            onClick={() => onPlanValidation(a.id)}
                                            className="min-h-11 rounded-md px-3 py-1.5 text-xs font-semibold text-indigo-700 transition hover:bg-indigo-50"
                                            aria-label={`Plan validation for assumption: ${a.statement}`}
                                        >
                                            Plan validation
                                        </button>
                                    )}
                                    <button
                                        type="button"
                                        onClick={() => startReject(a.id)}
                                        className="inline-flex min-h-11 items-center justify-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium text-neutral-600 transition hover:bg-neutral-100"
                                        aria-label={`Mark assumption incorrect: ${a.statement}`}
                                    >
                                        <X size={12} /> Not right
                                    </button>
                                </div>
                            )}
                        </div>
                        {rejectingId === a.id && (
                            <div className="mt-3 space-y-2">
                                <textarea
                                    value={note}
                                    onChange={e => setNote(e.target.value)}
                                    className="w-full bg-neutral-50 border border-neutral-200 rounded-lg px-3 py-2 text-sm text-neutral-700 focus:outline-none focus:border-indigo-400 min-h-[64px]"
                                    placeholder="What's actually true? (optional)"
                                    autoFocus
                                />
                                <div className="flex justify-end gap-2">
                                    <button
                                        type="button"
                                        onClick={() => setRejectingId(null)}
                                        className="px-2.5 py-1.5 text-xs font-medium rounded-md text-neutral-500 hover:text-neutral-700 transition"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => submitReject(a.id)}
                                        className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-md bg-neutral-800 hover:bg-neutral-900 text-white transition"
                                    >
                                        Mark incorrect
                                    </button>
                                </div>
                            </div>
                        )}
                    </li>
                ))}
            </ul>
        </div>
    );
}
