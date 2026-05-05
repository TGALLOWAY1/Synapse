import { AlertTriangle, ArrowRight, ListChecks, Pause, ShieldQuestion } from 'lucide-react';
import type { StructuredPRD } from '../../types';
import {
    deriveImplementationSummary,
    isImplementationSummaryEmpty,
    type SummaryFeature,
} from '../../lib/derive/implementationSummary';

// Synthesized "what to build first / next / defer / risks / decisions" view.
// Pure derivation — no LLM call. Renders at the top of the PRD so a reader
// can answer "what would I do Monday morning?" without scrolling 30 pages.

function FeatureCard({ feature, accent }: { feature: SummaryFeature; accent: 'green' | 'blue' | 'neutral' }) {
    const accentClasses = {
        green: 'bg-green-50/60 border-green-200',
        blue: 'bg-blue-50/60 border-blue-200',
        neutral: 'bg-neutral-50 border-neutral-200',
    }[accent];
    const idClasses = {
        green: 'text-green-700',
        blue: 'text-blue-700',
        neutral: 'text-neutral-500',
    }[accent];
    return (
        <a
            href={`#prd-features`}
            className={`block rounded-md border ${accentClasses} px-3 py-2 hover:shadow-sm transition`}
        >
            <div className="flex items-baseline gap-2">
                <span className={`text-[11px] font-mono font-bold ${idClasses}`}>{feature.id}</span>
                <span className="text-sm font-semibold text-neutral-900 truncate">{feature.name}</span>
            </div>
            {feature.reason && (
                <p className="text-[11px] text-neutral-600 mt-0.5 line-clamp-2">{feature.reason}</p>
            )}
        </a>
    );
}

function FeatureBucket({
    title,
    icon: Icon,
    accent,
    features,
    emptyHint,
}: {
    title: string;
    icon: typeof ListChecks;
    accent: 'green' | 'blue' | 'neutral';
    features: SummaryFeature[];
    emptyHint: string;
}) {
    const headerClasses = {
        green: 'text-green-700',
        blue: 'text-blue-700',
        neutral: 'text-neutral-500',
    }[accent];
    return (
        <div>
            <div className="flex items-center gap-2 mb-2">
                <Icon size={14} className={headerClasses} />
                <h4 className={`text-[11px] font-bold uppercase tracking-wider ${headerClasses}`}>
                    {title}
                </h4>
                <span className="text-[11px] text-neutral-400">{features.length}</span>
            </div>
            {features.length === 0 ? (
                <p className="text-[11px] text-neutral-400 italic">{emptyHint}</p>
            ) : (
                <div className="space-y-1.5">
                    {features.map(f => (
                        <FeatureCard key={f.id} feature={f} accent={accent} />
                    ))}
                </div>
            )}
        </div>
    );
}

export function ImplementationSummarySection({ prd }: { prd: StructuredPRD }) {
    const summary = deriveImplementationSummary(prd);
    if (isImplementationSummaryEmpty(summary)) return null;

    return (
        <div id="prd-implementation-summary" className="mb-8 scroll-mt-24">
            <div className="flex items-center justify-between mb-3 border-b border-neutral-200 pb-2">
                <h3 className="text-lg font-extrabold text-neutral-900 tracking-tight">
                    Implementation Summary
                </h3>
                <span className="text-[11px] text-neutral-400">
                    Derived from features, risks, assumptions
                </span>
            </div>

            <div className="bg-gradient-to-br from-indigo-50/40 to-white border border-indigo-100 rounded-xl p-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                    <FeatureBucket
                        title="Build First"
                        icon={ListChecks}
                        accent="green"
                        features={summary.buildFirst}
                        emptyHint="No MVP features tagged."
                    />
                    <FeatureBucket
                        title="Build Next"
                        icon={ArrowRight}
                        accent="blue"
                        features={summary.buildNext}
                        emptyHint="No V1 features tagged."
                    />
                    <FeatureBucket
                        title="Defer"
                        icon={Pause}
                        accent="neutral"
                        features={summary.defer}
                        emptyHint="No deferred features."
                    />
                </div>

                {(summary.highestRisks.length > 0 || summary.openDecisions.length > 0) && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4 border-t border-indigo-100">
                        {summary.highestRisks.length > 0 && (
                            <div>
                                <div className="flex items-center gap-2 mb-2">
                                    <AlertTriangle size={14} className="text-red-600" />
                                    <h4 className="text-[11px] font-bold uppercase tracking-wider text-red-700">
                                        Highest Risks
                                    </h4>
                                    <span className="text-[11px] text-neutral-400">{summary.highestRisks.length}</span>
                                </div>
                                <ul className="space-y-1.5">
                                    {summary.highestRisks.map((r, i) => (
                                        <li
                                            key={i}
                                            className="rounded-md border border-red-100 bg-red-50/40 px-3 py-2"
                                        >
                                            <div className="flex items-start gap-2">
                                                <span
                                                    className={`shrink-0 mt-0.5 inline-block text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${
                                                        r.likelihood === 'high'
                                                            ? 'bg-red-200 text-red-900'
                                                            : r.likelihood === 'med'
                                                                ? 'bg-amber-200 text-amber-900'
                                                                : 'bg-neutral-200 text-neutral-700'
                                                    }`}
                                                >
                                                    {r.likelihood}
                                                </span>
                                                <div className="min-w-0">
                                                    <p className="text-sm text-neutral-900">{r.risk}</p>
                                                    {r.impact && (
                                                        <p className="text-[11px] text-neutral-600 mt-0.5">
                                                            {r.impact}
                                                        </p>
                                                    )}
                                                </div>
                                            </div>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}

                        {summary.openDecisions.length > 0 && (
                            <div>
                                <div className="flex items-center gap-2 mb-2">
                                    <ShieldQuestion size={14} className="text-amber-700" />
                                    <h4 className="text-[11px] font-bold uppercase tracking-wider text-amber-700">
                                        Open Decisions
                                    </h4>
                                    <span className="text-[11px] text-neutral-400">{summary.openDecisions.length}</span>
                                </div>
                                <ul className="space-y-1.5">
                                    {summary.openDecisions.map(d => (
                                        <li
                                            key={d.id}
                                            className="rounded-md border border-amber-100 bg-amber-50/40 px-3 py-2"
                                        >
                                            <div className="flex items-start gap-2">
                                                <span className="shrink-0 mt-0.5 text-[10px] font-mono font-bold text-amber-700">
                                                    {d.id}
                                                </span>
                                                <p className="text-sm text-neutral-900">{d.statement}</p>
                                            </div>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
