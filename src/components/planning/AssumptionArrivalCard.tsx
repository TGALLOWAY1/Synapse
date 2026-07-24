import { CheckCircle2, Clock3, ListChecks } from 'lucide-react';
import type {
    AssumptionArrivalSummary,
    BatchVerdictResult,
} from '../../lib/planning';

interface Props {
    summary: AssumptionArrivalSummary;
    busy?: boolean;
    readOnly?: boolean;
    batchResult?: BatchVerdictResult;
    onAcceptDefaults: (recordIds: string[]) => void;
    onReviewEach: (recordIds: string[]) => void;
    onLater: (recordIds: string[]) => void;
}

const materialityLabel = {
    blocking: 'blocking',
    high: 'high impact',
    normal: 'normal',
    low: 'low impact',
} as const;

export function AssumptionArrivalCard({
    summary,
    busy,
    readOnly,
    batchResult,
    onAcceptDefaults,
    onReviewEach,
    onLater,
}: Props) {
    if (readOnly || summary.pendingRecords.length === 0) return null;

    const ids = summary.pendingRecords.map(record => record.id);
    const count = ids.length;
    const materialitySummary = (
        Object.entries(summary.materialityCounts) as Array<
            [keyof typeof summary.materialityCounts, number]
        >
    )
        .filter(([, value]) => value > 0)
        .map(([materiality, value]) =>
            `${value} ${materialityLabel[materiality]}`)
        .join(' · ');

    return (
        <section
            aria-label="New assumptions"
            aria-busy={busy}
            className="mb-5 rounded-2xl border border-indigo-200 bg-indigo-50/60 p-4 sm:p-5"
        >
            <h2 className="font-bold text-indigo-950">
                {summary.totalImported} new assumptions arrived with this plan
            </h2>
            <p className="mt-1 text-sm leading-6 text-indigo-900/80">
                Accepting a default records your planning call; it does not validate evidence.
            </p>
            {materialitySummary && (
                <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-indigo-700">
                    {materialitySummary}
                </p>
            )}
            {summary.highlights.length > 0 && (
                <ul className="mt-3 space-y-2">
                    {summary.highlights.map(record => (
                        <li
                            key={record.id}
                            className="rounded-xl border border-indigo-100 bg-white/80 px-3 py-2 text-sm font-medium text-neutral-800"
                        >
                            {record.statement || record.title}
                        </li>
                    ))}
                </ul>
            )}
            {batchResult && (
                <div
                    role="status"
                    aria-live="polite"
                    aria-label="Assumption batch result"
                    className="mt-3 rounded-xl border border-indigo-100 bg-white/80 px-3 py-2 text-sm text-indigo-950"
                >
                    {batchResult.succeeded.length} recorded ·{' '}
                    {batchResult.skipped.length} skipped ·{' '}
                    {batchResult.failed.length} failed
                </div>
            )}
            <div className="mt-4 grid gap-2 sm:grid-cols-3">
                <button
                    type="button"
                    className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white disabled:opacity-60"
                    disabled={busy}
                    aria-label={`Accept defaults for ${count} imported assumptions`}
                    onClick={() => onAcceptDefaults(ids)}
                >
                    <CheckCircle2 size={16} aria-hidden="true" />
                    {busy ? 'Recording…' : 'Accept defaults'}
                </button>
                <button
                    type="button"
                    className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-indigo-200 bg-white px-4 text-sm font-semibold text-indigo-800 disabled:opacity-60"
                    disabled={busy}
                    aria-label={`Review each of ${count} imported assumptions`}
                    onClick={() => onReviewEach(ids)}
                >
                    <ListChecks size={16} aria-hidden="true" />
                    Review each
                </button>
                <button
                    type="button"
                    className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-indigo-200 bg-white px-4 text-sm font-semibold text-indigo-800 disabled:opacity-60"
                    disabled={busy}
                    aria-label={`Review ${count} imported assumptions later`}
                    onClick={() => onLater(ids)}
                >
                    <Clock3 size={16} aria-hidden="true" />
                    Later
                </button>
            </div>
        </section>
    );
}
