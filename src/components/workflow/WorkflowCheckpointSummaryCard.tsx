import { useId, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, ExternalLink, X } from 'lucide-react';
import type {
    WorkflowCheckpointRow,
    WorkflowCheckpointSummary,
    WorkflowCheckpointTone,
} from '../../lib/workflowCheckpointSummary';

interface WorkflowCheckpointSummaryCardProps {
    summary: WorkflowCheckpointSummary;
    onOpen?: (row: WorkflowCheckpointRow) => void;
    onDismiss?: () => void;
}

/**
 * Tone → chrome. `advisory` is deliberately quiet: a run that finished with
 * only advisory notes succeeded, and the workspace already stacks other
 * notices above the content, so it renders as a neutral one-liner with a
 * success mark rather than a caution box. Amber is kept for `attention`
 * (failed slots, blocking validation, build-blocking alignment, critique to
 * resolve, accepted planning risks).
 */
const TONE_STYLES: Record<WorkflowCheckpointTone, {
    container: string;
    heading: string;
    body: string;
    row: string;
    control: string;
}> = {
    clean: {
        container: 'border-emerald-200 bg-emerald-50',
        heading: 'text-emerald-950',
        body: 'text-emerald-900',
        row: 'border-emerald-200',
        control: 'border-emerald-200 bg-white/70 text-emerald-900 hover:bg-white',
    },
    advisory: {
        container: 'border-neutral-200 bg-white',
        heading: 'text-neutral-950',
        body: 'text-neutral-700',
        row: 'border-neutral-200',
        control: 'border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-100',
    },
    attention: {
        container: 'border-amber-200 bg-amber-50',
        heading: 'text-amber-950',
        body: 'text-amber-900',
        row: 'border-amber-200',
        control: 'border-amber-300 bg-white/70 text-amber-900 hover:bg-white',
    },
};

export function WorkflowCheckpointSummaryCard({
    summary,
    onOpen,
    onDismiss,
}: WorkflowCheckpointSummaryCardProps) {
    const tone = summary.tone;
    const styles = TONE_STYLES[tone];
    const acceptedRisks = summary.planningVerdict.acceptedRisks ?? [];
    const hasDetails = summary.rows.length > 0
        || acceptedRisks.length > 0
        || !!summary.planningVerdict.rationale
        || !!summary.planningVerdict.containment;
    // Anything needing action opens expanded so a failure is never hidden
    // behind a disclosure; advisory notes stay collapsed until asked for.
    // `undefined` means "follow the tone", so a tone change still tracks until
    // the user has expressed a preference.
    const [expandedOverride, setExpandedOverride] = useState<boolean>();
    const expanded = expandedOverride ?? tone === 'attention';
    const detailsId = useId();

    return (
        <section
            aria-label={summary.context === 'generation' ? 'Generation checkpoint' : 'Export checkpoint'}
            className={`rounded-xl border ${styles.container} ${expanded ? 'p-4' : 'px-4 py-3'}`}
        >
            <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
                {summary.headline}. {summary.supportingText}
            </p>
            <div className="flex items-start gap-3">
                {tone === 'attention'
                    ? <AlertTriangle size={18} className="mt-0.5 shrink-0 text-amber-700" aria-hidden="true" />
                    : <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-emerald-600" aria-hidden="true" />}
                <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                        <h3 className={`text-sm font-bold ${styles.heading}`}>
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
                    {!hasDetails && (
                        <p className={`mt-1 text-xs leading-5 ${styles.body}`}>
                            {summary.supportingText}
                        </p>
                    )}
                </div>
                {hasDetails && (
                    <button
                        type="button"
                        onClick={() => setExpandedOverride(!expanded)}
                        aria-expanded={expanded}
                        aria-controls={detailsId}
                        className={`inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg border px-3 text-xs font-semibold ${styles.control}`}
                    >
                        {summary.detailsLabel}
                        <ChevronDown
                            size={14}
                            aria-hidden="true"
                            className={expanded ? 'rotate-180 transition-transform' : 'transition-transform'}
                        />
                    </button>
                )}
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

            {hasDetails && (
                <div id={detailsId} hidden={!expanded}>
                    <p className={`mt-2 text-xs leading-5 ${styles.body}`}>
                        {summary.supportingText}
                    </p>
                    {summary.planningVerdict.rationale && (
                        <p className={`mt-2 text-xs leading-5 ${styles.body}`}>
                            <span className="font-semibold">Rationale:</span>{' '}
                            {summary.planningVerdict.rationale}
                        </p>
                    )}
                    {summary.planningVerdict.containment && (
                        <p className={`mt-1 text-xs leading-5 ${styles.body}`}>
                            <span className="font-semibold">Containment:</span>{' '}
                            {summary.planningVerdict.containment}
                        </p>
                    )}
                    {acceptedRisks.length > 0 && (
                        <div className={`mt-2 text-xs leading-5 ${styles.body}`}>
                            <p className="font-semibold">Accepted planning risks</p>
                            <ul className="list-disc pl-4">
                                {acceptedRisks.map(risk => (
                                    <li key={risk}>{risk}</li>
                                ))}
                            </ul>
                        </div>
                    )}
                    {summary.rows.length > 0 && (
                        <ul className="mt-3 space-y-2">
                            {summary.rows.map(row => (
                                <li
                                    key={row.id}
                                    className={`rounded-lg border bg-white/80 p-3 ${
                                        row.severity === 'attention'
                                            ? 'border-amber-200'
                                            : styles.row
                                    }`}
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
                </div>
            )}
        </section>
    );
}
