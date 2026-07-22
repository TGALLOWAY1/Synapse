import { ArrowRight, ListChecks } from 'lucide-react';

import type { PlanningRecordType } from '../../types';

export type PreBuildCheckItem = {
    id: string;
    title: string;
    type: PlanningRecordType;
};

const TYPE_LABELS: Record<PlanningRecordType, string> = {
    decision: 'Decision',
    assumption: 'Assumption',
    risk: 'Risk',
    open_question: 'Question',
    conflict: 'Conflict',
};

const MAX_LISTED_ITEMS = 5;

/**
 * Advisory validation checkpoint shown once, right when output generation is
 * about to start. It surfaces still-open planning questions at the moment they
 * matter — the beginning of implementation — without ever blocking the build:
 * "Generate anyway" always proceeds.
 */
export function PreBuildCheckModal({ items, onReviewFirst, onGenerateAnyway, onClose }: {
    items: PreBuildCheckItem[];
    onReviewFirst: () => void;
    onGenerateAnyway: () => void;
    onClose: () => void;
}) {
    const listed = items.slice(0, MAX_LISTED_ITEMS);
    const hiddenCount = items.length - listed.length;
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-labelledby="pre-build-check-heading" onClick={onClose}>
            <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl sm:p-7" onClick={event => event.stopPropagation()}>
                <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-700">
                    <ListChecks size={20} />
                </div>
                <h1 id="pre-build-check-heading" className="text-xl font-bold tracking-tight text-neutral-950">Quick check before you build</h1>
                <p className="mt-2 text-sm leading-6 text-neutral-600">
                    {items.length === 1 ? 'One open question hasn’t been answered yet.' : `${items.length} open questions haven’t been answered yet.`}{' '}
                    Synapse used its best judgment in the plan, so you can generate now and answer them later — or take a minute to approve its recommendations first.
                </p>
                <ul className="mt-4 space-y-2" aria-label="Open planning items">
                    {listed.map(item => (
                        <li key={item.id} className="flex items-start gap-2 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2">
                            <span className="mt-0.5 shrink-0 rounded-full bg-neutral-200 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-neutral-600">{TYPE_LABELS[item.type]}</span>
                            <span className="min-w-0 text-sm leading-5 text-neutral-800">{item.title}</span>
                        </li>
                    ))}
                    {hiddenCount > 0 && <li className="px-3 text-xs text-neutral-500">+{hiddenCount} more in the Decision Center</li>}
                </ul>
                <div className="mt-6 flex flex-col gap-2 sm:flex-row">
                    <button type="button" onClick={onGenerateAnyway} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-500">
                        Generate anyway <ArrowRight size={14} className="shrink-0" />
                    </button>
                    <button type="button" onClick={onReviewFirst} className="inline-flex min-h-11 items-center justify-center rounded-lg border border-neutral-200 bg-white px-4 text-sm font-semibold text-neutral-700 hover:bg-neutral-50">
                        Review decisions first
                    </button>
                </div>
                <p className="mt-3 text-xs leading-5 text-neutral-500">This never blocks your assets — answers recorded later flow into the plan the same way.</p>
            </div>
        </div>
    );
}
