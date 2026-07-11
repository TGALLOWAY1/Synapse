import {
    Database, GitBranch, ShieldCheck, ShieldAlert, SlidersHorizontal, KeyRound, Network,
} from 'lucide-react';
import type { DataModelSummary } from '../../../lib/dataModelGraph';
import type { DependencyNodeStatus } from '../../../lib/artifactDependencyGraph';

interface Props {
    summary: DataModelSummary;
    staleness?: DependencyNodeStatus;
}

// The freshness pill STAYS shown when fresh (up_to_date → green "Up to date")
// as well as when stale. Statuses without an entry render nothing (the pill is
// hidden) — matching the old "undefined → hidden" behavior.
const STALENESS_CONFIG: Partial<Record<DependencyNodeStatus, { label: string; className: string }>> = {
    up_to_date: { label: 'Up to date', className: 'bg-green-50 text-green-700 ring-1 ring-green-200' },
    update_recommended: { label: 'Update recommended', className: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200' },
    needs_update: { label: 'Needs update', className: 'bg-amber-100 text-amber-800 ring-1 ring-amber-300' },
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
        <div
            role="listitem"
            className="flex items-center gap-2.5 rounded-lg border border-neutral-200 bg-neutral-50/60 px-3 py-2"
        >
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
 * summarizes freshness and the shape of the model (entities, relationships,
 * constraints, indexes, PII, API endpoints) before the user explores details.
 *
 * PRD provenance ("Generated from PRD Version N") is deliberately NOT repeated
 * here — it lives once at the artifact/page level (ArtifactWorkspace's version
 * controls strip) so the same fact isn't shown twice in close proximity.
 */
export function DataModelOverview({ summary, staleness }: Props) {
    const stale = staleness ? STALENESS_CONFIG[staleness] : undefined;
    const piiLabel = summary.piiEntityCount === 1 ? 'Entity with PII' : 'Entities with PII';

    return (
        <section
            aria-label="Data model overview"
            className="rounded-xl border border-neutral-200 bg-white shadow-sm p-4 md:p-5"
        >
            <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2.5 min-w-0">
                    <div className="p-2 rounded-lg bg-indigo-50 text-indigo-600 shrink-0">
                        <Database size={18} />
                    </div>
                    <h2 className="text-base font-bold text-neutral-900 truncate">Data Model</h2>
                </div>
                {stale && (
                    <span className={`inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full font-medium ${stale.className}`}>
                        {staleness === 'up_to_date'
                            ? <ShieldCheck size={11} />
                            : <ShieldAlert size={11} />}
                        {stale.label}
                    </span>
                )}
            </div>

            <div
                role="list"
                aria-label="Data model metrics"
                className="mt-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2"
            >
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
                <StatTile icon={Network} value={summary.apiEndpointCount} label={summary.apiEndpointCount === 1 ? 'API Endpoint' : 'API Endpoints'} />
            </div>
        </section>
    );
}
