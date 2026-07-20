import { useState, type ReactNode } from 'react';
import {
    ChevronRight, DoorOpen, GitBranch, MoreHorizontal, Server, ShieldCheck,
    Sparkles, Target,
} from 'lucide-react';
import type { Feature } from '../../../types';
import type { FeatureRef, ParsedFlow } from './types';
import { inlineMd } from './markdown';
import { inlineWithFeatures } from './inlineWithFeatures';

interface Props {
    flow: ParsedFlow;
    /** 1-based display number in grouped visual order (see `displayNumbers` in
     * `categorize.ts`) — NOT the flow's original/selection index. */
    displayNumber: number;
    featuresById?: Map<string, Feature>;
    onSelectFeature: (refToken: FeatureRef) => void;
}

function GoalBlock({
    title, accent, icon, children,
}: { title: string; accent: 'emerald' | 'indigo'; icon: ReactNode; children: ReactNode }) {
    const palette = accent === 'emerald'
        ? 'border-emerald-100 bg-emerald-50/40'
        : 'border-indigo-100 bg-indigo-50/40';
    const headColor = accent === 'emerald' ? 'text-emerald-700' : 'text-indigo-700';
    return (
        <section className={`rounded-lg border ${palette} p-3.5`}>
            <p className={`text-[10px] font-semibold uppercase tracking-wider mb-1.5 inline-flex items-center gap-1 ${headColor}`}>
                {icon} {title}
            </p>
            <div className="text-sm text-neutral-800 leading-relaxed">{children}</div>
        </section>
    );
}

export function FlowSummaryCard({
    flow, displayNumber, featuresById, onSelectFeature,
}: Props) {
    const renderText = (text: string) =>
        inlineWithFeatures(text, { featuresById, onSelectFeature });

    // Drop preconditions block entirely when there's nothing useful to add.
    const hasPreconditions = Boolean(flow.preconditions && flow.preconditions.trim().length > 0);
    const hasEntryPoints = flow.entryPoints.length > 0;
    const hasSystems = flow.inferredSystems.length > 0;
    const hasDetails = hasPreconditions || hasEntryPoints || hasSystems;

    const [detailsOpen, setDetailsOpen] = useState(false);

    return (
        <section className="bg-white rounded-xl border border-neutral-200 p-4 sm:p-5 mb-4">
            <header className="flex items-start gap-3">
                <div className="shrink-0 inline-flex items-center justify-center w-9 h-9 rounded-md bg-indigo-50 text-indigo-600">
                    <GitBranch size={17} />
                </div>
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-indigo-600">
                            Flow {displayNumber}
                        </p>
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 font-medium border border-indigo-100">
                            {flow.category}
                        </span>
                    </div>
                    <h3 className="text-base font-bold text-neutral-900 leading-snug mt-1">
                        {flow.title}
                    </h3>
                    {/* Metadata chips (step count, alt paths, risk) and the
                        "Related: …" summary were removed — that information lives
                        in the Journey, Alternate paths & edge cases, and Related
                        artifacts sections below, and the risk/time-to-value dots
                        remain in the flow rail. */}
                </div>
                <div className="hidden sm:flex items-center shrink-0">
                    <button
                        type="button"
                        title="More actions"
                        aria-label="More actions"
                        className="p-1.5 rounded hover:bg-neutral-100 text-neutral-400"
                    >
                        <MoreHorizontal size={16} />
                    </button>
                </div>
            </header>

            {/* Flow Summary body: Goal + Success outcome visible by default. */}
            <div className="mt-4 space-y-3">
                {flow.goal && (
                    <GoalBlock title="Goal" accent="indigo" icon={<Target size={11} />}>
                        {renderText(flow.goal)}
                    </GoalBlock>
                )}

                {flow.successOutcome && (
                    <GoalBlock title="Success outcome" accent="emerald" icon={<Sparkles size={11} />}>
                        {renderText(flow.successOutcome)}
                    </GoalBlock>
                )}

                {/* Preconditions, entry points, dependencies — compact, tucked
                    behind a disclosure so the page reaches Journey/Steps faster. */}
                {hasDetails && (
                    <div className="rounded-lg border border-neutral-200 bg-neutral-50/50">
                        <button
                            type="button"
                            onClick={() => setDetailsOpen(o => !o)}
                            aria-expanded={detailsOpen}
                            className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-neutral-100/60 rounded-lg transition-colors"
                        >
                            <ChevronRight
                                size={13}
                                className={`shrink-0 text-neutral-400 transition-transform ${detailsOpen ? 'rotate-90' : ''}`}
                                aria-hidden="true"
                            />
                            <span className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
                                Preconditions &amp; dependencies
                            </span>
                            {!detailsOpen && (
                                <span className="ml-auto text-[10px] text-neutral-400">
                                    {[
                                        hasPreconditions ? 'preconditions' : null,
                                        hasEntryPoints ? `${flow.entryPoints.length} entry ${flow.entryPoints.length === 1 ? 'point' : 'points'}` : null,
                                        hasSystems ? `${flow.inferredSystems.length} ${flow.inferredSystems.length === 1 ? 'system' : 'systems'}` : null,
                                    ].filter(Boolean).join(' · ')}
                                </span>
                            )}
                        </button>
                        {detailsOpen && (
                            <div className="px-3.5 pb-3.5 pt-1 space-y-3 text-sm">
                                {hasPreconditions && (
                                    <div>
                                        <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500 mb-1 inline-flex items-center gap-1">
                                            <ShieldCheck size={11} /> Preconditions
                                        </p>
                                        <div className="text-neutral-700 leading-relaxed">
                                            {renderText(flow.preconditions!)}
                                        </div>
                                    </div>
                                )}
                                {hasEntryPoints && (
                                    <div>
                                        <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500 mb-1 inline-flex items-center gap-1">
                                            <DoorOpen size={11} /> Entry points
                                        </p>
                                        <ul className="space-y-1 text-neutral-700">
                                            {flow.entryPoints.slice(0, 5).map((ep, i) => (
                                                <li key={i} className="flex gap-2">
                                                    <span className="text-neutral-400">•</span>
                                                    <span className="min-w-0 flex-1">{renderText(ep)}</span>
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                )}
                                {hasSystems && (
                                    <div>
                                        <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500 mb-1 inline-flex items-center gap-1">
                                            <Server size={11} /> Core systems / dependencies
                                        </p>
                                        <div className="flex flex-wrap gap-1.5">
                                            {flow.inferredSystems.map((s, i) => (
                                                <code
                                                    key={i}
                                                    className="text-[11px] bg-neutral-100 text-neutral-700 px-1.5 py-0.5 rounded"
                                                >
                                                    {s}
                                                </code>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Light-touch fallback if structured data is empty: keep the raw goal markdown readable */}
            {!flow.goal && !flow.successOutcome && flow.rest && (
                <div className="mt-4 prose prose-sm prose-neutral max-w-none">
                    {inlineMd(flow.rest)}
                </div>
            )}
        </section>
    );
}
