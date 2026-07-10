import { useState, type ReactNode } from 'react';
import {
    AppWindow, ChevronRight, Cog, GitBranch, Layers, MousePointerClick,
    Sparkles, Workflow,
} from 'lucide-react';
import type { FlowJourneyNode, ParsedStep, FlowJourneyNodeKind } from './types';
import {
    buildJourneyGroups, NODE_KIND_LABEL, nodeKindStyle,
    type FlowJourneyGroup,
} from './journeyNode';
import { stepScreenSlug } from '../../../lib/screenExperience';

interface Props {
    flowIndex: number;
    steps: ParsedStep[];
    issuesByStep: Map<number, number>;
    /**
     * Experience-workspace wiring (all optional — default behavior is
     * unchanged). When a group's screen slug exists in `availableScreenSlugs`,
     * clicking its header fires `onNavigateToScreen` instead of scrolling to
     * the step card.
     */
    onNavigateToScreen?: (screenSlug: string) => void;
    availableScreenSlugs?: ReadonlySet<string>;
    /** Step indices to visually emphasize (the current screen in a Screen
     * Detail "Flow" tab). */
    highlightedStepIndices?: ReadonlySet<number>;
    /**
     * When provided, the journey is the SINGLE rendering of the flow's steps:
     * step rows expand in place to show their full detail (user/system/UI,
     * decisions, branches) instead of scrolling to a duplicate step-card list
     * below (audit H5). Omitted → legacy scroll-to-card behavior.
     */
    renderStepDetail?: (stepIndex: number) => ReactNode;
}

const KIND_ICON: Record<FlowJourneyNodeKind, typeof AppWindow> = {
    screen: AppWindow,
    state: Layers,
    action: MousePointerClick,
    decision: GitBranch,
    system: Cog,
    feature: Sparkles,
};

function NodeBadge({ kind }: { kind: FlowJourneyNodeKind }) {
    const style = nodeKindStyle(kind);
    return (
        <span
            className={`inline-block text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded ${style.badgeBg} ${style.badgeText}`}
        >
            {NODE_KIND_LABEL[kind]}
        </span>
    );
}

function AltBadge({ count }: { count: number }) {
    if (count <= 0) return null;
    return (
        <span
            className="text-[9px] font-semibold px-1 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-200"
            title={`${count} alternate path${count === 1 ? '' : 's'} or edge case${count === 1 ? '' : 's'}`}
        >
            {count} alt
        </span>
    );
}

function Legend() {
    const kinds: FlowJourneyNodeKind[] = ['screen', 'state', 'action', 'decision', 'system'];
    return (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-neutral-600">
            {kinds.map(k => {
                const style = nodeKindStyle(k);
                return (
                    <span key={k} className="inline-flex items-center gap-1">
                        <span className={`inline-block w-2.5 h-2.5 rounded ${style.bg} border ${style.border}`} />
                        {NODE_KIND_LABEL[k]}
                    </span>
                );
            })}
        </div>
    );
}

export function FlowJourney({
    flowIndex, steps, issuesByStep,
    onNavigateToScreen, availableScreenSlugs, highlightedStepIndices,
    renderStepDetail,
}: Props) {
    const [legendOpen, setLegendOpen] = useState(false);
    const [expandedSteps, setExpandedSteps] = useState<ReadonlySet<number>>(new Set());
    const toggleStep = (stepIndex: number) => setExpandedSteps(prev => {
        const next = new Set(prev);
        if (next.has(stepIndex)) next.delete(stepIndex); else next.add(stepIndex);
        return next;
    });
    if (steps.length === 0) return null;
    const groups = buildJourneyGroups(steps, stepScreenSlug);
    const screenStyle = nodeKindStyle('screen');

    const scrollToStep = (stepIndex: number) => {
        const el = document.getElementById(`flow-${flowIndex}-step-${stepIndex}`);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };

    // The screen header navigates to the screen's detail view when its slug is
    // available; otherwise it scrolls to the group's first step card.
    const openGroup = (group: FlowJourneyGroup) => {
        if (onNavigateToScreen && availableScreenSlugs
            && group.screenSlug && availableScreenSlugs.has(group.screenSlug)) {
            onNavigateToScreen(group.screenSlug);
            return;
        }
        scrollToStep(group.firstStepIndex);
    };

    const rangeLabel = (group: FlowJourneyGroup) =>
        group.firstStepIndex === group.lastStepIndex
            ? `Step ${group.firstStepIndex + 1}`
            : `Steps ${group.firstStepIndex + 1}–${group.lastStepIndex + 1}`;

    const isHighlighted = (node: FlowJourneyNode) =>
        highlightedStepIndices?.has(node.stepIndex) ?? false;

    return (
        <section className="bg-white rounded-xl border border-neutral-200 p-4 mb-4">
            <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500 inline-flex items-center gap-1">
                    <Workflow size={11} /> Flow journey
                </p>
                <span className="text-[10px] text-neutral-400">
                    {groups.length} {groups.length === 1 ? 'screen' : 'screens'} · {steps.length} {steps.length === 1 ? 'step' : 'steps'}
                </span>
            </div>

            {/* Screens grouped into cards: the screen name shows once in the
                header, its steps read as sub-rows labeled by user action — so a
                screen that owns several sequential steps is no longer repeated
                node-after-node. */}
            <div className="space-y-3">
                {groups.map(group => {
                    const single = group.nodes.length === 1;
                    const groupHighlighted = group.nodes.some(isHighlighted);

                    if (single) {
                        const node = group.nodes[0];
                        const highlighted = isHighlighted(node);
                        const alt = issuesByStep.get(node.stepIndex) ?? 0;
                        const stepExpanded = expandedSteps.has(node.stepIndex);
                        return (
                            <div
                                key={group.firstStepIndex}
                                className={`rounded-xl border ${screenStyle.border} ${screenStyle.bg} transition ${
                                    highlighted ? 'ring-2 ring-offset-1 ring-indigo-500' : ''
                                }`}
                            >
                                <button
                                    type="button"
                                    onClick={() => openGroup(group)}
                                    aria-current={highlighted ? 'true' : undefined}
                                    className="group w-full text-left rounded-xl hover:ring-2 hover:ring-offset-1 hover:ring-indigo-300 transition"
                                >
                                    <div className="flex items-center gap-2.5 px-3 py-2.5">
                                        <span className={`shrink-0 inline-flex items-center justify-center w-6 h-6 rounded ${screenStyle.badgeBg} ${screenStyle.badgeText}`}>
                                            <AppWindow size={13} />
                                        </span>
                                        <span className="min-w-0 flex-1">
                                            <span className={`flex items-center gap-2`}>
                                                <span className={`min-w-0 truncate text-[13px] font-semibold leading-snug ${screenStyle.text}`} title={group.screenLabel}>
                                                    {group.screenLabel}
                                                </span>
                                                <span className="shrink-0 text-[9px] font-semibold uppercase tracking-wider text-neutral-400 tabular-nums">
                                                    {rangeLabel(group)}
                                                </span>
                                            </span>
                                            <span className="mt-1 flex items-center gap-2 flex-wrap">
                                                {node.action && (
                                                    <span className="text-[12px] text-neutral-600 leading-snug">{node.action}</span>
                                                )}
                                                <NodeBadge kind={node.kind} />
                                                <AltBadge count={alt} />
                                            </span>
                                        </span>
                                        <ChevronRight
                                            size={14}
                                            className="shrink-0 text-neutral-300 group-hover:text-indigo-400 transition-colors"
                                            aria-hidden="true"
                                        />
                                    </div>
                                </button>
                                {renderStepDetail && (
                                    <div className="px-3 pb-2">
                                        <button
                                            type="button"
                                            onClick={() => toggleStep(node.stepIndex)}
                                            aria-expanded={stepExpanded}
                                            className="inline-flex items-center gap-1 text-[10px] font-medium text-neutral-400 hover:text-neutral-600 transition-colors"
                                        >
                                            <ChevronRight
                                                size={11}
                                                className={`transition-transform ${stepExpanded ? 'rotate-90' : ''}`}
                                                aria-hidden="true"
                                            />
                                            Step detail
                                        </button>
                                        {stepExpanded && (
                                            <div className="mt-1">{renderStepDetail(node.stepIndex)}</div>
                                        )}
                                    </div>
                                )}
                            </div>
                        );
                    }

                    return (
                        <div
                            key={group.firstStepIndex}
                            className={`rounded-xl border overflow-hidden ${
                                groupHighlighted ? 'border-indigo-300 ring-2 ring-offset-1 ring-indigo-200' : 'border-neutral-200'
                            }`}
                        >
                            {/* Screen header — one label for the whole run. */}
                            <button
                                type="button"
                                onClick={() => openGroup(group)}
                                className={`group w-full text-left flex items-center gap-2.5 px-3 py-2.5 ${screenStyle.bg} border-b ${screenStyle.border} hover:brightness-[0.98] transition`}
                            >
                                <span className={`shrink-0 inline-flex items-center justify-center w-6 h-6 rounded ${screenStyle.badgeBg} ${screenStyle.badgeText}`}>
                                    <AppWindow size={13} />
                                </span>
                                <span className={`min-w-0 flex-1 truncate text-[13px] font-semibold leading-snug ${screenStyle.text}`} title={group.screenLabel}>
                                    {group.screenLabel}
                                </span>
                                <span className="shrink-0 text-[9px] font-semibold uppercase tracking-wider text-neutral-400 tabular-nums">
                                    {rangeLabel(group)}
                                </span>
                                <ChevronRight
                                    size={14}
                                    className="shrink-0 text-neutral-300 group-hover:text-indigo-400 transition-colors"
                                    aria-hidden="true"
                                />
                            </button>

                            {/* Sub-steps — labeled by user action, with the step
                                number preserved and its kind badge. */}
                            <ul className="divide-y divide-neutral-100 bg-white">
                                {group.nodes.map(node => {
                                    const highlighted = isHighlighted(node);
                                    const alt = issuesByStep.get(node.stepIndex) ?? 0;
                                    const Icon = KIND_ICON[node.kind];
                                    const style = nodeKindStyle(node.kind);
                                    const stepExpanded = expandedSteps.has(node.stepIndex);
                                    return (
                                        <li key={node.stepIndex}>
                                            <button
                                                type="button"
                                                onClick={() => (renderStepDetail
                                                    ? toggleStep(node.stepIndex)
                                                    : scrollToStep(node.stepIndex))}
                                                aria-current={highlighted ? 'true' : undefined}
                                                aria-expanded={renderStepDetail ? stepExpanded : undefined}
                                                className={`group w-full text-left flex items-center gap-2.5 px-3 py-2 hover:bg-neutral-50 transition ${
                                                    highlighted ? 'bg-indigo-50/60' : ''
                                                }`}
                                            >
                                                <span className="shrink-0 inline-flex items-center justify-center w-[18px] h-[18px] rounded-full bg-neutral-50 border border-neutral-200 text-[10px] font-bold text-neutral-500 tabular-nums">
                                                    {node.stepIndex + 1}
                                                </span>
                                                <span className={`shrink-0 inline-flex items-center justify-center w-5 h-5 rounded ${style.badgeBg} ${style.badgeText}`}>
                                                    <Icon size={12} />
                                                </span>
                                                <span className="min-w-0 flex-1">
                                                    <span className="block text-[12.5px] text-neutral-800 leading-snug truncate" title={node.action || node.label}>
                                                        {node.action || node.label}
                                                    </span>
                                                    <span className="mt-1 flex items-center gap-1.5 flex-wrap">
                                                        <NodeBadge kind={node.kind} />
                                                        <AltBadge count={alt} />
                                                    </span>
                                                </span>
                                                <ChevronRight
                                                    size={13}
                                                    className={`shrink-0 text-neutral-300 group-hover:text-indigo-400 transition-all ${
                                                        renderStepDetail && stepExpanded ? 'rotate-90' : ''
                                                    }`}
                                                    aria-hidden="true"
                                                />
                                            </button>
                                            {renderStepDetail && stepExpanded && (
                                                <div className="px-3 pb-3 bg-neutral-50/40">
                                                    {renderStepDetail(node.stepIndex)}
                                                </div>
                                            )}
                                        </li>
                                    );
                                })}
                            </ul>
                        </div>
                    );
                })}
            </div>

            {/* Compact, collapsible legend — the per-row kind badges already
                label each node, so the color key is opt-in. */}
            <div className="mt-3 pt-2 border-t border-neutral-100">
                <button
                    type="button"
                    onClick={() => setLegendOpen(o => !o)}
                    aria-expanded={legendOpen}
                    className="inline-flex items-center gap-1 text-[10px] font-medium text-neutral-400 hover:text-neutral-600 transition-colors"
                >
                    <ChevronRight
                        size={11}
                        className={`transition-transform ${legendOpen ? 'rotate-90' : ''}`}
                        aria-hidden="true"
                    />
                    Legend
                </button>
                {legendOpen && (
                    <div className="mt-2">
                        <Legend />
                    </div>
                )}
            </div>
        </section>
    );
}
