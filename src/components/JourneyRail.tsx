import { FilePenLine, Hammer, ListChecks } from 'lucide-react';
import type {
    JourneyPresentation,
    JourneyStepId,
} from '../lib/journeyPresentation';

interface JourneyRailProps {
    presentation: JourneyPresentation;
    onStepChange: (step: JourneyStepId) => void;
}

const STEP_ICONS = {
    plan: FilePenLine,
    decide: ListChecks,
    build: Hammer,
} satisfies Record<JourneyStepId, typeof Hammer>;

/**
 * Plan · Decide · Build. Three steps, no status captions: the current step is
 * highlighted (`aria-current="step"`), Decide carries the open-item count, and
 * a step with nothing to show yet is simply inert — never labelled
 * "unavailable".
 */
export function JourneyRail({ presentation, onStepChange }: JourneyRailProps) {
    return (
        <nav
            aria-label="Product journey"
            className="border-b border-neutral-800 bg-neutral-900 px-2 py-2 sm:px-4"
        >
            <ol className="grid grid-cols-3 gap-1">
                {presentation.steps.map((step, index) => {
                    const Icon = STEP_ICONS[step.id];
                    return (
                        <li key={step.id} className="min-w-0">
                            {/* `relative` keeps the sr-only (position:absolute)
                                description contained by the button, so it can
                                never widen the page on a narrow viewport. */}
                            <button
                                type="button"
                                onClick={() => step.enabled && onStepChange(step.id)}
                                disabled={!step.enabled}
                                aria-current={step.current ? 'step' : undefined}
                                aria-describedby={`journey-step-${step.id}-description`}
                                className={`relative flex min-h-11 w-full items-center justify-center gap-2 rounded-lg px-2 py-1.5 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-900 sm:justify-start sm:px-3 ${
                                    step.current
                                        ? 'bg-indigo-600 text-white'
                                        : step.enabled
                                            ? 'text-neutral-300 hover:bg-neutral-800 hover:text-white'
                                            : 'cursor-default text-neutral-600'
                                }`}
                            >
                                <span
                                    aria-hidden="true"
                                    className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
                                        step.current ? 'bg-white/15' : 'bg-neutral-800'
                                    }`}
                                >
                                    <Icon size={13} />
                                </span>
                                <span className="truncate">
                                    <span className="sr-only">{index + 1}. </span>
                                    {step.label}
                                </span>
                                {step.badge !== undefined && (
                                    <span
                                        className={`inline-flex min-w-5 shrink-0 items-center justify-center rounded-full px-1.5 text-[11px] font-bold leading-5 ${
                                            step.current ? 'bg-white text-indigo-700' : 'bg-amber-400 text-neutral-950'
                                        }`}
                                    >
                                        {step.badge}
                                        <span className="sr-only"> open {step.badge === 1 ? 'item' : 'items'}</span>
                                    </span>
                                )}
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
