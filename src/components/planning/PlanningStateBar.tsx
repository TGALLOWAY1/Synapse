import { AlertTriangle, ArrowRight, CheckCircle2, ChevronDown, Circle, Compass, ShieldCheck } from 'lucide-react';
import type { PlanningReadiness } from '../../lib/planning';

interface Props {
    readiness: PlanningReadiness;
    committed: boolean;
    legacyCommitted?: boolean;
    onNextAction: () => void;
    onReviewReadiness: () => void;
    onOpenDecisions: () => void;
    onOpenChallenge: () => void;
}

const phaseTone: Record<PlanningReadiness['phase'], string> = {
    exploring: 'border-sky-200 bg-sky-50 text-sky-950',
    needs_decisions: 'border-amber-200 bg-amber-50 text-amber-950',
    ready_to_challenge: 'border-indigo-200 bg-indigo-50 text-indigo-950',
    needs_alignment: 'border-orange-200 bg-orange-50 text-orange-950',
    ready_to_build: 'border-emerald-200 bg-emerald-50 text-emerald-950',
};

export function PlanningStateBar({ readiness, committed, legacyCommitted = false, onNextAction, onReviewReadiness, onOpenDecisions, onOpenChallenge }: Props) {
    const nextGoesToChallenge = readiness.nextAction.kind === 'challenge_plan';
    return (
        <section className={`mb-5 rounded-2xl border p-4 sm:p-5 ${phaseTone[readiness.phase]}`} aria-labelledby="planning-state-heading">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="inline-flex items-center gap-1 rounded-full bg-white/70 px-2 py-1 text-[11px] font-bold uppercase tracking-wider">
                            {committed || legacyCommitted ? <CheckCircle2 size={12} /> : <Compass size={12} />}
                            {legacyCommitted
                                ? 'Legacy commitment · readiness not recorded'
                                : committed
                                    ? readiness.isReadyToBuild ? 'Plan committed' : 'Committed with open questions'
                                    : 'Working plan'}
                        </span>
                        {readiness.unresolvedCount > 0 && <span className="text-xs font-semibold">{readiness.unresolvedCount} unresolved</span>}
                        {readiness.conflictCount > 0 && <span className="text-xs font-semibold">{readiness.conflictCount} conflict{readiness.conflictCount === 1 ? '' : 's'}</span>}
                    </div>
                    <h2 id="planning-state-heading" className="mt-2 text-lg font-bold tracking-tight">{readiness.headline}</h2>
                    <p className="mt-1 max-w-2xl text-sm leading-6 opacity-80">{readiness.summary}</p>
                </div>
                <button type="button" onClick={nextGoesToChallenge ? onOpenChallenge : onNextAction} className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-neutral-950 px-4 text-sm font-semibold text-white hover:bg-neutral-800">
                    {readiness.nextAction.label}<ArrowRight size={15} />
                </button>
            </div>
            <div className="mt-4 rounded-xl bg-white/65 px-3 py-3">
                <p className="text-xs font-bold uppercase tracking-wider opacity-60">Most valuable next step</p>
                <p className="mt-1 text-sm font-semibold">{readiness.nextAction.detail}</p>
            </div>
            <details className="mt-3 group">
                <summary className="flex min-h-10 cursor-pointer list-none items-center gap-2 text-sm font-semibold opacity-75">
                    <ChevronDown size={15} className="transition group-open:rotate-180" /> Why Synapse sees it this way
                </summary>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    {readiness.criteria.map(item => (
                        <div key={item.id} className="flex items-start gap-2 rounded-lg bg-white/60 p-3">
                            {item.status === 'met' ? <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-emerald-600" /> : item.status === 'attention' ? <AlertTriangle size={15} className="mt-0.5 shrink-0 text-amber-600" /> : <Circle size={15} className="mt-0.5 shrink-0 text-neutral-400" />}
                            <div><p className="text-sm font-semibold">{item.label}</p><p className="mt-0.5 text-xs leading-5 opacity-70">{item.explanation}</p></div>
                        </div>
                    ))}
                </div>
            </details>
            <div className="mt-3 flex flex-wrap gap-3 text-xs font-semibold">
                <button type="button" onClick={onReviewReadiness} className="underline decoration-current/30 underline-offset-4 hover:decoration-current">Review readiness</button>
                <button type="button" onClick={onOpenDecisions} className="underline decoration-current/30 underline-offset-4 hover:decoration-current">Open all decisions</button>
                <button type="button" onClick={onOpenChallenge} className="inline-flex items-center gap-1 underline decoration-current/30 underline-offset-4 hover:decoration-current"><ShieldCheck size={12} /> Challenge this plan</button>
            </div>
        </section>
    );
}
