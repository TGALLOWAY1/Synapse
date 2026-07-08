import { AlertTriangle, ArrowRight, CheckCircle2, History, ListChecks, XCircle } from 'lucide-react';
import type { ConsolidatedImplementationPlan, StalenessState } from '../../../types';
import { promptPackToClipboardText } from '../../../lib/services/implementationPlanAdapter';
import type { OrderedPromptPack, PlanScope } from '../../../lib/services/implementationPlanInsights';
import { CopyTextButton } from './CopyTextButton';

const READINESS_STYLE = {
    ready: { icon: CheckCircle2, cls: 'bg-emerald-50 border-emerald-200 text-emerald-800', label: 'Ready to build' },
    needs_review: { icon: AlertTriangle, cls: 'bg-amber-50 border-amber-200 text-amber-800', label: 'Needs review' },
    blocked: { icon: XCircle, cls: 'bg-red-50 border-red-200 text-red-800', label: 'Blocked' },
} as const;

interface Props {
    plan: ConsolidatedImplementationPlan;
    scope: PlanScope;
    /** The recommended next prompt (first uncopied); null when all are copied. */
    nextPack: OrderedPromptPack | null;
    onNextPackCopied?: (packId: string) => void;
    /** "Version 2" — the PRD version this plan was generated from. */
    prdVersionLabel?: string;
    staleness?: StalenessState;
    /** Full plan markdown for the export/copy action. */
    planMarkdown: string;
    savedTaskCount?: number;
    onConvertToTasks?: () => void;
    /** Jump to the Prompts tab (used when every pack is already copied). */
    onOpenPrompts: () => void;
}

/**
 * Executive build card at the top of the Implementation Plan: readiness
 * status, scope counts, provenance, warnings, and the primary "copy next
 * prompt" action — the plan's decision surface, ahead of any tab content.
 */
export function PlanHeader({
    plan,
    scope,
    nextPack,
    onNextPackCopied,
    prdVersionLabel,
    staleness,
    planMarkdown,
    savedTaskCount = 0,
    onConvertToTasks,
    onOpenPrompts,
}: Props) {
    const readiness = READINESS_STYLE[plan.readiness.status];
    const ReadinessIcon = readiness.icon;
    const isStale = staleness && staleness !== 'current';

    const meta: string[] = [
        `${scope.milestones} milestone${scope.milestones === 1 ? '' : 's'}`,
        `${scope.tasks} task${scope.tasks === 1 ? '' : 's'}`,
        `${scope.promptPacks} prompt pack${scope.promptPacks === 1 ? '' : 's'}`,
        `${scope.qualityGates} quality gate${scope.qualityGates === 1 ? '' : 's'}`,
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
                                <History size={11} /> Stale — PRD changed
                            </span>
                        )}
                    </div>
                    <p className="text-[11px] text-neutral-500 mt-1">
                        {prdVersionLabel && <span>Generated from PRD {prdVersionLabel} · </span>}
                        {meta.join(' · ')}
                    </p>
                </div>
            </div>

            {/* Next best action */}
            <div className="rounded-lg border border-indigo-100 bg-indigo-50/60 px-3 py-2.5 flex items-center justify-between gap-3 flex-wrap">
                <p className="flex items-start gap-1.5 text-xs text-indigo-900 min-w-0">
                    <ArrowRight size={13} className="mt-0.5 shrink-0" />
                    {nextPack ? (
                        <span>
                            <span className="font-semibold">Next: </span>
                            {nextPack.milestoneName ? `${nextPack.milestoneName} — ` : ''}
                            copy “{nextPack.pack.title}” into your coding agent.
                        </span>
                    ) : scope.promptPacks > 0 ? (
                        <span>
                            <span className="font-semibold">All prompt packs copied.</span>{' '}
                            Run your quality gates, then mark them Passed on the Validation tab.
                        </span>
                    ) : (
                        <span>{plan.readiness.recommendedNextStep ?? 'Generate the Implementation Plan to get a milestone roadmap.'}</span>
                    )}
                </p>
                {/* min-w-0 (not shrink-0) so the row wraps on narrow screens
                    instead of forcing horizontal page scroll. */}
                <div className="flex items-center gap-2 flex-wrap min-w-0">
                    {nextPack ? (
                        <CopyTextButton
                            text={promptPackToClipboardText(nextPack.pack)}
                            label="Copy next prompt"
                            onCopied={onNextPackCopied ? () => onNextPackCopied(nextPack.pack.id) : undefined}
                        />
                    ) : scope.promptPacks > 0 ? (
                        <button
                            type="button"
                            onClick={onOpenPrompts}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-md border border-indigo-200 text-indigo-700 hover:bg-indigo-100 transition min-h-[32px]"
                        >
                            Review prompts
                        </button>
                    ) : null}
                    {onConvertToTasks && (
                        <button
                            type="button"
                            onClick={onConvertToTasks}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md border border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50 transition min-h-[32px]"
                        >
                            <ListChecks size={12} />
                            {savedTaskCount > 0 ? `Manage tasks (${savedTaskCount})` : 'Convert to tasks'}
                        </button>
                    )}
                    <CopyTextButton text={planMarkdown} label="Copy plan" variant="secondary" />
                </div>
            </div>

            {/* Real readiness problems only — risks live in their own card. */}
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
