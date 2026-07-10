import { ArrowRight, ListChecks } from 'lucide-react';
import type { StructuredPRD } from '../../types';
import {
    deriveImplementationSummary,
    isImplementationSummaryEmpty,
    type SummaryFeature,
} from '../../lib/derive/implementationSummary';
import { FeatureIdBadge } from './FeatureIdBadge';

// Synthesized "what to build first / next" view. Pure derivation — no LLM
// call. Renders at the top of the PRD so a reader can answer "what would I do
// Monday morning?" without scrolling 30 pages. Deferred work and open
// decisions deliberately do NOT live here: deferred scope stays in MVP Scope
// ("Later") and open decisions moved to the actionable Review & Confirm
// section.

function FeatureCard({ feature, accent }: { feature: SummaryFeature; accent: 'green' | 'blue' }) {
    const accentClasses = {
        green: 'bg-green-50/60 border-green-200',
        blue: 'bg-blue-50/60 border-blue-200',
    }[accent];
    return (
        <a
            href={`#prd-features`}
            className={`block rounded-md border ${accentClasses} px-3 py-2 hover:shadow-sm transition`}
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
}: {
    title: string;
    icon: typeof ListChecks;
    accent: 'green' | 'blue';
    features: SummaryFeature[];
    emptyHint: string;
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
            <div className="mb-3 border-b border-neutral-200 pb-2">
                <h3 className="text-lg font-extrabold text-neutral-900 tracking-tight whitespace-nowrap">
                    Implementation Summary
                </h3>
            </div>

            <div className="bg-gradient-to-br from-indigo-50/40 to-white border border-indigo-100 rounded-xl p-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
                </div>
            </div>
        </div>
    );
}
