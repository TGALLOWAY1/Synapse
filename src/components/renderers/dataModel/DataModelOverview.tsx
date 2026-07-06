import {
    Database, GitBranch, ShieldCheck, ShieldAlert, SlidersHorizontal, KeyRound, Table2,
} from 'lucide-react';
import type { StalenessState } from '../../../types';
import type { DataModelSummary } from '../../../lib/dataModelGraph';

interface Props {
    summary: DataModelSummary;
    prdVersionLabel?: string;
    staleness?: StalenessState;
}

const STALENESS_CONFIG: Record<StalenessState, { label: string; className: string }> = {
    current: { label: 'Current', className: 'bg-green-50 text-green-700 ring-1 ring-green-200' },
    possibly_outdated: { label: 'May be outdated', className: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200' },
    outdated: { label: 'Outdated', className: 'bg-red-50 text-red-700 ring-1 ring-red-200' },
};

function StatTile({
    icon: Icon, value, label, tone = 'neutral',
}: {
    icon: typeof Database;
    value: number | string;
    label: string;
    tone?: 'neutral' | 'indigo' | 'rose';
}) {
    const toneCls =
        tone === 'indigo' ? 'text-indigo-600' : tone === 'rose' ? 'text-rose-600' : 'text-neutral-700';
    return (
        <div className="flex items-center gap-2.5 rounded-lg border border-neutral-200 bg-neutral-50/60 px-3 py-2">
            <Icon size={16} className={`shrink-0 ${toneCls}`} aria-hidden="true" />
            <div className="min-w-0">
                <div className="text-base font-bold leading-none text-neutral-900 tabular-nums">{value}</div>
                <div className="mt-0.5 text-[11px] text-neutral-500 truncate">{label}</div>
            </div>
        </div>
    );
}

/**
 * Compact overview header for the Data Model artifact — a confidence check that
 * summarizes provenance, freshness, and the shape of the model (entities,
 * relationships, constraints, indexes, PII) before the user explores details.
 */
export function DataModelOverview({ summary, prdVersionLabel, staleness }: Props) {
    const stale = staleness ? STALENESS_CONFIG[staleness] : undefined;
    const piiLabel =
        summary.piiEntityCount === 0
            ? 'No PII entities'
            : `${summary.piiEntityCount} ${summary.piiEntityCount === 1 ? 'entity' : 'entities'} with PII`;

    return (
        <section
            aria-label="Data model overview"
            className="rounded-xl border border-neutral-200 bg-white shadow-sm p-4 md:p-5"
        >
            <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="flex items-start gap-3 min-w-0">
                    <div className="p-2 rounded-lg bg-indigo-50 text-indigo-600 shrink-0">
                        <Database size={18} />
                    </div>
                    <div className="min-w-0">
                        <h2 className="text-base font-bold text-neutral-900">Data Model</h2>
                        <p className="text-xs text-neutral-500 mt-0.5">
                            {summary.entityCount} {summary.entityCount === 1 ? 'entity' : 'entities'}
                            {summary.apiEndpointCount > 0 && ` · ${summary.apiEndpointCount} API ${summary.apiEndpointCount === 1 ? 'endpoint' : 'endpoints'}`}
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                    {prdVersionLabel && (
                        <span className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full bg-neutral-100 text-neutral-600 font-medium">
                            <Table2 size={11} /> From PRD {prdVersionLabel}
                        </span>
                    )}
                    {stale && (
                        <span className={`inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full font-medium ${stale.className}`}>
                            {staleness === 'current'
                                ? <ShieldCheck size={11} />
                                : <ShieldAlert size={11} />}
                            {stale.label}
                        </span>
                    )}
                </div>
            </div>

            <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
                <StatTile icon={Database} value={summary.entityCount} label="Entities" tone="indigo" />
                <StatTile icon={GitBranch} value={summary.relationshipCount} label={summary.relationshipCount === 1 ? 'Relationship' : 'Relationships'} />
                <StatTile icon={SlidersHorizontal} value={summary.constraintCount} label={summary.constraintCount === 1 ? 'Constraint' : 'Constraints'} />
                <StatTile icon={KeyRound} value={summary.indexCount} label={summary.indexCount === 1 ? 'Index' : 'Indexes'} />
                <StatTile
                    icon={summary.piiEntityCount > 0 ? ShieldAlert : ShieldCheck}
                    value={summary.piiEntityCount > 0 ? summary.piiEntityCount : '—'}
                    label={piiLabel}
                    tone={summary.piiEntityCount > 0 ? 'rose' : 'neutral'}
                />
            </div>
        </section>
    );
}
