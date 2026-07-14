import { useState } from 'react';
import { Check, X } from 'lucide-react';
import type { Assumption } from '../../types';

// "Review & Confirm" — the actionable replacement for the old passive
// Assumptions / Open Decisions sections. Every unresolved assumption gets an
// obvious next action: confirm it as true (green check, same visual language
// as Confirm Screen) or mark it incorrect with an optional correction.
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
    /** Confirm the assumption as true. */
    onConfirm: (assumptionId: string) => void;
    /** Mark the assumption incorrect, with an optional correction/clarification. */
    onReject: (assumptionId: string, note: string) => void;
    readOnly: boolean;
}

export function ReviewConfirmSection({ assumptions, onConfirm, onReject, readOnly }: Props) {
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
        <div id="prd-review-confirm" className="mb-8 scroll-mt-24">
            <div className="flex items-center gap-2 mb-3 border-b border-neutral-200 pb-2">
                <h3 className="text-lg font-extrabold text-neutral-900 tracking-tight whitespace-nowrap">
                    Review &amp; Confirm
                </h3>
                <span className="text-[11px] text-neutral-400">{assumptions.length}</span>
            </div>
            <p className="text-sm text-neutral-600 mb-3">
                Synapse made these assumptions while drafting the PRD. Confirm the ones that are
                right — or correct the ones that aren&rsquo;t — and they move to the Decision Log.
            </p>
            <ul className="space-y-2">
                {assumptions.map(a => (
                    <li key={a.id} className="rounded-lg border border-neutral-200 bg-white px-4 py-3">
                        <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2"><MaterialityLabel materiality={a.materiality} /><ConfidenceChip confidence={a.confidence} /></div>
                                <p className="text-sm text-neutral-900 mt-1.5">{a.statement}</p>
                                {a.whyItMatters && <p className="mt-1 text-xs leading-5 text-neutral-500">Why it matters: {a.whyItMatters}</p>}
                                {a.affectedPrdSections && a.affectedPrdSections.length > 0 && <p className="mt-1 text-xs text-neutral-400">Affects {a.affectedPrdSections.join(', ')}</p>}
                            </div>
                            {!readOnly && rejectingId !== a.id && (
                                <div className="flex items-center gap-1.5 shrink-0">
                                    <button
                                        type="button"
                                        onClick={() => onConfirm(a.id)}
                                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md bg-emerald-600 hover:bg-emerald-700 text-white transition"
                                        aria-label={`Confirm assumption: ${a.statement}`}
                                    >
                                        <Check size={13} /> Confirm
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => startReject(a.id)}
                                        className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-md bg-neutral-100 hover:bg-neutral-200 text-neutral-700 transition"
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
