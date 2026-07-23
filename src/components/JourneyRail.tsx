import {
    Check,
    FilePenLine,
    Hammer,
    ListChecks,
    PackagePlus,
    SearchCheck,
} from 'lucide-react';
import type {
    JourneyPresentation,
    JourneyStepId,
} from '../lib/journeyPresentation';

interface JourneyRailProps {
    presentation: JourneyPresentation;
    onStepChange: (step: JourneyStepId) => void;
}

const STEP_ICONS = {
    define: FilePenLine,
    refine: SearchCheck,
    finalize: ListChecks,
    generate: PackagePlus,
    review: Check,
    build: Hammer,
} satisfies Record<JourneyStepId, typeof Check>;

export function JourneyRail({ presentation, onStepChange }: JourneyRailProps) {
    return (
        <nav
            aria-label="Product journey"
            className="border-b border-neutral-800 bg-neutral-900 px-2 py-2 sm:px-4"
        >
            <ol className="flex snap-x snap-mandatory gap-1 overflow-x-auto overscroll-x-contain pb-1 [scrollbar-width:thin]">
                {presentation.steps.map((step, index) => {
                    const Icon = STEP_ICONS[step.id];
                    const current = step.status === 'current';
                    const complete = step.status === 'complete';
                    const statusLabel = current
                        ? 'Current step'
                        : complete
                            ? 'Complete'
                            : step.enabled
                                ? 'Available'
                                : 'Unavailable';

                    return (
                        <li
                            key={step.id}
                            className="min-w-[7.25rem] flex-1 snap-start sm:min-w-[8.25rem]"
                        >
                            <button
                                type="button"
                                onClick={() => step.enabled && onStepChange(step.id)}
                                disabled={!step.enabled}
                                aria-current={current ? 'step' : undefined}
                                aria-describedby={`journey-step-${step.id}-description`}
                                className={`flex min-h-12 w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-900 ${
                                    current
                                        ? 'bg-indigo-600 text-white'
                                        : complete
                                            ? 'bg-neutral-800 text-neutral-100 hover:bg-neutral-700'
                                            : step.enabled
                                                ? 'text-neutral-300 hover:bg-neutral-800 hover:text-white'
                                                : 'cursor-not-allowed text-neutral-600'
                                }`}
                            >
                                <span
                                    aria-hidden="true"
                                    className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                                        current
                                            ? 'bg-white/15'
                                            : complete
                                                ? 'bg-emerald-500/15 text-emerald-300'
                                                : 'bg-neutral-800'
                                    }`}
                                >
                                    {complete ? <Check size={14} /> : <Icon size={14} />}
                                </span>
                                <span className="min-w-0">
                                    <span className="block text-[10px] font-semibold uppercase tracking-wide opacity-65">
                                        {index + 1} · {statusLabel}
                                    </span>
                                    <span className="block truncate text-sm font-semibold">{step.label}</span>
                                </span>
                                <span
                                    id={`journey-step-${step.id}-description`}
                                    className="sr-only"
                                >
                                    {step.description}
                                </span>
                            </button>
                        </li>
                    );
                })}
            </ol>
        </nav>
    );
}
