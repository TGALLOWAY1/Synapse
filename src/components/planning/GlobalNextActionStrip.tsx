import { ArrowRight, Compass } from 'lucide-react';
import type {
    PlanningAttentionItem,
    PlanningAttentionSummary,
} from '../../lib/planning';

export function GlobalNextActionStrip({
    attention,
    onOpen,
}: {
    attention: PlanningAttentionSummary;
    onOpen: (item: PlanningAttentionItem) => void;
}) {
    const primary = attention.primary;
    if (!primary) return null;

    const count = attention.totalCount;

    return (
        <section
            aria-label="Project next action"
            className="shrink-0 border-b border-indigo-100 bg-indigo-50/80 px-4 py-3"
        >
            <div className="mx-auto flex max-w-screen-2xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-start gap-3">
                    <Compass
                        size={18}
                        aria-hidden="true"
                        className="mt-0.5 shrink-0 text-indigo-600"
                    />
                    <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-semibold text-indigo-950">
                                {primary.title}
                            </p>
                            <span
                                aria-label={`${count} open planning ${count === 1 ? 'item' : 'items'}`}
                                className="rounded-full border border-indigo-200 bg-white px-2 py-0.5 text-xs font-semibold text-indigo-700"
                            >
                                {count} open
                            </span>
                        </div>
                        <p className="mt-0.5 text-xs text-indigo-800">
                            Open items guide the next pass and do not block progress.
                        </p>
                    </div>
                </div>
                <button
                    type="button"
                    onClick={() => onOpen(primary)}
                    className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 text-sm font-semibold text-white sm:w-auto"
                >
                    {primary.actionLabel}
                    <ArrowRight size={15} aria-hidden="true" />
                </button>
            </div>
        </section>
    );
}
