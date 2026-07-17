import { useMemo } from 'react';
import { ShieldCheck } from 'lucide-react';
import type { ConsolidatedImplementationPlan, QualityGateCategory } from '../../../types';
import {
    buildGateRows,
    summarizeGateStatuses,
    validationChecklistMarkdown,
    type QualityGateRunStatus,
} from '../../../lib/services/implementationPlanInsights';
import { GATE_CATEGORY_LABELS, GATE_CATEGORY_ORDER } from './gateCategories';
import { GATE_STATUS_BADGE_STYLE, GATE_STATUS_LABELS } from './gateStatus';
import { QualityGateCard } from './QualityGateCard';
import { CopyTextButton } from './CopyTextButton';
import { implementationPlanAnchor } from '../../../lib/planning/implementationPlanNavigation';

interface Props {
    plan: ConsolidatedImplementationPlan;
    /** User-recorded gate outcomes; a gate absent here is Not run. */
    gateStatuses: Record<string, QualityGateRunStatus>;
    onSetGateStatus?: (gateId: string, status: QualityGateRunStatus) => void;
}

/**
 * The Validation tab: a status summary (honest counts — everything starts
 * Not run), a copyable manual checklist, and testable gate cards grouped by
 * category with milestone / prompt-pack linkage.
 */
export function ValidationTab({ plan, gateStatuses, onSetGateStatus }: Props) {
    const rows = useMemo(() => buildGateRows(plan), [plan]);
    const summary = useMemo(() => summarizeGateStatuses(rows, gateStatuses), [rows, gateStatuses]);
    const byCategory = useMemo(() => {
        const map = new Map<QualityGateCategory, typeof rows>();
        for (const row of rows) {
            const list = map.get(row.gate.category) ?? [];
            list.push(row);
            map.set(row.gate.category, list);
        }
        return map;
    }, [rows]);

    if (rows.length === 0) {
        return (
            <div className="bg-white rounded-xl border border-neutral-200 p-5">
                <p className="text-sm text-neutral-500 italic">
                    No quality gates yet. Regenerate the Implementation Plan to get per-milestone quality gates.
                </p>
            </div>
        );
    }

    const summaryChips: Array<{ label: string; value: number; cls?: string }> = [
        { label: 'Gates', value: summary.total },
        { label: 'Required', value: summary.required },
        { label: GATE_STATUS_LABELS.not_run, value: summary.byStatus.not_run, cls: GATE_STATUS_BADGE_STYLE.not_run },
        { label: GATE_STATUS_LABELS.passed, value: summary.byStatus.passed, cls: GATE_STATUS_BADGE_STYLE.passed },
        { label: GATE_STATUS_LABELS.failed, value: summary.byStatus.failed, cls: GATE_STATUS_BADGE_STYLE.failed },
        { label: GATE_STATUS_LABELS.needs_review, value: summary.byStatus.needs_review, cls: GATE_STATUS_BADGE_STYLE.needs_review },
        { label: GATE_STATUS_LABELS.blocked, value: summary.byStatus.blocked, cls: GATE_STATUS_BADGE_STYLE.blocked },
    ];

    return (
        <div className="space-y-4">
            {/* Summary + next action */}
            <div className="bg-white rounded-xl border border-neutral-200 p-4">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0">
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500 mb-1.5">
                            Validation Summary
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                            {summaryChips
                                .filter(c => c.cls === undefined || c.value > 0 || c.label === GATE_STATUS_LABELS.not_run)
                                .map(c => (
                                    <span
                                        key={c.label}
                                        className={`text-[11px] px-2 py-0.5 rounded-full border font-medium ${c.cls ?? 'bg-neutral-100 text-neutral-700 border-neutral-200'}`}
                                    >
                                        {c.value} {c.label}
                                    </span>
                                ))}
                        </div>
                        <p className="text-[11px] text-neutral-500 mt-2">
                            Gates start as <span className="font-semibold">Not run</span> — record an outcome
                            after you verify each one. Nothing is assumed to have passed.
                        </p>
                    </div>
                    <CopyTextButton
                        text={validationChecklistMarkdown(rows, gateStatuses)}
                        label="Copy validation checklist"
                        variant="secondary"
                    />
                </div>
            </div>

            {GATE_CATEGORY_ORDER.filter(c => byCategory.has(c)).map(category => (
                <div key={category} className="bg-white rounded-xl border border-neutral-200 p-4">
                    <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-neutral-500 mb-2">
                        <ShieldCheck size={11} /> {GATE_CATEGORY_LABELS[category]}
                    </p>
                    <div className="space-y-2">
                        {byCategory.get(category)!.map((row, i) => {
                            const gateIndex = row.milestoneId
                                ? plan.milestones.find(milestone => milestone.id === row.milestoneId)?.qualityGates
                                    ?.findIndex(gate => gate.id === row.gate.id) ?? i
                                : plan.globalQualityGates.findIndex(gate => gate.id === row.gate.id);
                            return (
                                <div
                                    id={implementationPlanAnchor.qualityGate(row.milestoneId, row.gate.id, Math.max(0, gateIndex))}
                                    tabIndex={-1}
                                    key={`${row.gate.id}-${i}`}
                                    className="scroll-mt-24"
                                >
                                    <QualityGateCard
                                        gate={row.gate}
                                        status={gateStatuses[row.gate.id] ?? 'not_run'}
                                        onSetStatus={onSetGateStatus ? s => onSetGateStatus(row.gate.id, s) : undefined}
                                        milestoneLabel={
                                            row.milestoneName !== undefined
                                                ? `M${(row.milestoneIndex ?? 0) + 1} · ${row.milestoneName}`
                                                : undefined
                                        }
                                        relatedPackTitles={row.relatedPackTitles}
                                        verifyCommands={row.verifyCommands}
                                        blocksLabel={row.blocksLabel}
                                    />
                                </div>
                            );
                        })}
                    </div>
                </div>
            ))}
        </div>
    );
}
