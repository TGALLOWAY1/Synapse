import { ArrowRight, ListChecks, ShieldCheck } from 'lucide-react';
import type { PlanningReadiness } from '../../lib/planning';

interface Props {
    /** `derivePlanningReadiness(...).openItems` — the same set the Decision
     * Center lists under "Needs attention", so the two counts always agree. */
    openItems: PlanningReadiness['openItems'];
    onOpenDecisions: () => void;
    /** Optional adversarial review of the current plan ("Challenge this plan"). */
    onOpenChallenge?: () => void;
}

const countLabel = (count: number, singular: string, plural: string): string =>
    `${count} ${count === 1 ? singular : plural}`;

/**
 * The Plan stage's ONE line of planning state: how many decisions and
 * assumptions are waiting, and the way into the Decision Center. Deliberately
 * not a card — no readiness verdict, no tool cards, no check lists, no packet
 * block — so the PRD content starts right under it.
 */
export function PlanningStateBar({ openItems, onOpenDecisions, onOpenChallenge }: Props) {
    const parts = [
        ...(openItems.decisions > 0 ? [countLabel(openItems.decisions, 'open decision', 'open decisions')] : []),
        ...(openItems.assumptions > 0 ? [countLabel(openItems.assumptions, 'assumption to confirm', 'assumptions to confirm')] : []),
    ];
    const hasOpenItems = parts.length > 0;

    return (
        <section
            aria-label="Planning status"
            className={`mb-5 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border px-3 py-2 text-sm ${
                hasOpenItems ? 'border-amber-200 bg-amber-50/70 text-amber-950' : 'border-neutral-200 bg-neutral-50 text-neutral-700'
            }`}
        >
            <span className="flex min-w-0 items-center gap-2">
                <ListChecks size={15} className="shrink-0 opacity-70" aria-hidden="true" />
                <span className="font-medium">
                    {hasOpenItems ? parts.join(' · ') : 'No open decisions or assumptions'}
                </span>
            </span>
            <span className="ml-auto flex items-center gap-1">
                {onOpenChallenge && (
                    <button
                        type="button"
                        onClick={onOpenChallenge}
                        className="inline-flex min-h-11 items-center gap-1 rounded-lg sm:min-h-9 px-2 text-xs font-semibold text-neutral-600 hover:bg-white hover:text-neutral-900"
                    >
                        <ShieldCheck size={13} aria-hidden="true" /> Challenge this plan
                    </button>
                )}
                <button
                    type="button"
                    onClick={onOpenDecisions}
                    className="inline-flex min-h-11 items-center gap-1 rounded-lg sm:min-h-9 border border-indigo-200 bg-white px-2.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-50"
                >
                    Open Decision Center <ArrowRight size={13} aria-hidden="true" />
                </button>
            </span>
        </section>
    );
}
