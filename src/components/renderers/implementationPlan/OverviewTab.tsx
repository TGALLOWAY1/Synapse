import { ChevronRight, Flag, Layers, Sparkles } from 'lucide-react';
import type { ConsolidatedImplementationPlan } from '../../../types';
import { implementationPlanAnchor } from '../../../lib/planning/implementationPlanNavigation';

interface Props {
    plan: ConsolidatedImplementationPlan;
    /** Jump to a milestone on the Roadmap tab (expanded + scrolled to). */
    onOpenMilestone: (milestoneId: string) => void;
    onOpenRoadmap: () => void;
}

/**
 * The Build Brief tab: strategy + stack context, a scannable milestone
 * timeline, and risks in their own card — kept separate from the readiness
 * signal in the header. The build timeline is the single sequencing view;
 * the redundant critical-path chip row was removed.
 */
export function OverviewTab({ plan, onOpenMilestone, onOpenRoadmap }: Props) {
    return (
        <div className="space-y-4">
            {/* Build strategy + stack */}
            {(plan.summary.buildStrategy || (plan.summary.stackSummary?.length ?? 0) > 0 || plan.summary.teamAssumption) && (
                <div className="bg-white rounded-xl border border-neutral-200 p-4 space-y-3">
                    {plan.summary.buildStrategy && (
                        <div>
                            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-neutral-500 mb-1">
                                <Sparkles size={11} /> Build Strategy
                            </p>
                            <p className="text-sm text-neutral-800">{plan.summary.buildStrategy}</p>
                        </div>
                    )}
                    {(plan.summary.stackSummary?.length ?? 0) > 0 && (
                        <div>
                            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-neutral-500 mb-1.5">
                                <Layers size={11} /> Stack
                            </p>
                            <div className="flex flex-wrap gap-1.5">
                                {plan.summary.stackSummary!.map((s, i) => (
                                    <span key={i} className="text-xs px-2 py-0.5 rounded-full bg-neutral-100 text-neutral-700 border border-neutral-200">
                                        {s}
                                    </span>
                                ))}
                            </div>
                        </div>
                    )}
                    {plan.summary.teamAssumption && (
                        <p className="text-xs text-neutral-700">
                            <span className="font-semibold text-neutral-600">Team: </span>
                            {plan.summary.teamAssumption}
                        </p>
                    )}
                </div>
            )}

            {/* Build timeline */}
            {plan.milestones.length > 0 && (
                <div className="bg-white rounded-xl border border-neutral-200 p-4">
                    <div className="flex items-center justify-between gap-2 mb-3">
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
                            Build Timeline
                        </p>
                        <button
                            type="button"
                            onClick={onOpenRoadmap}
                            className="text-xs font-medium text-indigo-600 hover:text-indigo-800 transition"
                        >
                            Open roadmap →
                        </button>
                    </div>
                    <ol className="relative space-y-0">
                        {plan.milestones.map((m, i) => {
                            const facts = [
                                m.estimatedEffort ?? m.timeframe,
                                `${m.tasks.length} tasks`,
                                `${m.promptPacks?.length ?? 0} prompts`,
                            ].filter(Boolean) as string[];
                            const last = i === plan.milestones.length - 1;
                            return (
                                <li key={m.id} className="relative flex gap-3 pb-1">
                                    {/* Connector */}
                                    {!last && (
                                        <span aria-hidden="true" className="absolute left-3 top-7 bottom-0 w-px bg-indigo-100" />
                                    )}
                                    <span className="relative z-10 shrink-0 inline-flex items-center justify-center w-6 h-6 mt-1 rounded-full bg-indigo-50 text-indigo-700 text-[11px] font-bold border border-indigo-200">
                                        {i + 1}
                                    </span>
                                    <button
                                        type="button"
                                        onClick={() => onOpenMilestone(m.id)}
                                        className="flex-1 min-w-0 text-left rounded-lg px-2 py-1.5 -mx-2 hover:bg-neutral-50 transition group"
                                    >
                                        <span className="flex items-center gap-1.5 min-w-0">
                                            <span className="text-sm font-medium text-neutral-900 truncate group-hover:text-indigo-700">
                                                {m.name}
                                            </span>
                                            <ChevronRight size={13} className="shrink-0 text-neutral-300 group-hover:text-indigo-500" />
                                        </span>
                                        <span className="block text-[11px] text-neutral-500 truncate">
                                            {facts.join(' · ')}
                                        </span>
                                    </button>
                                </li>
                            );
                        })}
                    </ol>
                </div>
            )}

            {/* Risks & constraints — separated from readiness so the green
                signal stays trustworthy. */}
            {plan.risks.length > 0 && (
                <div className="bg-white rounded-xl border border-neutral-200 p-4">
                    <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-neutral-500 mb-2">
                        <Flag size={11} /> Risks &amp; Constraints
                    </p>
                    <ul className="divide-y divide-neutral-100">
                        {plan.risks.map((r, i) => (
                            <li id={implementationPlanAnchor.risk(i)} tabIndex={-1} key={i} className="flex scroll-mt-24 items-start gap-2 py-2 first:pt-0 last:pb-0">
                                <Flag size={13} className="mt-0.5 shrink-0 text-red-500" />
                                <div className="min-w-0">
                                    <p className="text-sm text-neutral-800">{r.description}</p>
                                    {r.mitigation && (
                                        <p className="text-xs text-neutral-500 mt-0.5">
                                            <span className="font-semibold text-neutral-600">Recommended handling: </span>
                                            {r.mitigation}
                                        </p>
                                    )}
                                </div>
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {/* Architecture decisions (legacy content preservation) */}
            {plan.architecture.length > 0 && (
                <div className="bg-white rounded-xl border border-neutral-200 p-4">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500 mb-1.5">Architecture Decisions</p>
                    <ul className="space-y-1 text-sm text-neutral-800">
                        {plan.architecture.map((a, i) => (
                            <li id={implementationPlanAnchor.architecture(i)} tabIndex={-1} key={i} className="flex scroll-mt-24 items-start gap-2">
                                <Layers size={13} className="mt-0.5 shrink-0 text-neutral-400" />
                                <span>{a}</span>
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {/* Unrecognized legacy appendix prose — preserved so nothing is
                lost when an old markdown plan renders through this view. */}
            {plan.appendixNotes && (
                <div className="bg-neutral-50 rounded-xl border border-neutral-200 p-4">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500 mb-1.5">Notes</p>
                    <p className="text-sm text-neutral-700 whitespace-pre-wrap">{plan.appendixNotes}</p>
                </div>
            )}
        </div>
    );
}
