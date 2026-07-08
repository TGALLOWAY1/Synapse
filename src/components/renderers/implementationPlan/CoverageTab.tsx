import { useMemo } from 'react';
import { AlertTriangle, CheckCircle2, GitBranch } from 'lucide-react';
import type { ConsolidatedImplementationPlan, StalenessState } from '../../../types';
import {
    buildCoverageMatrix,
    type ChangeImpactEntry,
    type CoverageCell,
} from '../../../lib/services/implementationPlanInsights';

interface Props {
    plan: ConsolidatedImplementationPlan;
    /** "Version 2" — the PRD version this plan was generated from. */
    prdVersionLabel?: string;
    staleness?: StalenessState;
    /** Source artifact versions recorded at generation time ("Data Model v1"). */
    sourceVersions?: string[];
    onOpenMilestone: (milestoneId: string) => void;
}

const CELL_STATE_TEXT = {
    missing: { label: 'None linked', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
    not_tracked: { label: 'Not tracked', cls: 'bg-neutral-50 text-neutral-400 border-neutral-200' },
} as const;

function CoverageCellChips({ cell }: { cell: CoverageCell }) {
    if (cell.state === 'covered') {
        return (
            <span className="flex flex-wrap gap-1">
                {cell.items.map((item, i) => (
                    <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-100 max-w-[14rem] truncate">
                        {item}
                    </span>
                ))}
            </span>
        );
    }
    const { label, cls } = CELL_STATE_TEXT[cell.state];
    return <span className={`text-[10px] px-1.5 py-0.5 rounded border ${cls}`}>{label}</span>;
}

function ImpactRow({ entry, onOpenMilestone }: { entry: ChangeImpactEntry; onOpenMilestone: (id: string) => void }) {
    return (
        <li className="py-2 first:pt-0 last:pb-0">
            <div className="flex items-start gap-2">
                <GitBranch size={13} className="mt-0.5 shrink-0 text-neutral-400" />
                <div className="min-w-0">
                    <p className="text-sm font-medium text-neutral-800">
                        {entry.label}
                        {entry.scope === 'all' && <span className="text-neutral-500 font-normal"> → all milestones</span>}
                        {entry.scope === 'none' && <span className="text-neutral-500 font-normal"> → no scoped impact</span>}
                        {entry.scope === 'unknown' && <span className="text-amber-600 font-normal"> → impact unknown</span>}
                    </p>
                    {entry.scope === 'some' && (
                        <span className="flex flex-wrap gap-1 mt-1">
                            {entry.milestones.map(m => (
                                <button
                                    key={m.id}
                                    type="button"
                                    onClick={() => onOpenMilestone(m.id)}
                                    className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-100 hover:bg-indigo-100 transition"
                                >
                                    M{m.index + 1} · {m.title}
                                </button>
                            ))}
                        </span>
                    )}
                    <p className="text-[11px] text-neutral-500 mt-0.5">
                        {entry.note}
                        {(entry.scope === 'some' || entry.scope === 'all') && (entry.promptPackCount > 0 || entry.qualityGateCount > 0) && (
                            <span> Touches {entry.promptPackCount} prompt{entry.promptPackCount === 1 ? '' : 's'} and {entry.qualityGateCount} gate{entry.qualityGateCount === 1 ? '' : 's'}.</span>
                        )}
                    </p>
                </div>
            </div>
        </li>
    );
}

/**
 * The Coverage tab: a coverage/impact matrix instead of a sparse table —
 * every cell is explicitly covered / none-linked / not-tracked (no ambiguous
 * dashes), rows call out their gaps, provenance shows the source artifact
 * versions, and a change-impact panel answers "if X changes, what do I
 * regenerate?".
 */
export function CoverageTab({ plan, prdVersionLabel, staleness, sourceVersions = [], onOpenMilestone }: Props) {
    const matrix = useMemo(() => buildCoverageMatrix(plan), [plan]);

    if (matrix.rows.length === 0) {
        return (
            <div className="bg-white rounded-xl border border-neutral-200 p-5">
                <p className="text-sm text-neutral-500 italic">
                    No coverage links yet. Regenerate the Implementation Plan so milestones reference
                    screens, data models, and components from your other assets.
                </p>
            </div>
        );
    }

    const isStale = staleness && staleness !== 'current';
    const provenance = [
        ...(prdVersionLabel ? [`PRD ${prdVersionLabel}`] : []),
        ...sourceVersions,
    ];

    const columns: Array<{ key: 'screens' | 'dataModels' | 'components' | 'promptPacks' | 'qualityGates'; label: string }> = [
        { key: 'screens', label: 'Screens' },
        { key: 'dataModels', label: 'Data Models' },
        { key: 'components', label: 'Components' },
        { key: 'promptPacks', label: 'Prompt Packs' },
        { key: 'qualityGates', label: 'Quality Gates' },
    ];

    return (
        <div className="space-y-4">
            {/* Provenance + gap summary */}
            <div className="bg-white rounded-xl border border-neutral-200 p-4 space-y-2">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0">
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500 mb-1.5">
                            Built From
                        </p>
                        {provenance.length > 0 ? (
                            <div className="flex flex-wrap gap-1.5">
                                {provenance.map((p, i) => (
                                    <span key={i} className="text-[11px] px-2 py-0.5 rounded-full bg-neutral-100 text-neutral-700 border border-neutral-200">
                                        {p}
                                    </span>
                                ))}
                            </div>
                        ) : (
                            <p className="text-[11px] text-neutral-400">
                                No source versions recorded — this plan predates provenance tracking.
                            </p>
                        )}
                    </div>
                    {matrix.gapCount === 0 ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full border bg-emerald-50 text-emerald-700 border-emerald-200">
                            <CheckCircle2 size={11} /> No coverage gaps
                        </span>
                    ) : (
                        <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full border bg-amber-50 text-amber-700 border-amber-200">
                            <AlertTriangle size={11} /> {matrix.gapCount} coverage gap{matrix.gapCount === 1 ? '' : 's'}
                        </span>
                    )}
                </div>
                {isStale && (
                    <p className="flex items-start gap-1.5 text-xs text-amber-700">
                        <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                        The PRD has changed since this plan was generated — its coverage may be stale.
                        Regenerate the plan (or mark it up to date) from the header above.
                    </p>
                )}
            </div>

            {/* Desktop: coverage matrix */}
            <div className="hidden md:block bg-white rounded-xl border border-neutral-200 overflow-x-auto">
                <table className="w-full text-left text-xs">
                    <thead>
                        <tr className="border-b border-neutral-200 text-[10px] uppercase tracking-wider text-neutral-500">
                            <th className="px-3 py-2 font-semibold min-w-[11rem]">Milestone</th>
                            {columns.map(c => <th key={c.key} className="px-3 py-2 font-semibold">{c.label}</th>)}
                        </tr>
                    </thead>
                    <tbody>
                        {matrix.rows.map(row => (
                            <tr key={row.milestoneId} className="border-b border-neutral-100 last:border-b-0 align-top">
                                {/* Row status lives with the milestone name — a
                                    dedicated column pushed the table past the
                                    container width. */}
                                <td className="px-3 py-2.5">
                                    <button
                                        type="button"
                                        onClick={() => onOpenMilestone(row.milestoneId)}
                                        className="font-medium text-neutral-900 hover:text-indigo-700 text-left transition"
                                    >
                                        M{row.milestoneIndex + 1} · {row.milestoneTitle}
                                    </button>
                                    <div className="mt-1">
                                        {row.gaps.length === 0 ? (
                                            <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border bg-emerald-50 text-emerald-700 border-emerald-200 whitespace-nowrap">
                                                <CheckCircle2 size={10} /> Covered
                                            </span>
                                        ) : (
                                            <span
                                                className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border bg-amber-50 text-amber-700 border-amber-200 whitespace-nowrap"
                                                title={row.gaps.join(' · ')}
                                            >
                                                <AlertTriangle size={10} /> {row.gaps.length} gap{row.gaps.length === 1 ? '' : 's'}
                                            </span>
                                        )}
                                    </div>
                                </td>
                                {columns.map(c => (
                                    <td key={c.key} className="px-3 py-2.5">
                                        <CoverageCellChips cell={row[c.key]} />
                                    </td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {/* Mobile: stacked cards */}
            <div className="md:hidden space-y-3">
                {matrix.rows.map(row => (
                    <div key={row.milestoneId} className="bg-white rounded-xl border border-neutral-200 p-4 space-y-2">
                        <div className="flex items-start justify-between gap-2">
                            <button
                                type="button"
                                onClick={() => onOpenMilestone(row.milestoneId)}
                                className="text-sm font-bold text-neutral-900 text-left hover:text-indigo-700 transition"
                            >
                                M{row.milestoneIndex + 1} · {row.milestoneTitle}
                            </button>
                            {row.gaps.length === 0 ? (
                                <span className="shrink-0 inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border bg-emerald-50 text-emerald-700 border-emerald-200">
                                    <CheckCircle2 size={10} /> Covered
                                </span>
                            ) : (
                                <span className="shrink-0 inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border bg-amber-50 text-amber-700 border-amber-200">
                                    <AlertTriangle size={10} /> {row.gaps.length} gap{row.gaps.length === 1 ? '' : 's'}
                                </span>
                            )}
                        </div>
                        {columns.map(c => (
                            <div key={c.key} className="flex items-start gap-2">
                                <span className="shrink-0 w-24 text-[10px] font-semibold uppercase tracking-wider text-neutral-400 mt-0.5">
                                    {c.label}
                                </span>
                                <CoverageCellChips cell={row[c.key]} />
                            </div>
                        ))}
                        {row.gaps.length > 0 && (
                            <p className="text-[11px] text-amber-700">{row.gaps.join(' · ')}</p>
                        )}
                    </div>
                ))}
            </div>

            {/* Change impact */}
            <div className="bg-white rounded-xl border border-neutral-200 p-4">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500 mb-1.5">
                    Change Impact — if an upstream artifact changes
                </p>
                <ul className="divide-y divide-neutral-100">
                    {matrix.impact.map(entry => (
                        <ImpactRow key={entry.source} entry={entry} onOpenMilestone={onOpenMilestone} />
                    ))}
                </ul>
            </div>
        </div>
    );
}
