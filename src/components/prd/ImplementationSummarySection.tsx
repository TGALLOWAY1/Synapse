import { ArrowRight, ListChecks } from 'lucide-react';
import type { StructuredPRD } from '../../types';
import {
    deriveImplementationSummary,
    featureDetailAnchorId,
    isImplementationSummaryEmpty,
    type SummaryFeature,
} from '../../lib/derive/implementationSummary';
import { FeatureIdBadge } from './FeatureIdBadge';

// Synthesized "what to build first / next" view. Pure derivation — no LLM
// call. Renders at the top of the PRD so a reader can answer "what would I do
// Monday morning?" without scrolling 30 pages. This is THE section presenting
// MVP/V1 scope (the old MVP Scope feature lists duplicated it and were folded
// in — the scope rationale renders here as the Decision callout). Deferred
// work and open decisions deliberately do NOT live here: deferred scope lives
// in the Decision Log and open decisions in Review & Confirm.

function FeatureCard({
    feature,
    accent,
    onNavigate,
}: {
    feature: SummaryFeature;
    accent: 'green' | 'blue';
    onNavigate?: (featureId: string) => void;
}) {
    const accentClasses = {
        green: 'bg-green-50/60 border-green-200',
        blue: 'bg-blue-50/60 border-blue-200',
    }[accent];
    return (
        <a
            href={`#${featureDetailAnchorId(feature.id)}`}
            onClick={onNavigate ? (e) => { e.preventDefault(); onNavigate(feature.id); } : undefined}
            className={`block rounded-md border ${accentClasses} px-3 py-2 hover:shadow-sm transition`}
            title={`Jump to ${feature.name} details`}
        >
            <div className="flex items-baseline gap-2">
                <FeatureIdBadge id={feature.id} />
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
    onNavigate,
}: {
    title: string;
    icon: typeof ListChecks;
    accent: 'green' | 'blue';
    features: SummaryFeature[];
    emptyHint: string;
    onNavigate?: (featureId: string) => void;
}) {
    const headerClasses = {
        green: 'text-green-700',
        blue: 'text-blue-700',
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
                        <FeatureCard key={f.id} feature={f} accent={accent} onNavigate={onNavigate} />
                    ))}
                </div>
            )}
        </div>
    );
}

export function ImplementationSummarySection({
    prd,
    onNavigateToFeature,
}: {
    prd: StructuredPRD;
    /** Jump to a feature's detail card (expands the collapsed V1 group when needed). */
    onNavigateToFeature?: (featureId: string) => void;
}) {
    const summary = deriveImplementationSummary(prd);
    const rationale = prd.mvpScope?.rationale;
    if (isImplementationSummaryEmpty(summary) && !rationale) return null;

    return (
        <div id="prd-implementation-summary" className="mb-8 scroll-mt-24">
            <div className="mb-3 border-b border-neutral-200 pb-2">
                <h3 className="text-lg font-extrabold text-neutral-900 tracking-tight whitespace-nowrap">
                    Implementation Summary
                </h3>
            </div>

            {rationale && (
                <div className="mb-3 rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-indigo-900">
                    <span className="text-[10px] uppercase font-bold tracking-wider mr-2 px-1.5 py-0.5 rounded bg-indigo-200 text-indigo-900">Decision</span>
                    {rationale}
                </div>
            )}

            {!isImplementationSummaryEmpty(summary) && (
                <div className="bg-gradient-to-br from-indigo-50/40 to-white border border-indigo-100 rounded-xl p-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <FeatureBucket
                            title="Build First"
                            icon={ListChecks}
                            accent="green"
                            features={summary.buildFirst}
                            emptyHint="No MVP features tagged."
                            onNavigate={onNavigateToFeature}
                        />
                        <FeatureBucket
                            title="Build Next"
                            icon={ArrowRight}
                            accent="blue"
                            features={summary.buildNext}
                            emptyHint="No V1 features tagged."
                            onNavigate={onNavigateToFeature}
                        />
                    </div>
                </div>
            )}
        </div>
    );
}
