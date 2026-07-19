import { Clock, ShieldAlert } from 'lucide-react';
import type { DecisionLogEntry } from '../../lib/derive/prdDecisions';
import type { NormalizedRisk } from '../../lib/derive/prdViews';
import { FeatureIdBadge } from './FeatureIdBadge';
import { isDisplayableFeatureId } from '../../lib/derive/prdDecisions';

// "Deferred & Risks" — the Decisions view's home for work consciously pushed
// out of the current build (deferred scope) and for product risks. Kept
// deliberately calm: deferred scope is an ordinary decision, not an error, so
// it uses neutral styling. Risks carry a light amber accent only.

function ReferenceBadge({ entry }: { entry: DecisionLogEntry }) {
    if (!entry.label) return null;
    if (entry.kind === 'feature') return <FeatureIdBadge id={entry.label} />;
    if (!isDisplayableFeatureId(entry.label)) return null;
    return (
        <span className="inline-flex items-center px-1.5 py-0.5 rounded-md bg-neutral-100 border border-neutral-200 text-neutral-600 text-[11px] font-mono font-semibold uppercase leading-none shrink-0">
            {entry.label}
        </span>
    );
}

const likelihoodTone = (l?: string) =>
    l === 'high' ? 'bg-amber-100 text-amber-800' :
    l === 'med' ? 'bg-amber-50 text-amber-700' :
    'bg-neutral-100 text-neutral-600';

interface Props {
    /** Deferred decision-log entries (verdict === 'deferred'). */
    deferred: DecisionLogEntry[];
    risks: NormalizedRisk[];
}

export function DeferredRisksSection({ deferred, risks }: Props) {
    if (deferred.length === 0 && risks.length === 0) return null;
    return (
        <div id="prd-deferred-risks" className="mb-8 scroll-mt-24">
            <div className="flex items-center gap-2 mb-3 border-b border-neutral-200 pb-2">
                <h3 className="text-lg font-extrabold text-neutral-900 tracking-tight whitespace-nowrap">
                    Deferred &amp; Risks
                </h3>
            </div>

            {deferred.length > 0 && (
                <div className="mb-5">
                    <div className="flex items-center gap-2 mb-2">
                        <Clock size={14} className="text-neutral-400" aria-hidden />
                        <h4 className="text-xs font-bold uppercase tracking-wider text-neutral-500">
                            Deferred scope
                        </h4>
                        <span className="text-[11px] text-neutral-400">{deferred.length}</span>
                    </div>
                    <ul className="space-y-2">
                        {deferred.map(entry => (
                            <li
                                key={`${entry.kind}-${entry.id}`}
                                className="rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-2.5"
                            >
                                <div className="flex items-center gap-2 flex-wrap">
                                    <ReferenceBadge entry={entry} />
                                    <span className="text-sm font-medium text-neutral-800">{entry.statement}</span>
                                </div>
                                {entry.note && (
                                    <p className="text-xs text-neutral-600 mt-1">{entry.note}</p>
                                )}
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {risks.length > 0 && (
                <div>
                    <div className="flex items-center gap-2 mb-2">
                        <ShieldAlert size={14} className="text-amber-500" aria-hidden />
                        <h4 className="text-xs font-bold uppercase tracking-wider text-neutral-500">
                            Risks
                        </h4>
                        <span className="text-[11px] text-neutral-400">{risks.length}</span>
                    </div>
                    <ul className="space-y-2">
                        {risks.map((r, i) => (
                            <li key={i} className="rounded-lg border border-neutral-200 bg-white px-4 py-3">
                                <div className="flex items-start justify-between gap-3">
                                    <p className="text-sm text-neutral-900 min-w-0">{r.risk}</p>
                                    {r.likelihood && (
                                        <span className={`shrink-0 inline-block text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${likelihoodTone(r.likelihood)}`}>
                                            {r.likelihood}
                                        </span>
                                    )}
                                </div>
                                {r.impact && (
                                    <p className="text-xs text-neutral-600 mt-1.5">
                                        <span className="font-semibold text-neutral-500">Impact: </span>{r.impact}
                                    </p>
                                )}
                                {r.mitigation && (
                                    <p className="text-xs text-neutral-600 mt-1">
                                        <span className="font-semibold text-neutral-500">Mitigation: </span>{r.mitigation}
                                    </p>
                                )}
                                {r.owner && (
                                    <p className="text-xs text-neutral-500 mt-1">Owner: {r.owner}</p>
                                )}
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
}
