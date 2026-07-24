import { ArrowRight, ListChecks } from 'lucide-react';
import type { OutputSyncReviewQueueItem } from '../../lib/planning/outputSyncReviewQueue';

export interface OutputSyncReviewQueueTarget {
    planId: string;
    itemId: string;
    proposalId: string;
}

interface OutputSyncReviewQueueProps {
    items: OutputSyncReviewQueueItem[];
    onOpen: (target: OutputSyncReviewQueueTarget) => void;
}

const operationLabel = (item: OutputSyncReviewQueueItem): string => {
    if (item.operation === 'review_only') return 'Review guidance';
    if (item.operation === 'remove') return 'Removal proposed';
    if (item.operation === 'add') return 'Addition proposed';
    if (item.operation === 'structural') return 'Structural change proposed';
    return 'Replacement proposed';
};

/**
 * Compact Review-stage surface for already-prepared exact-region proposals.
 * It deliberately delegates all authority and application to the existing
 * DownstreamUpdatePlanReview flow.
 */
export function OutputSyncReviewQueue({ items, onOpen }: OutputSyncReviewQueueProps) {
    if (items.length === 0) return null;

    return (
        <section
            aria-labelledby="output-sync-review-queue-title"
            className="rounded-xl border border-indigo-200 bg-indigo-50/60 p-4"
        >
            <div className="flex items-start gap-3">
                <span className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg bg-indigo-100 text-indigo-700">
                    <ListChecks size={18} aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                    <h2 id="output-sync-review-queue-title" className="text-sm font-bold text-indigo-950">
                        Output updates ready to review
                    </h2>
                    <p className="mt-1 text-xs leading-relaxed text-indigo-800">
                        Synapse prepared {items.length} focused proposal{items.length === 1 ? '' : 's'}.
                        Nothing has been applied to your outputs.
                    </p>
                </div>
            </div>

            <ul className="mt-3 space-y-2">
                {items.map(item => (
                    <li
                        key={item.proposalId}
                        className="rounded-lg border border-indigo-100 bg-white p-3"
                    >
                        <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                    <span className="text-xs font-semibold text-neutral-900">
                                        {item.artifactTitle}
                                    </span>
                                    <span className="rounded-full border border-neutral-200 bg-neutral-50 px-2 py-0.5 text-[11px] font-medium text-neutral-600">
                                        {operationLabel(item)}
                                    </span>
                                </div>
                                <p className="mt-1 break-words text-sm font-medium text-neutral-800">
                                    {item.regionLabel}
                                </p>
                                <p className="mt-1 line-clamp-2 break-words text-xs leading-relaxed text-neutral-600">
                                    {item.reasoning}
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => onOpen({
                                    planId: item.planId,
                                    itemId: item.itemId,
                                    proposalId: item.proposalId,
                                })}
                                aria-label={`Review ${item.artifactTitle}: ${item.regionLabel}`}
                                className="inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-indigo-600 px-3 text-xs font-semibold text-white hover:bg-indigo-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-700"
                            >
                                Review proposal <ArrowRight size={14} aria-hidden="true" />
                            </button>
                        </div>
                    </li>
                ))}
            </ul>
        </section>
    );
}
