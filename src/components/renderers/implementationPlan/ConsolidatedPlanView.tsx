import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, ClipboardList } from 'lucide-react';
import type { ConsolidatedImplementationPlan, ProjectTask, StalenessState } from '../../../types';
import {
    collectAllPromptPacks,
    consolidatedPlanToMarkdown,
    promptPackToClipboardText,
} from '../../../lib/services/implementationPlanAdapter';
import {
    computePlanScope,
    findNextPromptPack,
    orderPromptPacks,
    EMPTY_PLAN_PROGRESS,
    type ImplementationPlanProgress,
    type QualityGateRunStatus,
} from '../../../lib/services/implementationPlanInsights';
import { CopyTextButton } from './CopyTextButton';
import { MilestoneCard } from './MilestoneCard';
import { PromptPackCard } from './PromptPackCard';
import { PlanHeader } from './PlanHeader';
import { OverviewTab } from './OverviewTab';
import { ValidationTab } from './ValidationTab';
import { CoverageTab } from './CoverageTab';

type TabId = 'overview' | 'milestones' | 'prompt_packs' | 'quality_gates' | 'traceability';

interface Props {
    plan: ConsolidatedImplementationPlan;
    /** "Version 2" — the PRD version this plan was generated from. */
    prdVersionLabel?: string;
    staleness?: StalenessState;
    /** Source artifact versions recorded at generation time ("Data Model v1"). */
    sourceVersions?: string[];
    /** Saved (converted) tasks for this artifact — marks plan tasks as tracked. */
    savedTasks?: ProjectTask[];
    onConvertToTasks?: () => void;
    /** Persisted copy/gate progress (`metadata.planProgress`); falls back to
     * session-local state when persistence isn't wired (tests, previews). */
    progress?: ImplementationPlanProgress;
    onUpdateProgress?: (next: ImplementationPlanProgress) => void;
    initialMilestoneId?: string;
}

/**
 * The consolidated Implementation Plan view — a guided build launcher, not a
 * generated report: executive header (status, scope, copy-next-prompt),
 * Build Brief / Roadmap / Prompts / Validation / Coverage tabs, honest gate
 * statuses, and coverage/impact analysis. Tab ids keep the internal
 * milestone/prompt-pack/quality-gate vocabulary; only labels changed.
 *
 * Tabs scroll horizontally on mobile; the coverage matrix renders as a table
 * on desktop and stacked cards on small screens.
 */
export function ConsolidatedPlanView({
    plan,
    prdVersionLabel,
    staleness,
    sourceVersions,
    savedTasks,
    onConvertToTasks,
    progress: externalProgress,
    onUpdateProgress,
    initialMilestoneId,
}: Props) {
    const initialMilestoneExists = Boolean(initialMilestoneId
        && plan.milestones.some(milestone => milestone.id === initialMilestoneId));
    const [tab, setTab] = useState<TabId>(initialMilestoneExists ? 'milestones' : 'overview');
    const [focusMilestoneId, setFocusMilestoneId] = useState<string | null>(initialMilestoneExists ? initialMilestoneId! : null);
    // Session-local fallback so copy/gate tracking still works when no
    // persistence callback is wired (e.g. isolated renders).
    const [localProgress, setLocalProgress] = useState<ImplementationPlanProgress>(EMPTY_PLAN_PROGRESS);
    const progress = externalProgress ?? localProgress;
    const updateProgress = (next: ImplementationPlanProgress) => {
        if (onUpdateProgress) onUpdateProgress(next);
        else setLocalProgress(next);
    };
    // Single update for N packs — bulk copy actions ("Copy all", "Copy
    // milestone prompts") must advance the next-prompt pointer too, and a
    // per-id loop would clobber itself on the stale `progress` closure.
    const markPacksCopied = (packIds: string[]) => {
        const missing = packIds.filter(id => !progress.copiedPacks.includes(id));
        if (missing.length === 0) return;
        updateProgress({ ...progress, copiedPacks: [...progress.copiedPacks, ...missing] });
    };
    const markPackCopied = (packId: string) => markPacksCopied([packId]);
    const setGateStatus = (gateId: string, status: QualityGateRunStatus) => {
        updateProgress({ ...progress, gateStatuses: { ...progress.gateStatuses, [gateId]: status } });
    };

    const milestoneNameById = useMemo(() => {
        const map = new Map<string, string>();
        plan.milestones.forEach(m => map.set(m.id, m.name));
        return map;
    }, [plan]);

    const savedTaskById = useMemo(() => {
        const map = new Map<string, ProjectTask>();
        (savedTasks ?? []).forEach(t => map.set(t.id, t));
        return map;
    }, [savedTasks]);

    const scope = useMemo(() => computePlanScope(plan), [plan]);
    const ordered = useMemo(() => orderPromptPacks(plan), [plan]);
    const copiedPackIds = useMemo(() => new Set(progress.copiedPacks), [progress.copiedPacks]);
    const nextPack = useMemo(() => findNextPromptPack(ordered, copiedPackIds), [ordered, copiedPackIds]);
    const allPacks = useMemo(() => collectAllPromptPacks(plan), [plan]);
    const planMarkdown = useMemo(() => consolidatedPlanToMarkdown(plan), [plan]);
    const gateCount = scope.qualityGates;

    const openMilestone = (milestoneId: string) => {
        setTab('milestones');
        setFocusMilestoneId(milestoneId);
    };

    // Scroll a focused milestone into view once the Roadmap tab has rendered.
    useEffect(() => {
        if (tab !== 'milestones' || !focusMilestoneId) return;
        document.getElementById(`impl-milestone-${focusMilestoneId}`)
            ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, [tab, focusMilestoneId]);

    const tabs: Array<{ id: TabId; label: string; count?: number }> = [
        { id: 'overview', label: 'Build Brief' },
        { id: 'milestones', label: 'Roadmap', count: plan.milestones.length },
        { id: 'prompt_packs', label: 'Prompts', count: allPacks.length },
        { id: 'quality_gates', label: 'Validation', count: gateCount },
        { id: 'traceability', label: 'Coverage' },
    ];

    return (
        <div className="space-y-4 not-prose">
            <PlanHeader
                plan={plan}
                scope={scope}
                nextPack={nextPack}
                onNextPackCopied={markPackCopied}
                prdVersionLabel={prdVersionLabel}
                staleness={staleness}
                planMarkdown={planMarkdown}
                savedTaskCount={savedTasks?.length ?? 0}
                onConvertToTasks={onConvertToTasks}
                onOpenPrompts={() => setTab('prompt_packs')}
            />

            {/* --- Tab nav (scrolls horizontally on mobile) ------------------ */}
            <nav aria-label="Implementation plan sections" className="border-b border-neutral-200 -mx-1 px-1 overflow-x-auto">
                <div className="flex gap-1 whitespace-nowrap">
                    {tabs.map(t => {
                        const active = tab === t.id;
                        return (
                            <button
                                key={t.id}
                                type="button"
                                onClick={() => setTab(t.id)}
                                className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors min-h-[40px] ${
                                    active
                                        ? 'border-indigo-600 text-indigo-700'
                                        : 'border-transparent text-neutral-600 hover:text-neutral-900'
                                }`}
                            >
                                {t.label}
                                {typeof t.count === 'number' && t.count > 0 && (
                                    <span className="ml-1.5 text-[10px] text-neutral-500">({t.count})</span>
                                )}
                            </button>
                        );
                    })}
                </div>
            </nav>

            {tab === 'overview' && (
                <OverviewTab
                    plan={plan}
                    onOpenMilestone={openMilestone}
                    onOpenRoadmap={() => setTab('milestones')}
                />
            )}

            {tab === 'milestones' && (
                <div className="space-y-3">
                    {plan.milestones.length === 0 ? (
                        <EmptyNote text="No milestones yet. Generate the Implementation Plan to get a milestone roadmap." />
                    ) : (
                        plan.milestones.map((m, i) => (
                            <MilestoneCard
                                // Remount when this milestone becomes the focus so
                                // defaultExpanded opens it (state is internal).
                                key={`${m.id}${focusMilestoneId === m.id ? ':focus' : ''}`}
                                milestone={m}
                                index={i}
                                milestoneNameById={milestoneNameById}
                                defaultExpanded={i === 0 || focusMilestoneId === m.id}
                                savedTaskById={savedTaskById}
                                gateStatuses={progress.gateStatuses}
                                onSetGateStatus={setGateStatus}
                                copiedPackIds={copiedPackIds}
                                onPackCopied={markPackCopied}
                                onPacksCopied={markPacksCopied}
                            />
                        ))
                    )}
                </div>
            )}

            {tab === 'prompt_packs' && (
                <div className="space-y-4">
                    {ordered.length === 0 ? (
                        <EmptyNote text="No prompt packs yet. Regenerate the Implementation Plan to get copy-ready coding-agent prompts per milestone." />
                    ) : (
                        <>
                            {/* Recommended execution order */}
                            <div className="bg-white rounded-xl border border-neutral-200 p-4">
                                <div className="flex items-start justify-between gap-3 flex-wrap">
                                    <div className="min-w-0">
                                        <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500 mb-1.5">
                                            Recommended Order
                                        </p>
                                        <ol className="space-y-1">
                                            {ordered.map(o => {
                                                const copied = copiedPackIds.has(o.pack.id);
                                                const isNext = nextPack?.pack.id === o.pack.id;
                                                return (
                                                    <li key={o.pack.id} className="flex items-center gap-2 text-xs min-w-0">
                                                        <span className={`shrink-0 inline-flex items-center justify-center w-5 h-5 rounded text-[10px] font-bold border ${
                                                            copied
                                                                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                                                : isNext
                                                                    ? 'bg-indigo-600 text-white border-indigo-600'
                                                                    : 'bg-neutral-100 text-neutral-600 border-neutral-200'
                                                        }`}>
                                                            {o.order}
                                                        </span>
                                                        <span className={`truncate ${copied ? 'text-neutral-400 line-through' : 'text-neutral-800'}`}>
                                                            {o.pack.title}
                                                        </span>
                                                        {isNext && (
                                                            <span className="shrink-0 inline-flex items-center gap-0.5 text-[10px] text-indigo-600 font-semibold">
                                                                <ArrowRight size={10} /> next
                                                            </span>
                                                        )}
                                                    </li>
                                                );
                                            })}
                                        </ol>
                                    </div>
                                    <div className="flex flex-col items-end gap-2 shrink-0">
                                        {nextPack && (
                                            <CopyTextButton
                                                text={promptPackToClipboardText(nextPack.pack)}
                                                label="Copy next prompt"
                                                onCopied={() => markPackCopied(nextPack.pack.id)}
                                            />
                                        )}
                                        <CopyTextButton
                                            text={allPacks.map(promptPackToClipboardText).join('\n\n---\n\n')}
                                            label="Copy all prompt packs"
                                            variant="secondary"
                                            onCopied={() => markPacksCopied(ordered.map(o => o.pack.id))}
                                        />
                                    </div>
                                </div>
                            </div>

                            {plan.milestones.map((m, i) =>
                                (m.promptPacks?.length ?? 0) > 0 ? (
                                    <section key={m.id}>
                                        <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500 mb-2">
                                            Milestone {i + 1} · {m.name}
                                        </p>
                                        <div className="space-y-3">
                                            {m.promptPacks!.map(pack => {
                                                const o = ordered.find(x => x.pack.id === pack.id);
                                                return (
                                                    <PromptPackCard
                                                        key={pack.id}
                                                        pack={pack}
                                                        defaultCollapsed
                                                        orderLabel={o ? `Prompt ${o.order} of ${ordered.length}` : undefined}
                                                        prerequisites={o?.prerequisiteNames ?? []}
                                                        relatedGateTitles={o?.relatedGateTitles ?? []}
                                                        copied={copiedPackIds.has(pack.id)}
                                                        onCopied={() => markPackCopied(pack.id)}
                                                        highlight={nextPack?.pack.id === pack.id}
                                                    />
                                                );
                                            })}
                                        </div>
                                    </section>
                                ) : null,
                            )}
                            {plan.unassignedPromptPacks.length > 0 && (
                                <section>
                                    <p className="text-[11px] font-semibold uppercase tracking-wider text-amber-700 mb-2">
                                        Unassigned Prompt Packs
                                    </p>
                                    <p className="text-xs text-neutral-500 mb-2">
                                        These prompts couldn't be confidently matched to a milestone. They're
                                        still ready to copy — run them where they fit in your build order.
                                    </p>
                                    <div className="space-y-3">
                                        {plan.unassignedPromptPacks.map(pack => {
                                            const o = ordered.find(x => x.pack.id === pack.id);
                                            return (
                                                <PromptPackCard
                                                    key={pack.id}
                                                    pack={pack}
                                                    defaultCollapsed
                                                    orderLabel={o ? `Prompt ${o.order} of ${ordered.length}` : undefined}
                                                    copied={copiedPackIds.has(pack.id)}
                                                    onCopied={() => markPackCopied(pack.id)}
                                                    highlight={nextPack?.pack.id === pack.id}
                                                />
                                            );
                                        })}
                                    </div>
                                </section>
                            )}
                        </>
                    )}
                </div>
            )}

            {tab === 'quality_gates' && (
                <ValidationTab
                    plan={plan}
                    gateStatuses={progress.gateStatuses}
                    onSetGateStatus={setGateStatus}
                />
            )}

            {tab === 'traceability' && (
                <CoverageTab
                    plan={plan}
                    prdVersionLabel={prdVersionLabel}
                    staleness={staleness}
                    sourceVersions={sourceVersions}
                    onOpenMilestone={openMilestone}
                />
            )}

            {/* --- Export / copy actions ------------------------------------- */}
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2.5">
                <ClipboardList size={15} className="text-neutral-400 shrink-0" aria-hidden="true" />
                <p className="text-xs text-neutral-500 mr-auto">Take this plan to your coding agent:</p>
                <CopyTextButton text={planMarkdown} label="Copy plan as markdown" variant="secondary" />
                {allPacks.length > 0 && (
                    <CopyTextButton
                        text={allPacks.map(promptPackToClipboardText).join('\n\n---\n\n')}
                        label="Copy all prompt packs"
                        variant="secondary"
                        onCopied={() => markPacksCopied(ordered.map(o => o.pack.id))}
                    />
                )}
            </div>
        </div>
    );
}

function EmptyNote({ text }: { text: string }) {
    return (
        <div className="bg-white rounded-xl border border-neutral-200 p-5">
            <p className="text-sm text-neutral-500 italic">{text}</p>
        </div>
    );
}
