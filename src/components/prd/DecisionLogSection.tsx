import { Check, X, Undo2, Clock } from 'lucide-react';
import type { DecisionLogEntry } from '../../lib/derive/prdDecisions';
import { FeatureIdBadge } from './FeatureIdBadge';
import { isDisplayableFeatureId } from '../../lib/derive/prdDecisions';

// Decision Log — the record of decided scope (accepted/corrected assumptions,
// confirmed features, and deferred work). Deliberately separate from the
// unresolved "Review & Confirm" items above it: everything here has been
// decided. Deferred features/scope items appear ONLY here — no other PRD
// section presents features outside the MVP/V1 phases. Derived read-side
// (deriveDecisionLog); never persisted as its own structure.

function VerdictIcon({ entry }: { entry: DecisionLogEntry }) {
    if (entry.verdict === 'confirmed' && entry.kind === 'feature') {
        return (
            <span className="inline-flex items-center justify-center h-5 w-5 rounded-full bg-emerald-100 shrink-0">
                <Check size={13} className="text-emerald-700" aria-hidden />
            </span>
        );
    }
    if (entry.verdict === 'confirmed') {
        return (
            <span className="inline-flex items-center justify-center h-5 w-5 rounded-full bg-amber-100 shrink-0">
                <Check size={13} className="text-amber-700" aria-hidden />
            </span>
        );
    }
    if (entry.verdict === 'deferred') {
        return (
            <span className="inline-flex items-center justify-center h-5 w-5 rounded-full bg-neutral-100 shrink-0">
                <Clock size={13} className="text-neutral-500" aria-hidden />
            </span>
        );
    }
    return (
        <span className="inline-flex items-center justify-center h-5 w-5 rounded-full bg-neutral-100 shrink-0">
            <X size={13} className="text-neutral-500" aria-hidden />
        </span>
    );
}

function ReferenceBadge({ entry }: { entry: DecisionLogEntry }) {
    if (!entry.label) return null;
    if (entry.kind === 'feature') return <FeatureIdBadge id={entry.label} />;
    if (!isDisplayableFeatureId(entry.label)) return null;
    return (
        <span className="inline-flex items-center px-1.5 py-0.5 rounded-md bg-neutral-100 border border-neutral-200 text-neutral-600 text-[11px] font-mono font-semibold uppercase leading-none shrink-0">
            {entry.label}
        </span>
    );
}

const verdictLabel = (entry: DecisionLogEntry): string => {
    if (entry.verdict === 'deferred') return 'Deferred';
    if (entry.kind === 'feature') return 'Feature confirmed';
    return entry.verdict === 'confirmed' ? 'Accepted for planning · not validated' : 'Marked incorrect';
};

interface Props {
    entries: DecisionLogEntry[];
    /** Reopen an assumption decision (back to Review & Confirm). */
    onUndoAssumption: (assumptionId: string) => void;
    /** Open durable validation for a consequential accepted assumption. */
    onPlanValidation?: (assumptionId: string) => void;
    /** Clear a feature confirmation. */
    onUndoFeature: (featureId: string) => void;
    readOnly: boolean;
}

const requiresValidation = (entry: DecisionLogEntry): boolean => entry.kind === 'assumption'
    && entry.verdict === 'confirmed'
    && (entry.materiality === undefined || entry.materiality === 'blocking' || entry.materiality === 'high');

export function DecisionLogSection({ entries, onUndoAssumption, onPlanValidation, onUndoFeature, readOnly }: Props) {
    if (entries.length === 0) return null;
    return (
        <div id="prd-decision-log" className="mb-8 scroll-mt-24">
            <div className="flex items-center gap-2 mb-3 border-b border-neutral-200 pb-2">
                <h3 className="text-lg font-extrabold text-neutral-900 tracking-tight whitespace-nowrap">
                    Decision Log
                </h3>
                <span className="text-[11px] text-neutral-400">{entries.length}</span>
            </div>
            <ul className="space-y-2">
                {entries.map(entry => (
                    <li
                        key={`${entry.kind}-${entry.verdict}-${entry.id}`}
                        className="flex items-start gap-2.5 rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-2.5"
                    >
                        <VerdictIcon entry={entry} />
                        <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                                <ReferenceBadge entry={entry} />
                                <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">
                                    {verdictLabel(entry)}
                                </span>
                            </div>
                            <p className={`text-sm mt-0.5 ${entry.verdict === 'rejected' ? 'text-neutral-500 line-through decoration-neutral-300' : 'text-neutral-800'}`}>
                                {entry.statement}
                            </p>
                            {entry.note && (
                                <p className="text-xs text-neutral-700 mt-1">
                                    {entry.verdict === 'rejected' && (
                                        <span className="font-semibold text-neutral-500">Correction: </span>
                                    )}
                                    {entry.note}
                                </p>
                            )}
                        </div>
                        {!readOnly && (
                            <div className="flex shrink-0 flex-col items-end gap-1">
                                {requiresValidation(entry) && onPlanValidation && (
                                    <button type="button" onClick={() => onPlanValidation(entry.id)} className="min-h-11 rounded-md px-2 text-xs font-semibold text-indigo-700 hover:bg-indigo-50" aria-label={`Plan validation for accepted assumption: ${entry.statement}`}>Plan validation</button>
                                )}
                                {/* Deferred entries are scope records, not undoable
                                    user decisions — no undo affordance. */}
                                {entry.verdict !== 'deferred' && (
                                    <button
                                        type="button"
                                        onClick={() => entry.kind === 'feature' ? onUndoFeature(entry.id) : onUndoAssumption(entry.id)}
                                        className="inline-flex min-h-11 min-w-11 items-center justify-center text-neutral-300 transition hover:text-neutral-500"
                                        title="Undo decision"
                                        aria-label={`Undo decision: ${entry.statement}`}
                                    >
                                        <Undo2 size={14} />
                                    </button>
                                )}
                            </div>
                        )}
                    </li>
                ))}
            </ul>
        </div>
    );
}
