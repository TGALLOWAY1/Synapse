import { AlertTriangle, CheckCircle2, ExternalLink, X } from 'lucide-react';
import type {
    WorkflowCheckpointRow,
    WorkflowCheckpointSummary,
} from '../../lib/workflowCheckpointSummary';

interface WorkflowCheckpointSummaryCardProps {
    summary: WorkflowCheckpointSummary;
    onOpen?: (row: WorkflowCheckpointRow) => void;
    onDismiss?: () => void;
}

export function WorkflowCheckpointSummaryCard({
    summary,
    onOpen,
    onDismiss,
}: WorkflowCheckpointSummaryCardProps) {
    const clean = summary.rows.length === 0
        && (summary.planningVerdict.acceptedRisks?.length ?? 0) === 0;
    return (
        <section
            aria-label={summary.context === 'generation' ? 'Generation checkpoint' : 'Export checkpoint'}
            className={`rounded-xl border p-4 ${
                clean
                    ? 'border-emerald-200 bg-emerald-50'
                    : 'border-amber-200 bg-amber-50'
            }`}
        >
            <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
                {summary.headline}.
            </p>
            <div className="flex items-start gap-3">
                {clean
                    ? <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-emerald-600" aria-hidden="true" />
                    : <AlertTriangle size={18} className="mt-0.5 shrink-0 text-amber-700" aria-hidden="true" />}
                <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                        <h3 className={`text-sm font-bold ${clean ? 'text-emerald-950' : 'text-amber-950'}`}>
                            {summary.headline}
                        </h3>
                        <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
                            summary.planningVerdict.kind === 'finalized'
                                ? 'border-indigo-200 bg-indigo-50 text-indigo-800'
                                : 'border-neutral-200 bg-white text-neutral-600'
                        }`}>
                            {summary.planningVerdict.label}
                        </span>
                    </div>
                    <p className={`mt-1 text-xs leading-5 ${clean ? 'text-emerald-800' : 'text-amber-900'}`}>
                        {summary.supportingText}
                    </p>
                    {summary.planningVerdict.rationale && (
                        <p className={`mt-2 text-xs leading-5 ${
                            clean ? 'text-emerald-900' : 'text-amber-950'
                        }`}>
                            <span className="font-semibold">Rationale:</span>{' '}
                            {summary.planningVerdict.rationale}
                        </p>
                    )}
                    {summary.planningVerdict.containment && (
                        <p className={`mt-1 text-xs leading-5 ${
                            clean ? 'text-emerald-900' : 'text-amber-950'
                        }`}>
                            <span className="font-semibold">Containment:</span>{' '}
                            {summary.planningVerdict.containment}
                        </p>
                    )}
                    {(summary.planningVerdict.acceptedRisks?.length ?? 0) > 0 && (
                        <div className={`mt-2 text-xs leading-5 ${
                            clean ? 'text-emerald-900' : 'text-amber-950'
                        }`}>
                            <p className="font-semibold">Accepted planning risks</p>
                            <ul className="list-disc pl-4">
                                {summary.planningVerdict.acceptedRisks?.map(risk => (
                                    <li key={risk}>{risk}</li>
                                ))}
                            </ul>
                        </div>
                    )}
                </div>
                {onDismiss && (
                    <button
                        type="button"
                        onClick={onDismiss}
                        aria-label="Dismiss checkpoint summary"
                        className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg text-neutral-500 hover:bg-white/70 hover:text-neutral-800"
                    >
                        <X size={16} />
                    </button>
                )}
            </div>

            {summary.rows.length > 0 && (
                <ul className="mt-3 space-y-2">
                    {summary.rows.map(row => (
                        <li
                            key={row.id}
                            className="rounded-lg border border-amber-200 bg-white/80 p-3"
                        >
                            <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <p className="text-sm font-semibold text-neutral-950">{row.label}</p>
                                    <ul className="mt-1 space-y-1">
                                        {row.signals.map(signal => (
                                            <li key={signal.id} className="text-xs leading-5 text-neutral-700">
                                                <span className="font-semibold">{signal.label}</span>
                                                {signal.detail ? ` — ${signal.detail}` : ''}
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                                {onOpen && (
                                    <button
                                        type="button"
                                        onClick={() => onOpen(row)}
                                        aria-label={`Review ${row.label}`}
                                        className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-3 text-xs font-semibold text-indigo-800 hover:bg-indigo-100"
                                    >
                                        <ExternalLink size={13} aria-hidden="true" />
                                        Review
                                    </button>
                                )}
                            </div>
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}
