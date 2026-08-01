import { AlertTriangle, CheckCircle2, History, XCircle } from 'lucide-react';
import type { ConsolidatedImplementationPlan } from '../../../types';
import type { DependencyNodeStatus } from '../../../lib/artifactDependencyGraph';
import { isStaleStatus } from '../../../lib/artifactFreshness';
import type { PlanScope } from '../../../lib/services/implementationPlanInsights';

const READINESS_STYLE = {
    ready: { icon: CheckCircle2, cls: 'bg-emerald-50 border-emerald-200 text-emerald-800', label: 'Plan complete' },
    needs_review: { icon: AlertTriangle, cls: 'bg-amber-50 border-amber-200 text-amber-800', label: 'Needs review' },
    blocked: { icon: XCircle, cls: 'bg-red-50 border-red-200 text-red-800', label: 'Blocked' },
} as const;

interface Props {
    plan: ConsolidatedImplementationPlan;
    scope: PlanScope;
    /** "Version 2" — the PRD version this plan was generated from. */
    prdVersionLabel?: string;
    staleness?: DependencyNodeStatus;
}

/**
 * Identity strip for the Implementation Plan: title, the ADAPTER's own
 * plan-shape readiness (did the plan parse into a usable shape?), provenance and
 * scope counts.
 *
 * IT HOLDS NO ACTIONS. Until plan §W7 this card was the plan's decision surface
 * and rendered FOUR competing actions — "Copy next prompt" styled primary
 * regardless of blockers, plus Review prompts, Convert/Manage tasks and Copy
 * plan. Every action now lives in `FinalReviewCard`, which promotes exactly one
 * primary from §W6's build-packet evaluation. Do not re-add an action here: a
 * second primary on this surface is the defect §W7 fixed.
 *
 * `plan.readiness` is also NOT the build-readiness signal — it only reports
 * whether the adapter could build a usable plan view model. The build-packet
 * state is in Final Review below.
 */
export function PlanHeader({ plan, scope, prdVersionLabel, staleness }: Props) {
    const readiness = READINESS_STYLE[plan.readiness.status];
    const ReadinessIcon = readiness.icon;
    const isStale = isStaleStatus(staleness);

    const meta: string[] = [
        `${scope.milestones} milestone${scope.milestones === 1 ? '' : 's'}`,
        `${scope.tasks} task${scope.tasks === 1 ? '' : 's'}`,
        `${scope.promptPacks} prompt pack${scope.promptPacks === 1 ? '' : 's'}`,
    ];
    if (plan.summary.estimatedEffort) meta.push(plan.summary.estimatedEffort);

    return (
        <div className="bg-white rounded-xl border border-neutral-200 p-4 space-y-3">
            <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                        <h2 className="text-base font-bold text-neutral-900">{plan.title}</h2>
                        <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full border ${readiness.cls}`}>
                            <ReadinessIcon size={11} /> {readiness.label}
                        </span>
                        {isStale && (
                            <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full border bg-amber-50 border-amber-200 text-amber-800">
                                <History size={11} /> Needs update
                            </span>
                        )}
                    </div>
                    <p className="text-[11px] text-neutral-500 mt-1">
                        {prdVersionLabel && <span>Generated from PRD {prdVersionLabel} · </span>}
                        {meta.join(' · ')}
                    </p>
                </div>
            </div>

            {/* Plan-shape problems only — build-packet blockers live in Final
                Review, and risks live in their own card. */}
            {(plan.readiness.missingInputs.length > 0 || plan.readiness.warnings.length > 0) && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 space-y-1">
                    {plan.readiness.missingInputs.length > 0 && (
                        <p className="text-xs text-amber-800">
                            <span className="font-semibold">Missing inputs:</span>{' '}
                            {plan.readiness.missingInputs.join(', ')}
                        </p>
                    )}
                    {plan.readiness.warnings.map((w, i) => (
                        <p key={i} className="flex items-start gap-1.5 text-xs text-amber-800">
                            <AlertTriangle size={11} className="mt-0.5 shrink-0" />
                            {w}
                        </p>
                    ))}
                </div>
            )}
        </div>
    );
}
