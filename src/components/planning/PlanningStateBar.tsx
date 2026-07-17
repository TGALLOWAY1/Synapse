import { AlertTriangle, ArrowRight, CheckCircle2, ChevronDown, Circle, Compass, ShieldCheck } from 'lucide-react';
import {
    planningReadinessCopy,
    projectCommitmentCopy,
    type PlanningAttentionSummary,
    type PlanningDestination,
    type PlanningReadiness,
    type ProjectCommitmentCondition,
} from '../../lib/planning';

interface Props {
    readiness: PlanningReadiness;
    planSummary?: string;
    committed: boolean;
    legacyCommitted?: boolean;
    onNextAction: () => void;
    onReviewReadiness: () => void;
    onOpenDecisions: () => void;
    onOpenChallenge: () => void;
    attention?: PlanningAttentionSummary;
    onOpenAttention?: (destination: PlanningDestination) => void;
}

const phaseTone: Record<PlanningReadiness['phase'], string> = {
    exploring: 'border-sky-200 bg-sky-50 text-sky-950',
    needs_decisions: 'border-amber-200 bg-amber-50 text-amber-950',
    ready_to_challenge: 'border-indigo-200 bg-indigo-50 text-indigo-950',
    needs_alignment: 'border-orange-200 bg-orange-50 text-orange-950',
    ready_to_build: 'border-emerald-200 bg-emerald-50 text-emerald-950',
};

export function PlanningStateBar({ readiness, planSummary, committed, legacyCommitted = false, onNextAction, onReviewReadiness, onOpenDecisions, onOpenChallenge, attention, onOpenAttention }: Props) {
    const nextGoesToChallenge = readiness.nextAction.kind === 'challenge_plan';
    const commitmentCondition: ProjectCommitmentCondition = legacyCommitted
        ? 'legacy_commitment'
        : committed
            ? readiness.isReadyToBuild ? 'plan_committed' : 'proceeding_with_accepted_risk'
            : 'working_plan';
    const commitmentCopy = projectCommitmentCopy(commitmentCondition);
    const readinessCopy = planningReadinessCopy(readiness.phase);
    const primaryAttention = attention?.primary;
    const alignmentCriterion = readiness.criteria.find(item => item.id === 'alignment');
    const alignmentSummary = alignmentCriterion?.status === 'met'
        ? 'Aligned with the current plan'
        : alignmentCriterion?.status === 'not_started'
            ? 'No downstream review needed yet'
            : 'Downstream review needs attention';
    return (
        <section className={`mb-5 rounded-2xl border p-4 sm:p-5 ${phaseTone[readiness.phase]}`} aria-labelledby="planning-state-heading">
            {planSummary && (
                <div className="mb-4 border-b border-current/10 pb-4">
                    <p className="text-[11px] font-bold uppercase tracking-wider opacity-60">Current plan</p>
                    <p className="mt-1 max-w-3xl text-sm leading-6 opacity-85">{planSummary}</p>
                </div>
            )}
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="inline-flex items-center gap-1 rounded-full bg-white/70 px-2 py-1 text-[11px] font-bold uppercase tracking-wider">
                            {committed || legacyCommitted ? <CheckCircle2 size={12} /> : <Compass size={12} />}
                            {commitmentCopy.label}
                        </span>
                        {readiness.unresolvedCount > 0 && <span className="text-xs font-semibold">{readiness.unresolvedCount} unresolved</span>}
                        {readiness.conflictCount > 0 && <span className="text-xs font-semibold">{readiness.conflictCount} conflict{readiness.conflictCount === 1 ? '' : 's'}</span>}
                    </div>
                    <h2 id="planning-state-heading" className="mt-2 text-lg font-bold tracking-tight">{readinessCopy.label}</h2>
                    <p className="mt-1 max-w-2xl text-sm leading-6 opacity-80">{readiness.summary}</p>
                </div>
                <button type="button" onClick={nextGoesToChallenge ? onOpenChallenge : onNextAction} className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-neutral-950 px-4 text-sm font-semibold text-white hover:bg-neutral-800">
                    {primaryAttention?.actionLabel ?? readiness.nextAction.label}<ArrowRight size={15} />
                </button>
            </div>
            <div className="mt-4 grid gap-px overflow-hidden rounded-xl bg-current/10 sm:grid-cols-2">
                <div className="bg-white/70 px-3 py-3">
                    <p className="text-[11px] font-bold uppercase tracking-wider opacity-60">Uncertainty</p>
                    <p className="mt-1 text-sm font-semibold">{readiness.unresolvedCount} unresolved · {readiness.assumptionCount} assumption{readiness.assumptionCount === 1 ? '' : 's'}</p>
                </div>
                <div className="bg-white/70 px-3 py-3">
                    <p className="text-[11px] font-bold uppercase tracking-wider opacity-60">Downstream alignment</p>
                    <p className="mt-1 text-sm font-semibold">{alignmentSummary}</p>
                </div>
            </div>
            <div className="mt-3 rounded-xl bg-white/65 px-3 py-3">
                <p className="text-xs font-bold uppercase tracking-wider opacity-60">Most valuable next step</p>
                <p className="mt-1 text-sm font-semibold">{primaryAttention?.title ?? readiness.nextAction.detail}</p>
                {primaryAttention?.why && primaryAttention.why !== primaryAttention.title && <p className="mt-1 text-xs leading-5 opacity-70">{primaryAttention.why}</p>}
            </div>
            {attention && attention.secondary.length > 0 && onOpenAttention && (
                <details className="mt-3 rounded-xl bg-white/45 px-3 py-1 group">
                    <summary className="flex min-h-10 cursor-pointer list-none items-center gap-2 text-sm font-semibold opacity-75">
                        <ChevronDown size={15} className="transition group-open:rotate-180" />
                        Other items needing attention
                        {attention.hiddenCount > 0 && <span className="text-xs font-medium opacity-60">+{attention.hiddenCount} more</span>}
                    </summary>
                    <div className="border-t border-current/10 py-2">
                        {attention.secondary.map(item => (
                            <button
                                key={item.key}
                                type="button"
                                onClick={() => onOpenAttention(item.destination)}
                                className="flex min-h-11 w-full items-center justify-between gap-3 rounded-lg px-2 py-2 text-left hover:bg-white/70"
                            >
                                <span className="min-w-0">
                                    <span className="block text-sm font-semibold">{item.title}</span>
                                    <span className="mt-0.5 block text-xs leading-5 opacity-70">{item.why}</span>
                                </span>
                                <span className="shrink-0 text-xs font-semibold">{item.actionLabel}</span>
                            </button>
                        ))}
                    </div>
                </details>
            )}
            <details className="mt-3 group">
                <summary className="flex min-h-10 cursor-pointer list-none items-center gap-2 text-sm font-semibold opacity-75">
                    <ChevronDown size={15} className="transition group-open:rotate-180" /> Review details and planning tools
                </summary>
                <div className="mt-2 rounded-xl bg-white/45 p-2">
                    <div className="grid gap-2 sm:grid-cols-2">
                        {readiness.criteria.map(item => (
                            <div key={item.id} className="flex items-start gap-2 rounded-lg bg-white/60 p-3">
                                {item.status === 'met' ? <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-emerald-600" /> : item.status === 'attention' ? <AlertTriangle size={15} className="mt-0.5 shrink-0 text-amber-600" /> : <Circle size={15} className="mt-0.5 shrink-0 text-neutral-400" />}
                                <div><p className="text-sm font-semibold">{item.label}</p><p className="mt-0.5 text-xs leading-5 opacity-70">{item.explanation}</p></div>
                            </div>
                        ))}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2 border-t border-current/10 px-1 pt-3 text-xs font-semibold">
                        <button type="button" onClick={onReviewReadiness} className="min-h-10 underline decoration-current/30 underline-offset-4 hover:decoration-current">Review readiness</button>
                        <button type="button" onClick={onOpenDecisions} className="min-h-10 underline decoration-current/30 underline-offset-4 hover:decoration-current">Open Decision Center</button>
                        <button type="button" onClick={onOpenChallenge} className="inline-flex min-h-10 items-center gap-1 underline decoration-current/30 underline-offset-4 hover:decoration-current"><ShieldCheck size={12} /> Challenge this plan</button>
                    </div>
                </div>
            </details>
        </section>
    );
}
