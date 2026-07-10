import { Check, X, Undo2 } from 'lucide-react';
import type { DecisionLogEntry } from '../../lib/derive/prdDecisions';
import { FeatureIdBadge } from './FeatureIdBadge';
import { isDisplayableFeatureId } from '../../lib/derive/prdDecisions';

// Decision Log — the record of confirmed user choices (accepted/corrected
// assumptions and confirmed features). Deliberately separate from the
// unresolved "Review & Confirm" items above it: everything here has been
// decided by the user. Derived read-side (deriveDecisionLog); never persisted
// as its own structure.

function VerdictIcon({ verdict }: { verdict: DecisionLogEntry['verdict'] }) {
    if (verdict === 'confirmed') {
        return (
            <span className="inline-flex items-center justify-center h-5 w-5 rounded-full bg-emerald-100 shrink-0">
                <Check size={13} className="text-emerald-700" aria-hidden />
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
    if (entry.kind === 'feature') return <FeatureIdBadge id={entry.label} />;
    if (!isDisplayableFeatureId(entry.label)) return null;
    return (
        <span className="inline-flex items-center px-1.5 py-0.5 rounded-md bg-neutral-100 border border-neutral-200 text-neutral-600 text-[11px] font-mono font-semibold uppercase leading-none shrink-0">
            {entry.label}
        </span>
    );
}

interface Props {
    entries: DecisionLogEntry[];
    /** Reopen an assumption decision (back to Review & Confirm). */
    onUndoAssumption: (assumptionId: string) => void;
    /** Clear a feature confirmation. */
    onUndoFeature: (featureId: string) => void;
    readOnly: boolean;
}

export function DecisionLogSection({ entries, onUndoAssumption, onUndoFeature, readOnly }: Props) {
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
                        key={`${entry.kind}-${entry.id}`}
                        className="flex items-start gap-2.5 rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-2.5"
                    >
                        <VerdictIcon verdict={entry.verdict} />
                        <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                                <ReferenceBadge entry={entry} />
                                <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">
                                    {entry.kind === 'feature'
                                        ? 'Feature confirmed'
                                        : entry.verdict === 'confirmed' ? 'Confirmed' : 'Marked incorrect'}
                                </span>
                            </div>
                            <p className={`text-sm mt-0.5 ${entry.verdict === 'rejected' ? 'text-neutral-500 line-through decoration-neutral-300' : 'text-neutral-800'}`}>
                                {entry.statement}
                            </p>
                            {entry.note && (
                                <p className="text-xs text-neutral-700 mt-1">
                                    <span className="font-semibold text-neutral-500">Correction:</span> {entry.note}
                                </p>
                            )}
                        </div>
                        {!readOnly && (
                            <button
                                type="button"
                                onClick={() =>
                                    entry.kind === 'feature'
                                        ? onUndoFeature(entry.id)
                                        : onUndoAssumption(entry.id)
                                }
                                className="p-1 text-neutral-300 hover:text-neutral-500 transition shrink-0"
                                title="Undo decision"
                                aria-label={`Undo decision: ${entry.statement}`}
                            >
                                <Undo2 size={14} />
                            </button>
                        )}
                    </li>
                ))}
            </ul>
        </div>
    );
}
