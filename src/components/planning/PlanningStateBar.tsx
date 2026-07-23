import { AlertTriangle, ArrowRight, CheckCircle2, ChevronDown, Circle, ClipboardCheck, Compass, ListChecks, ShieldCheck, Sparkles } from 'lucide-react';
import type { ComponentType } from 'react';
import {
    derivePlanningOverviewPresentation,
    projectCommitmentCopy,
    type PlanningOverviewTone,
    type PlanningReadiness,
    type ProjectCommitmentCondition,
} from '../../lib/planning';

interface Props {
    readiness: PlanningReadiness;
    planSummary?: string;
    committed: boolean;
    legacyCommitted?: boolean;
    onReviewReadiness: () => void;
    onOpenDecisions: () => void;
    onOpenChallenge: () => void;
    /** Jump to the Features view so the user can confirm the proposed scope. */
    onOpenFeatures?: () => void;
    /** Open assumptions the user can settle by answering directly. */
    answerableCount?: number;
    /** When provided (and questions are answerable in a calm state), the
     * dominant action starts the guided sharpen flow instead of navigating. */
    onStartSharpen?: () => void;
}

const toneClass: Record<PlanningOverviewTone, string> = {
    exploring: 'border-sky-200 bg-sky-50 text-sky-950',
    calm: 'border-neutral-200 bg-white text-neutral-950',
    caution: 'border-amber-200 bg-amber-50 text-amber-950',
    challenge: 'border-indigo-200 bg-indigo-50 text-indigo-950',
    alignment: 'border-orange-200 bg-orange-50 text-orange-950',
    ready: 'border-emerald-200 bg-emerald-50 text-emerald-950',
};

/** The three planning tools, ordered as the workflow uses them:
 * settle open choices → stress-test → final readiness check before build. The
 * `cue` communicates *when* each belongs so the order of operations is legible. */
type PlanningTool = {
    key: string;
    icon: ComponentType<{ size?: number | string; className?: string }>;
    title: string;
    cue: string;
    when: string;
    onClick: () => void;
};

export function PlanningStateBar({ readiness, planSummary, committed, legacyCommitted = false, onReviewReadiness, onOpenDecisions, onOpenChallenge, onOpenFeatures, answerableCount = 0, onStartSharpen }: Props) {
    const commitmentCondition: ProjectCommitmentCondition = legacyCommitted
        ? 'legacy_commitment'
        : committed
            ? readiness.isReadyToBuild ? 'plan_committed' : 'proceeding_with_accepted_risk'
            : 'working_plan';
    const commitmentCopy = projectCommitmentCopy(commitmentCondition);
    const presentation = derivePlanningOverviewPresentation(readiness, answerableCount);
    const calm = presentation.tone === 'calm';
    const surface = calm ? 'border border-neutral-200/80 bg-neutral-50' : 'bg-white/70';
    const surfaceFaint = calm ? 'border border-neutral-200/60 bg-neutral-50/80' : 'bg-white/45';
    const cardClass = calm
        ? 'border border-neutral-200 bg-white hover:border-neutral-300 hover:bg-neutral-50'
        : 'border border-current/10 bg-white/70 hover:bg-white';
    const alignmentCriterion = readiness.criteria.find(item => item.id === 'alignment');
    const alignmentSummary = alignmentCriterion?.status === 'met'
        ? 'Aligned with the current plan'
        : 'Downstream review needs attention';
    const metCount = readiness.criteria.filter(item => item.status === 'met').length;
    const sharpenAvailable = calm && !!onStartSharpen && answerableCount > 0;
    const sharpenLabel = answerableCount === 1
        ? 'Answer 1 quick question'
        : `Sharpen my plan (${answerableCount} questions)`;

    const tools: PlanningTool[] = [
        {
            key: 'decisions',
            icon: ListChecks,
            title: 'Decision Center',
            cue: 'Start here',
            when: 'Answer open choices and confirm your feature scope.',
            onClick: onOpenDecisions,
        },
        {
            key: 'challenge',
            icon: ShieldCheck,
            title: 'Challenge this plan',
            cue: 'When it reads coherently',
            when: 'Let Synapse stress-test the plan for weak spots and gaps.',
            onClick: onOpenChallenge,
        },
        {
            key: 'readiness',
            icon: ClipboardCheck,
            title: 'Review readiness',
            cue: 'Before you build',
            when: 'Run the final readiness check, then commit the plan.',
            onClick: onReviewReadiness,
        },
    ];

    return (
        <section className={`mb-5 rounded-2xl border p-4 sm:p-5 ${toneClass[presentation.tone]}`} aria-labelledby="planning-state-heading">
            {planSummary && (
                <div className="mb-4 border-b border-current/10 pb-4">
                    <p className="text-[11px] font-bold uppercase tracking-wider opacity-60">Current plan</p>
                    <p className="mt-1 max-w-3xl text-sm leading-6 opacity-85">{planSummary}</p>
                </div>
            )}
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-bold uppercase tracking-wider ${calm ? 'bg-neutral-100' : 'bg-white/70'}`}>
                            {committed || legacyCommitted ? <CheckCircle2 size={12} /> : <Compass size={12} />}
                            {commitmentCopy.label}
                        </span>
                    </div>
                    <h2 id="planning-state-heading" className="mt-2 flex items-center gap-2 text-lg font-bold tracking-tight">
                        {calm && <Sparkles size={16} className="shrink-0 text-indigo-500" aria-hidden="true" />}
                        {presentation.headline}
                    </h2>
                    <p className="mt-1 max-w-2xl text-sm leading-6 opacity-80">{presentation.summary}</p>
                </div>
                {sharpenAvailable && (
                    <button
                        type="button"
                        onClick={onStartSharpen}
                        className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-500"
                    >
                        {sharpenLabel}
                    </button>
                )}
            </div>
            {alignmentCriterion && alignmentCriterion.status !== 'not_started' && (
                <div className={`mt-4 rounded-xl px-3 py-3 ${surface}`}>
                    <p className="text-[11px] font-bold uppercase tracking-wider opacity-60">Downstream alignment</p>
                    <p className="mt-1 text-sm font-semibold">{alignmentSummary}</p>
                </div>
            )}

            {/* Planning tools, always visible and ordered by when they belong in the
                workflow — the previous buried underline links left it unclear which
                to use and in what order. */}
            <div className="mt-4">
                <p className="px-1 text-[11px] font-bold uppercase tracking-wider opacity-60">Planning tools</p>
                <div className="mt-2 grid gap-2 sm:grid-cols-3">
                    {tools.map((tool, index) => {
                        const Icon = tool.icon;
                        return (
                            <button
                                key={tool.key}
                                type="button"
                                onClick={tool.onClick}
                                className={`group flex min-h-11 flex-col rounded-xl p-3 text-left transition ${cardClass}`}
                                aria-label={`${tool.title} — ${tool.when}`}
                            >
                                <span className="flex items-center gap-2">
                                    <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-current/5 text-[11px] font-bold opacity-70">{index + 1}</span>
                                    <Icon size={15} className="shrink-0 opacity-70" aria-hidden="true" />
                                    <span className="text-sm font-semibold">{tool.title}</span>
                                    <ArrowRight size={13} className="ml-auto shrink-0 opacity-0 transition group-hover:translate-x-0.5 group-hover:opacity-60" aria-hidden="true" />
                                </span>
                                <span className="mt-1 text-[11px] font-semibold uppercase tracking-wide opacity-50">{tool.cue}</span>
                                <span className="mt-0.5 text-xs leading-5 opacity-70">{tool.when}</span>
                            </button>
                        );
                    })}
                </div>
            </div>

            <details className="mt-3 group">
                <summary className="flex min-h-10 cursor-pointer list-none items-center gap-2 text-sm font-semibold opacity-75">
                    <ChevronDown size={15} className="transition group-open:rotate-180" /> Readiness checks
                    <span className="text-xs font-medium opacity-60">({metCount}/{readiness.criteria.length} passing)</span>
                </summary>
                <div className={`mt-2 rounded-xl p-2 ${surfaceFaint}`}>
                    <div className="grid gap-2 sm:grid-cols-2">
                        {readiness.criteria.map(item => (
                            <div key={item.id} className={`flex items-start gap-2 rounded-lg p-3 ${calm ? 'bg-white' : 'bg-white/60'}`}>
                                {item.status === 'met' ? <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-emerald-600" /> : item.status === 'attention' ? <AlertTriangle size={15} className="mt-0.5 shrink-0 text-amber-600" /> : <Circle size={15} className="mt-0.5 shrink-0 text-neutral-400" />}
                                <div className="min-w-0">
                                    <p className="text-sm font-semibold">{item.label}</p>
                                    <p className="mt-0.5 text-xs leading-5 opacity-70">{item.explanation}</p>
                                    {item.id === 'scope' && item.status === 'attention' && onOpenFeatures && (
                                        <button
                                            type="button"
                                            onClick={onOpenFeatures}
                                            className="mt-1.5 inline-flex min-h-8 items-center gap-1 text-xs font-semibold underline decoration-current/30 underline-offset-4 hover:decoration-current"
                                        >
                                            Confirm features <ArrowRight size={12} />
                                        </button>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </details>
        </section>
    );
}
