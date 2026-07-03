import { useState, type ReactNode } from 'react';
import {
    AlertTriangle, ChevronRight, Clock, DoorOpen, GitBranch, ListChecks,
    MoreHorizontal, Network, Server, ShieldCheck, Sparkles, Target,
} from 'lucide-react';
import type { Feature } from '../../../types';
import type { FeatureRef, FlowRiskLevel, ParsedFlow } from './types';
import { inlineMd } from './markdown';
import { inlineWithFeatures } from './inlineWithFeatures';
import type { RelatedArtifacts } from './relatedArtifacts';
import { relatedSummaryParts } from './relatedArtifacts';

interface Props {
    flow: ParsedFlow;
    index: number;
    timeToValue: string | null;
    featuresById?: Map<string, Feature>;
    onSelectFeature: (refToken: FeatureRef) => void;
    /** Precomputed heuristic join, used for the compact relationship summary. */
    related: RelatedArtifacts;
}

type BadgeTone = 'neutral' | 'amber' | 'sky' | 'emerald' | 'red' | 'indigo';

const RISK_LEVEL_LABEL: Record<FlowRiskLevel, string> = {
    low: 'Low risk',
    medium: 'Medium risk',
    high: 'High risk',
};

const RISK_TONE: Record<FlowRiskLevel, BadgeTone> = {
    low: 'emerald',
    medium: 'amber',
    high: 'red',
};

const BADGE_CLASS: Record<BadgeTone, string> = {
    neutral: 'bg-neutral-100 text-neutral-600 border-neutral-200',
    amber: 'bg-amber-50 text-amber-700 border-amber-200',
    sky: 'bg-sky-50 text-sky-700 border-sky-200',
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    red: 'bg-red-50 text-red-700 border-red-200',
    indigo: 'bg-indigo-50 text-indigo-700 border-indigo-200',
};

/** A compact inline metadata pill — replaces the old large stat cards. */
function MetaBadge({
    icon, children, tone = 'neutral', title,
}: { icon?: ReactNode; children: ReactNode; tone?: BadgeTone; title?: string }) {
    return (
        <span
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-medium ${BADGE_CLASS[tone]}`}
            title={title}
        >
            {icon}
            {children}
        </span>
    );
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
    flow, index, timeToValue, featuresById, onSelectFeature, related,
}: Props) {
    const stepCount = flow.steps.length;
    const altPaths = flow.issues.filter(i => i.kind === 'alternate_path' || i.kind === 'failure_mode').length;
    const edgeCount = flow.issues.filter(i => i.kind === 'edge_case').length;
    const renderText = (text: string) =>
        inlineWithFeatures(text, { featuresById, onSelectFeature });

    const showRisk = flow.risk !== 'low' || flow.issues.length > 0;

    // Drop preconditions block entirely when there's nothing useful to add.
    const hasPreconditions = Boolean(flow.preconditions && flow.preconditions.trim().length > 0);
    const hasEntryPoints = flow.entryPoints.length > 0;
    const hasSystems = flow.inferredSystems.length > 0;
    const hasDetails = hasPreconditions || hasEntryPoints || hasSystems;

    const [detailsOpen, setDetailsOpen] = useState(false);

    const summaryParts = relatedSummaryParts(related);

    return (
        <section className="bg-white rounded-xl border border-neutral-200 p-4 sm:p-5 mb-4">
            <header className="flex items-start gap-3">
                <div className="shrink-0 inline-flex items-center justify-center w-9 h-9 rounded-md bg-indigo-50 text-indigo-600">
                    <GitBranch size={17} />
                </div>
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-indigo-600">
                            Flow {index + 1}
                        </p>
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 font-medium border border-indigo-100">
                            {flow.category}
                        </span>
                    </div>
                    <h3 className="text-base font-bold text-neutral-900 leading-snug mt-1">
                        {flow.title}
                    </h3>

                    {/* Compact inline metadata — replaces the old 2×4 stat-card grid */}
                    <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                        <MetaBadge icon={<ListChecks size={12} />}>
                            {stepCount} {stepCount === 1 ? 'step' : 'steps'}
                        </MetaBadge>
                        {altPaths > 0 && (
                            <MetaBadge icon={<GitBranch size={12} />} tone="amber">
                                {altPaths} alt {altPaths === 1 ? 'path' : 'paths'}
                            </MetaBadge>
                        )}
                        {edgeCount > 0 && (
                            <MetaBadge icon={<AlertTriangle size={12} />} tone="sky">
                                {edgeCount} edge {edgeCount === 1 ? 'case' : 'cases'}
                            </MetaBadge>
                        )}
                        {timeToValue && (
                            <MetaBadge icon={<Clock size={12} />} tone="emerald">
                                {timeToValue} to value
                            </MetaBadge>
                        )}
                        {showRisk && (
                            <MetaBadge
                                icon={<span className="inline-block w-2 h-2 rounded-full bg-current" />}
                                tone={RISK_TONE[flow.risk]}
                            >
                                {RISK_LEVEL_LABEL[flow.risk]}
                            </MetaBadge>
                        )}
                    </div>

                    {/* Compact relationship summary — replaces the repeated
                        feature chip row; full chips live in Related Artifacts. */}
                    {summaryParts.length > 0 && (
                        <p className="mt-2 text-[11px] text-neutral-500 inline-flex items-center gap-1.5">
                            <Network size={11} className="shrink-0 text-neutral-400" />
                            <span>Related: {summaryParts.join(' · ')}</span>
                        </p>
                    )}
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
