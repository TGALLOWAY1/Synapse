import {
    AppWindow, Cog, GitBranch, Layers, MousePointerClick, Sparkles, Workflow,
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
            <span className="inline-flex items-center gap-1 ml-1">
                <span className="inline-block w-6 border-t-2 border-neutral-400" /> Primary path
            </span>
            <span className="inline-flex items-center gap-1">
                <span className="inline-block w-6 border-t-2 border-dashed border-amber-500" /> Alternate path
            </span>
        </div>
    );
}

export function FlowJourney({
    flowIndex, steps, issuesByStep,
    onNavigateToScreen, availableScreenSlugs, highlightedStepIndices,
}: Props) {
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

            <div className="overflow-x-auto -mx-1 px-1 pb-1">
                <ol className="flex items-stretch gap-3 min-w-max">
                    {nodes.map((node, i) => {
                        const Icon = KIND_ICON[node.kind];
                        const style = nodeKindStyle(node.kind);
                        const altCount = issuesByStep.get(node.stepIndex) ?? 0;
                        const isLast = i === nodes.length - 1;
                        const highlighted = highlightedStepIndices?.has(node.stepIndex) ?? false;
                        return (
                            <li
                                key={node.stepIndex}
                                className="flex items-stretch gap-3"
                            >
                                <button
                                    type="button"
                                    onClick={() => handleClick(node)}
                                    aria-current={highlighted ? 'true' : undefined}
                                    className={`group relative w-40 text-left rounded-xl border ${style.border} ${style.bg} hover:ring-2 hover:ring-offset-1 hover:ring-indigo-300 transition px-3 py-2.5 flex flex-col ${
                                        highlighted ? 'ring-2 ring-offset-1 ring-indigo-500' : ''
                                    }`}
                                >
                                    <div className="flex items-center justify-between gap-1 mb-1">
                                        <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-white/80 text-[10px] font-bold text-neutral-700 border border-neutral-200">
                                            {node.stepIndex + 1}
                                        </span>
                                        <span className={`inline-flex items-center justify-center w-5 h-5 rounded ${style.badgeBg} ${style.badgeText}`}>
                                            <Icon size={11} />
                                        </span>
                                    </div>
                                    <p
                                        className={`text-[12px] font-medium leading-snug ${style.text}`}
                                        title={node.label}
                                        style={{
                                            display: '-webkit-box',
                                            WebkitLineClamp: 2,
                                            WebkitBoxOrient: 'vertical',
                                            overflow: 'hidden',
                                        }}
                                    >
                                        {node.label}
                                    </p>
                                    <div className="mt-1.5 flex items-center justify-between gap-1">
                                        <NodeBadge kind={node.kind} />
                                        {altCount > 0 && (
                                            <span
                                                className="text-[9px] font-semibold px-1 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-200"
                                                title={`${altCount} alternate path${altCount === 1 ? '' : 's'} or edge case${altCount === 1 ? '' : 's'}`}
                                            >
                                                {altCount} alt
                                            </span>
                                        )}
                                    </div>
                                </button>
                                {!isLast && (
                                    <div
                                        aria-hidden="true"
                                        className="flex items-center"
                                    >
                                        <span className="block h-px w-6 bg-neutral-300" />
                                        <span className="block w-0 h-0 border-y-4 border-y-transparent border-l-[6px] border-l-neutral-300" />
                                    </div>
                                )}
                            </li>
                        );
                    })}
                </ol>
            </div>

            <div className="mt-3 pt-3 border-t border-neutral-100">
                <Legend />
            </div>
        </section>
    );
}
