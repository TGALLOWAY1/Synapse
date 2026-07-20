import { useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Clock3, PencilLine, Sparkles, X } from 'lucide-react';
import type { PlanningRecord } from '../../types';
import type { DecisionAction } from '../review/DecisionCenter';

type SharpenOutcome = 'confirmed' | 'corrected' | 'deferred';

interface Props {
    /** Answerable assumption records, frozen in order at flow start. */
    records: PlanningRecord[];
    /** Same contract as the Decision Center: every verdict is an append-only
     * user DecisionEvent. Confirm mirrors the Decision Center's assumption
     * accept (statement as the recorded answer); a correction rides the
     * reject-premise path; "Not sure yet" defers. */
    onDecide: (recordId: string, action: DecisionAction, value?: string, rationale?: string) => void;
    onClose: () => void;
    onOpenRecord?: (recordId: string) => void;
}

/**
 * The Plan stage's guided elicitation flow: one plain-language question per
 * assumption Synapse made while drafting, answered with quick chips instead of
 * validation jargon. Presentation-only — verdicts flow through the exact same
 * decision-event path the Decision Center uses, so answering here carries
 * identical rigor (user-only authority, acceptance is never validation).
 */
export function SharpenPlanFlow({ records, onDecide, onClose, onOpenRecord }: Props) {
    const [index, setIndex] = useState(0);
    const [outcomes, setOutcomes] = useState<Record<string, SharpenOutcome>>({});
    const [correcting, setCorrecting] = useState(false);
    const [correction, setCorrection] = useState('');

    const total = records.length;
    const done = index >= total;
    const current = done ? undefined : records[index];

    const advance = () => {
        setCorrecting(false);
        setCorrection('');
        setIndex(value => value + 1);
    };

    const decide = (record: PlanningRecord, action: DecisionAction, outcome: SharpenOutcome, value?: string) => {
        onDecide(record.id, action, value, undefined);
        setOutcomes(existing => ({ ...existing, [record.id]: outcome }));
        advance();
    };

    if (done || !current) {
        const confirmed = records.filter(record => outcomes[record.id] === 'confirmed').length;
        const corrected = records.filter(record => outcomes[record.id] === 'corrected').length;
        const deferred = records.filter(record => outcomes[record.id] === 'deferred').length;
        const skipped = total - confirmed - corrected - deferred;
        return (
            <section className="mb-5 rounded-2xl border border-neutral-200 bg-white p-4 sm:p-5" aria-label="Sharpening complete">
                <h2 className="flex items-center gap-2 text-lg font-bold tracking-tight text-neutral-950">
                    <Sparkles size={16} className="shrink-0 text-indigo-500" aria-hidden="true" />
                    {total === 0 ? 'Nothing needs an answer right now' : 'Nicely sharpened.'}
                </h2>
                {total > 0 && (
                    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-sm font-semibold text-neutral-700">
                        {confirmed > 0 && <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden="true" />{confirmed} confirmed</span>}
                        {corrected > 0 && <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-indigo-500" aria-hidden="true" />{corrected} corrected — plan alignment queued</span>}
                        {deferred > 0 && <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-neutral-300" aria-hidden="true" />{deferred} to revisit</span>}
                        {skipped > 0 && <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-neutral-200" aria-hidden="true" />{skipped} skipped</span>}
                    </div>
                )}
                <p className="mt-2 text-xs leading-5 text-neutral-500">Answers are recorded as your calls — not independently validated. The full reasoning log stays in the Decision Center.</p>
                <button type="button" onClick={onClose} className="mt-4 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-500">
                    Done
                </button>
            </section>
        );
    }

    const statement = current.statement?.trim() || current.title;
    const why = current.whyItMatters?.trim();

    return (
        <section className="mb-5 rounded-2xl border border-neutral-200 bg-white p-4 sm:p-5" aria-label={`Question ${index + 1} of ${total}`}>
            <div className="flex items-center gap-3">
                <p className="shrink-0 text-[11px] font-bold uppercase tracking-wider text-neutral-500">Question {index + 1} of {total}</p>
                <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-neutral-100" aria-hidden="true">
                    <div className="h-full rounded-full bg-indigo-500 transition-all" style={{ width: `${(index / total) * 100}%` }} />
                </div>
                <button type="button" onClick={onClose} aria-label="Close sharpening" className="shrink-0 rounded-lg p-2 text-neutral-400 hover:bg-neutral-50 hover:text-neutral-700">
                    <X size={16} />
                </button>
            </div>
            <p className="mt-4 text-[11px] font-bold uppercase tracking-wider text-neutral-500">Synapse assumed</p>
            <p className="mt-1 max-w-2xl text-base font-semibold leading-6 text-neutral-950">{statement}</p>
            {why && <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-600">Why it matters: {why}</p>}
            <p className="mt-3 text-sm font-medium text-neutral-800">Does this match your reality?</p>
            <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" onClick={() => decide(current, 'confirm', 'confirmed', statement)} className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-4 text-sm font-semibold text-emerald-800 hover:bg-emerald-100">
                    <Check size={14} /> Sounds right
                </button>
                <button type="button" onClick={() => setCorrecting(true)} className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-neutral-200 bg-white px-4 text-sm font-semibold text-neutral-700 hover:border-indigo-300 hover:bg-indigo-50/50">
                    <PencilLine size={14} /> Not quite — correct it
                </button>
                <button type="button" onClick={() => decide(current, 'defer', 'deferred')} className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-neutral-200 bg-white px-4 text-sm font-semibold text-neutral-700 hover:bg-neutral-50">
                    <Clock3 size={14} /> Not sure yet
                </button>
            </div>
            {correcting && (
                <div className="mt-3 max-w-2xl">
                    <textarea
                        value={correction}
                        onChange={event => setCorrection(event.target.value)}
                        rows={3}
                        placeholder="What should replace this assumption?"
                        className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                    />
                    <div className="mt-2 flex flex-wrap gap-2">
                        <button type="button" disabled={!correction.trim()} onClick={() => decide(current, 'reject', 'corrected', correction.trim())} className="min-h-11 rounded-lg bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-40">
                            Save correction
                        </button>
                        <button type="button" onClick={() => { setCorrecting(false); setCorrection(''); }} className="min-h-11 rounded-lg border border-neutral-200 px-4 text-sm font-medium text-neutral-700 hover:bg-neutral-50">
                            Never mind
                        </button>
                    </div>
                </div>
            )}
            <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-neutral-100 pt-3 text-sm font-medium text-neutral-500">
                {index > 0 && (
                    <button type="button" onClick={() => { setCorrecting(false); setCorrection(''); setIndex(index - 1); }} className="inline-flex min-h-10 items-center gap-1 hover:text-neutral-800">
                        <ArrowLeft size={14} /> Back
                    </button>
                )}
                <button type="button" onClick={advance} className="inline-flex min-h-10 items-center gap-1 hover:text-neutral-800">
                    Skip <ArrowRight size={14} />
                </button>
                {onOpenRecord && (
                    <button type="button" onClick={() => onOpenRecord(current.id)} className="min-h-10 underline decoration-neutral-300 underline-offset-4 hover:text-neutral-800 hover:decoration-neutral-500">
                        View full detail
                    </button>
                )}
            </div>
        </section>
    );
}
