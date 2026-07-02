import { type ReactNode } from 'react';
import {
    AlertTriangle, Bookmark, Clock, DoorOpen, GitBranch, ListChecks,
    MoreHorizontal, Server, Share2, ShieldCheck, Sparkles, Target,
} from 'lucide-react';
import type { Feature } from '../../../types';
import type { FeatureRef, FlowRiskLevel, ParsedFlow } from './types';
import { inlineMd } from './markdown';
import { inlineWithFeatures } from './inlineWithFeatures';
import { FeatureReferenceChip } from './FeatureReferenceChip';

interface Props {
    flow: ParsedFlow;
    index: number;
    timeToValue: string | null;
    featuresById?: Map<string, Feature>;
    onSelectFeature: (refToken: FeatureRef) => void;
}

type StatTone = 'neutral' | 'amber' | 'sky' | 'emerald' | 'red';

const RISK_LEVEL_LABEL: Record<FlowRiskLevel, string> = {
    low: 'Low',
    medium: 'Medium',
    high: 'High',
};

const RISK_TONE: Record<FlowRiskLevel, StatTone> = {
    low: 'emerald',
    medium: 'amber',
    high: 'red',
};

const STAT_VALUE_COLOR: Record<StatTone, string> = {
    neutral: 'text-neutral-900',
    amber: 'text-amber-700',
    sky: 'text-sky-700',
    emerald: 'text-emerald-700',
    red: 'text-red-700',
};

const STAT_ICON_COLOR: Record<StatTone, string> = {
    neutral: 'text-neutral-400',
    amber: 'text-amber-500',
    sky: 'text-sky-500',
    emerald: 'text-emerald-500',
    red: 'text-red-500',
};

/** A single aligned metric in the flow's stat grid. */
function StatCell({
    icon, value, label, tone = 'neutral',
}: { icon: ReactNode; value: string; label: string; tone?: StatTone }) {
    return (
        <div className="flex items-center gap-2 rounded-lg border border-neutral-200 bg-neutral-50/70 px-2.5 py-2">
            <span className={`shrink-0 ${STAT_ICON_COLOR[tone]}`}>{icon}</span>
            <div className="min-w-0 leading-tight">
                <div className={`text-sm font-semibold truncate ${STAT_VALUE_COLOR[tone]}`} title={value}>
                    {value}
                </div>
                <div className="text-[10px] font-medium uppercase tracking-wider text-neutral-500">
                    {label}
                </div>
            </div>
        </div>
    );
}

function FullWidthSection({
    title, accent, icon, children,
}: { title: string; accent: 'emerald' | 'indigo' | 'amber' | 'neutral'; icon: ReactNode; children: ReactNode }) {
    const palette = {
        emerald: 'border-emerald-100 bg-emerald-50/40',
        indigo: 'border-indigo-100 bg-indigo-50/40',
        amber: 'border-amber-100 bg-amber-50/40',
        neutral: 'border-neutral-200 bg-neutral-50/60',
    }[accent];
    const headColor = {
        emerald: 'text-emerald-700',
        indigo: 'text-indigo-700',
        amber: 'text-amber-700',
        neutral: 'text-neutral-600',
    }[accent];
    return (
        <section className={`rounded-lg border ${palette} p-3.5`}>
            <p className={`text-[10px] font-semibold uppercase tracking-wider mb-1.5 inline-flex items-center gap-1 ${headColor}`}>
                {icon} {title}
            </p>
            <div className="text-sm text-neutral-800 leading-relaxed">{children}</div>
        </section>
    );
}

function HalfSection({
    title, icon, children,
}: { title: string; icon: ReactNode; children: ReactNode }) {
    return (
        <section className="rounded-lg border border-neutral-200 bg-white p-3.5">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500 mb-1.5 inline-flex items-center gap-1">
                {icon} {title}
            </p>
            <div className="text-sm text-neutral-700 leading-relaxed">{children}</div>
        </section>
    );
}

export function FlowSummaryCard({
    flow, index, timeToValue, featuresById, onSelectFeature,
}: Props) {
    const stepCount = flow.steps.length;
    const altPaths = flow.issues.filter(i => i.kind === 'alternate_path' || i.kind === 'failure_mode').length;
    const edgeCount = flow.issues.filter(i => i.kind === 'edge_case').length;
    const renderText = (text: string) =>
        inlineWithFeatures(text, { featuresById, onSelectFeature });

    const showRisk = flow.risk !== 'low' || flow.issues.length > 0;

    // Drop preconditions block entirely when there's nothing useful to add —
    // older artifacts sometimes emit a precondition identical to the entry
    // point sentence, which we want to avoid double-rendering.
    const hasPreconditions = Boolean(flow.preconditions && flow.preconditions.trim().length > 0);
    const hasEntryPoints = flow.entryPoints.length > 0;

    return (
        <section className="bg-white rounded-xl border border-neutral-200 p-4 sm:p-5 mb-4">
            <header className="flex items-start gap-3 pb-3 mb-3 border-b border-neutral-100">
                <div className="shrink-0 inline-flex items-center justify-center w-10 h-10 rounded-md bg-indigo-50 text-indigo-600">
                    <GitBranch size={18} />
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
                </div>
                <div className="hidden sm:flex items-center gap-1 shrink-0">
                    <button
                        type="button"
                        title="Bookmark flow"
                        aria-label="Bookmark flow"
                        className="p-1.5 rounded hover:bg-neutral-100 text-neutral-500"
                    >
                        <Bookmark size={14} />
                    </button>
                    <button
                        type="button"
                        title="Share flow"
                        aria-label="Share flow"
                        className="p-1.5 rounded hover:bg-neutral-100 text-neutral-500"
                    >
                        <Share2 size={14} />
                    </button>
                    <button
                        type="button"
                        title="More actions"
                        aria-label="More actions"
                        className="p-1.5 rounded hover:bg-neutral-100 text-neutral-500"
                    >
                        <MoreHorizontal size={14} />
                    </button>
                </div>
            </header>

            {/* Metrics + related features — an aligned grid instead of loose chips */}
            <div className="mb-4">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <StatCell
                        icon={<ListChecks size={14} />}
                        value={String(stepCount)}
                        label={stepCount === 1 ? 'Step' : 'Steps'}
                    />
                    {altPaths > 0 && (
                        <StatCell
                            icon={<GitBranch size={14} />}
                            value={String(altPaths)}
                            label={altPaths === 1 ? 'Alt path' : 'Alt paths'}
                            tone="amber"
                        />
                    )}
                    {edgeCount > 0 && (
                        <StatCell
                            icon={<AlertTriangle size={14} />}
                            value={String(edgeCount)}
                            label={edgeCount === 1 ? 'Edge case' : 'Edge cases'}
                            tone="sky"
                        />
                    )}
                    {timeToValue && (
                        <StatCell
                            icon={<Clock size={14} />}
                            value={timeToValue}
                            label="To value"
                            tone="emerald"
                        />
                    )}
                    {showRisk && (
                        <StatCell
                            icon={<span className="inline-block w-2.5 h-2.5 rounded-full bg-current" />}
                            value={RISK_LEVEL_LABEL[flow.risk]}
                            label="Risk"
                            tone={RISK_TONE[flow.risk]}
                        />
                    )}
                </div>

                {flow.featureRefs.length > 0 && (
                    <div className="mt-3 flex flex-wrap items-center gap-1.5">
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500 mr-0.5">
                            Related features
                        </span>
                        {flow.featureRefs.map(ref => (
                            <FeatureReferenceChip
                                key={ref.id}
                                refToken={ref}
                                feature={featuresById?.get(ref.id)}
                                onSelect={onSelectFeature}
                            />
                        ))}
                    </div>
                )}
            </div>

            <div className="space-y-3">
                {flow.goal && (
                    <FullWidthSection title="Goal" accent="emerald" icon={<Target size={11} />}>
                        {renderText(flow.goal)}
                    </FullWidthSection>
                )}

                {(hasPreconditions || hasEntryPoints) && (
                    <div className={`grid grid-cols-1 ${hasPreconditions && hasEntryPoints ? 'sm:grid-cols-2' : ''} gap-3`}>
                        {hasPreconditions && (
                            <HalfSection title="Preconditions" icon={<ShieldCheck size={11} />}>
                                {renderText(flow.preconditions!)}
                            </HalfSection>
                        )}
                        {hasEntryPoints && (
                            <HalfSection title="Entry points" icon={<DoorOpen size={11} />}>
                                <ul className="space-y-1">
                                    {flow.entryPoints.slice(0, 5).map((ep, i) => (
                                        <li key={i} className="flex gap-2">
                                            <span className="text-neutral-400">•</span>
                                            <span className="min-w-0 flex-1">{renderText(ep)}</span>
                                        </li>
                                    ))}
                                </ul>
                            </HalfSection>
                        )}
                    </div>
                )}

                {flow.successOutcome && (
                    <FullWidthSection title="Success outcome" accent="emerald" icon={<Sparkles size={11} />}>
                        {renderText(flow.successOutcome)}
                    </FullWidthSection>
                )}

                {flow.inferredSystems.length > 0 && (
                    <section className="rounded-lg border border-neutral-200 bg-white p-3.5">
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500 mb-1.5 inline-flex items-center gap-1">
                            <Server size={11} /> Core systems / dependencies
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                            {flow.inferredSystems.map((s, i) => (
                                <code
                                    key={i}
                                    className="text-[11px] bg-neutral-100 text-neutral-800 px-1.5 py-0.5 rounded"
                                >
                                    {s}
                                </code>
                            ))}
                        </div>
                    </section>
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
