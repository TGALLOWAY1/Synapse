import { useState } from 'react';
import {
    AppWindow, ChevronRight, Cog, GitBranch, Layers, MousePointerClick,
    Sparkles, Workflow,
} from 'lucide-react';
import type { FlowJourneyNode, ParsedStep, FlowJourneyNodeKind } from './types';
import { buildJourneyNodes, NODE_KIND_LABEL, nodeKindStyle } from './journeyNode';
import { stepScreenSlug } from '../../../lib/screenExperience';

interface Props {
    flowIndex: number;
    steps: ParsedStep[];
    issuesByStep: Map<number, number>;
    /**
     * Experience-workspace wiring (all optional — default behavior is
     * unchanged). When a clicked node is a `screen` node whose slugified
     * title exists in `availableScreenSlugs`, `onNavigateToScreen` fires
     * instead of the scroll-to-step default. Other nodes keep scrolling.
     */
    onNavigateToScreen?: (screenSlug: string) => void;
    availableScreenSlugs?: ReadonlySet<string>;
    /** Step indices to visually emphasize (the current screen in a Screen
     * Detail "Flow" tab). */
    highlightedStepIndices?: ReadonlySet<number>;
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
}: Props) {
    const [legendOpen, setLegendOpen] = useState(false);
    if (steps.length === 0) return null;
    const nodes = buildJourneyNodes(steps);

    const handleClick = (node: FlowJourneyNode) => {
        // Screen nodes with a matching canonical screen navigate to that
        // screen's detail view; everything else keeps the scroll behavior.
        if (onNavigateToScreen && availableScreenSlugs && node.kind === 'screen') {
            const step = steps.find(s => s.index === node.stepIndex);
            const slug = step ? stepScreenSlug(step) : null;
            if (slug && availableScreenSlugs.has(slug)) {
                onNavigateToScreen(slug);
                return;
            }
        }
        const el = document.getElementById(`flow-${flowIndex}-step-${node.stepIndex}`);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };

    return (
        <section className="bg-white rounded-xl border border-neutral-200 p-4 mb-4">
            <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500 inline-flex items-center gap-1">
                    <Workflow size={11} /> Flow journey
                </p>
                <span className="text-[10px] text-neutral-400">
                    {steps.length} {steps.length === 1 ? 'step' : 'steps'}
                </span>
            </div>

            {/* Vertical timeline — readable at any width, no horizontal scroll,
                and each row lines up 1:1 with the Step-by-Step cards below. */}
            <ol className="relative">
                {nodes.map((node, i) => {
                    const Icon = KIND_ICON[node.kind];
                    const style = nodeKindStyle(node.kind);
                    const altCount = issuesByStep.get(node.stepIndex) ?? 0;
                    const isLast = i === nodes.length - 1;
                    const highlighted = highlightedStepIndices?.has(node.stepIndex) ?? false;
                    return (
                        <li key={node.stepIndex} className="relative flex gap-3">
                            {/* Rail: number marker + connector line */}
                            <div className="relative flex flex-col items-center">
                                <span className="z-10 inline-flex items-center justify-center w-7 h-7 rounded-full bg-white border border-neutral-300 text-[11px] font-bold text-neutral-700">
                                    {node.stepIndex + 1}
                                </span>
                                {!isLast && (
                                    <span
                                        aria-hidden="true"
                                        className="w-px flex-1 bg-neutral-200 my-0.5"
                                    />
                                )}
                            </div>

                            {/* Node card */}
                            <button
                                type="button"
                                onClick={() => handleClick(node)}
                                aria-current={highlighted ? 'true' : undefined}
                                className={`group flex-1 min-w-0 text-left rounded-lg border ${style.border} ${style.bg} hover:ring-2 hover:ring-offset-1 hover:ring-indigo-300 transition px-3 py-2 mb-2 flex items-start gap-2.5 ${
                                    highlighted ? 'ring-2 ring-offset-1 ring-indigo-500' : ''
                                }`}
                            >
                                <span className={`shrink-0 mt-0.5 inline-flex items-center justify-center w-5 h-5 rounded ${style.badgeBg} ${style.badgeText}`}>
                                    <Icon size={12} />
                                </span>
                                <span className="min-w-0 flex-1">
                                    <span className={`block text-[13px] font-medium leading-snug ${style.text}`} title={node.label}>
                                        {node.label}
                                    </span>
                                    <span className="mt-1 flex items-center gap-1.5 flex-wrap">
                                        <NodeBadge kind={node.kind} />
                                        {altCount > 0 && (
                                            <span
                                                className="text-[9px] font-semibold px-1 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-200"
                                                title={`${altCount} alternate path${altCount === 1 ? '' : 's'} or edge case${altCount === 1 ? '' : 's'}`}
                                            >
                                                {altCount} alt
                                            </span>
                                        )}
                                    </span>
                                </span>
                                <ChevronRight
                                    size={14}
                                    className="shrink-0 mt-1 text-neutral-300 group-hover:text-indigo-400 transition-colors"
                                    aria-hidden="true"
                                />
                            </button>
                        </li>
                    );
                })}
            </ol>

            {/* Compact, collapsible legend — the per-row kind badges already
                label each node, so the color key is opt-in. */}
            <div className="mt-1 pt-2 border-t border-neutral-100">
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
