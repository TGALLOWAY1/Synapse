// Compact review/readiness status chip shared by the Screens list cards and
// the Screen Detail header. Derived statuses are visually distinct from
// user-set ones (a small "estimated" suffix) so an estimate never reads as a
// confirmed sign-off.

import type { ScreenReadiness } from '../../lib/screenReadiness';
import { REVIEW_STATUS_LABELS } from '../../lib/screenReadiness';

const STATUS_STYLES: Record<ScreenReadiness['status'], string> = {
    draft: 'bg-neutral-100 text-neutral-600 ring-1 ring-neutral-200',
    needs_review: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
    accepted: 'bg-sky-50 text-sky-700 ring-1 ring-sky-200',
    implementation_ready: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
};

export function ReadinessBadge({ readiness }: { readiness: ScreenReadiness }) {
    const title = readiness.source === 'user'
        ? 'Status set by you'
        : readiness.reasons.length > 0
            ? `Estimated from the spec:\n${readiness.reasons.join('\n')}`
            : 'Estimated from the spec';
    return (
        <span
            title={title}
            className={`inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full whitespace-nowrap ${STATUS_STYLES[readiness.status]}`}
        >
            {REVIEW_STATUS_LABELS[readiness.status]}
            {readiness.source === 'derived' && (
                <span className="opacity-70 font-normal">estimated</span>
            )}
        </span>
    );
}
