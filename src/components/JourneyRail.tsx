import {
    Check,
    Hammer,
    Map,
    PackagePlus,
    SearchCheck,
} from 'lucide-react';
import {
    deriveJourneyPhases,
    type JourneyPhaseId,
    type JourneyPresentation,
    type JourneyStepId,
} from '../lib/journeyPresentation';

interface JourneyRailProps {
    presentation: JourneyPresentation;
    onStepChange: (step: JourneyStepId) => void;
}

const PHASE_ICONS = {
    plan: Map,
    generate: PackagePlus,
    review: SearchCheck,
    build: Hammer,
} satisfies Record<JourneyPhaseId, typeof Check>;

export function JourneyRail({ presentation, onStepChange }: JourneyRailProps) {
    const phases = deriveJourneyPhases(presentation);
    const planPhase = phases.find(phase => phase.id === 'plan');
    const planActive = planPhase?.status === 'current';

    return (
        <nav
            aria-label="Product journey"
            className="border-b border-neutral-800 bg-neutral-900 px-2 py-2 sm:px-4"
        >
            <ol className="flex snap-x snap-mandatory gap-1 overflow-x-auto overscroll-x-contain pb-1 [scrollbar-width:thin]">
                {phases.map((phase, index) => {
                    const Icon = PHASE_ICONS[phase.id];
                    const current = phase.status === 'current';
                    const complete = phase.status === 'complete';
                    const statusLabel = current
                        ? 'Current phase'
                        : complete
                            ? 'Complete'
                            : phase.enabled
                                ? 'Available'
                                : 'Unavailable';

                    return (
                        <li
                            key={phase.id}
                            className="min-w-[7.25rem] flex-1 snap-start sm:min-w-[8.25rem]"
                        >
                            {/* `relative` is load-bearing: the sr-only description
                                span is position:absolute, and without a positioned
                                ancestor inside this overflow-x scroller its
                                containing block escalates to the document — the
                                off-screen steps then widen <html> past the mobile
                                viewport and the whole page becomes horizontally
                                pannable (dead gutter on iOS). */}
                            <button
                                type="button"
                                onClick={() => phase.enabled && onStepChange(phase.targetStep)}
                                disabled={!phase.enabled}
                                aria-current={current ? 'step' : undefined}
                                aria-describedby={`journey-phase-${phase.id}-description`}
                                className={`relative flex min-h-12 w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-900 ${
                                    current
                                        ? 'bg-brand-600 text-white'
                                        : complete
                                            ? 'bg-neutral-800 text-neutral-100 hover:bg-neutral-700'
                                            : phase.enabled
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
                                    <span className="block truncate text-sm font-semibold">{phase.label}</span>
                                </span>
                                <span
                                    id={`journey-phase-${phase.id}-description`}
                                    className="sr-only"
                                >
                                    {phase.description}
                                </span>
                            </button>
                        </li>
                    );
                })}
            </ol>
            {/* Plan's sub-states surface only while working inside Plan, so the
                top level stays four chunks without hiding where you are. */}
            {planActive && planPhase && (
                <ol
                    aria-label="Plan sub-steps"
                    className="mt-1 flex items-center gap-1 overflow-x-auto pb-0.5"
                >
                    {planPhase.substeps.map(step => {
                        const current = step.status === 'current';
                        const complete = step.status === 'complete';
                        return (
                            <li key={step.id}>
                                <button
                                    type="button"
                                    onClick={() => step.enabled && onStepChange(step.id)}
                                    disabled={!step.enabled}
                                    aria-current={current ? 'step' : undefined}
                                    title={step.description}
                                    className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-900 ${
                                        current
                                            ? 'bg-brand-500/20 text-brand-200 border border-brand-400/40'
                                            : complete
                                                ? 'text-emerald-300 hover:bg-neutral-800 border border-transparent'
                                                : step.enabled
                                                    ? 'text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200 border border-transparent'
                                                    : 'cursor-not-allowed text-neutral-600 border border-transparent'
                                    }`}
                                >
                                    {complete && <Check size={11} aria-hidden />}
                                    {step.label}
                                </button>
                            </li>
                        );
                    })}
                </ol>
            )}
        </nav>
    );
}
