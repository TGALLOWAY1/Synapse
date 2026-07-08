import {
    AlertTriangle,
    Ban,
    CheckCircle2,
    Circle,
    TerminalSquare,
    XCircle,
} from 'lucide-react';
import type { ImplementationQualityGate } from '../../../types';
import type { QualityGateRunStatus } from '../../../lib/services/implementationPlanInsights';
import { GATE_CATEGORY_LABELS } from './gateCategories';
import { GATE_STATUS_BADGE_STYLE, GATE_STATUS_LABELS, GATE_STATUS_ORDER } from './gateStatus';

const STATUS_ICON: Record<QualityGateRunStatus, { icon: typeof Circle; cls: string }> = {
    not_run: { icon: Circle, cls: 'text-neutral-300' },
    passed: { icon: CheckCircle2, cls: 'text-emerald-600' },
    failed: { icon: XCircle, cls: 'text-red-600' },
    needs_review: { icon: AlertTriangle, cls: 'text-amber-600' },
    blocked: { icon: Ban, cls: 'text-slate-500' },
};

interface Props {
    gate: ImplementationQualityGate;
    /** User-recorded outcome; defaults to `not_run` — never assume a pass. */
    status: QualityGateRunStatus;
    /** When provided, the user can record an outcome for this gate. */
    onSetStatus?: (status: QualityGateRunStatus) => void;
    /** "M2 · Ingestion UI" — the milestone this gate belongs to. Absent = plan-wide. */
    milestoneLabel?: string;
    /** Prompt packs whose output this gate checks. */
    relatedPackTitles?: string[];
    /** Concrete commands to verify the gate (the milestone's validation commands). */
    verifyCommands?: string[];
    /** What this gate blocks when required ("M2 · Ingestion UI"). */
    blocksLabel?: string;
}

/**
 * One testable quality gate: honest run-status (no green until the user
 * records a pass), why it matters, how to verify, and its milestone /
 * prompt-pack linkage.
 */
export function QualityGateCard({
    gate,
    status,
    onSetStatus,
    milestoneLabel,
    relatedPackTitles = [],
    verifyCommands = [],
    blocksLabel,
}: Props) {
    const { icon: StatusIcon, cls } = STATUS_ICON[status];
    return (
        <div className="rounded-lg border border-neutral-200 bg-white px-3 py-2.5">
            <div className="flex items-start gap-2.5">
                <StatusIcon size={16} className={`mt-0.5 shrink-0 ${cls}`} aria-hidden="true" />
                <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2 flex-wrap">
                        <p className="text-sm font-medium text-neutral-900 leading-snug">{gate.title}</p>
                        {onSetStatus ? (
                            <select
                                value={status}
                                onChange={e => onSetStatus(e.target.value as QualityGateRunStatus)}
                                aria-label={`Record outcome for gate: ${gate.title}`}
                                className={`shrink-0 text-[11px] font-medium rounded-md border px-1.5 py-1 cursor-pointer ${GATE_STATUS_BADGE_STYLE[status]}`}
                            >
                                {GATE_STATUS_ORDER.map(s => (
                                    <option key={s} value={s}>{GATE_STATUS_LABELS[s]}</option>
                                ))}
                            </select>
                        ) : (
                            <span className={`shrink-0 text-[11px] font-medium rounded-md border px-1.5 py-0.5 ${GATE_STATUS_BADGE_STYLE[status]}`}>
                                {GATE_STATUS_LABELS[status]}
                            </span>
                        )}
                    </div>
                    {gate.description && (
                        <p className="text-xs text-neutral-600 mt-0.5">{gate.description}</p>
                    )}
                    {verifyCommands.length > 0 && (
                        <div className="mt-1.5">
                            <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
                                <TerminalSquare size={10} /> How to verify
                            </p>
                            <div className="mt-0.5 bg-neutral-900 text-neutral-100 rounded px-2 py-1 text-[11px] font-mono space-y-0.5 overflow-x-auto">
                                {verifyCommands.map((c, i) => <p key={i}>$ {c}</p>)}
                            </div>
                        </div>
                    )}
                    <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-neutral-100 text-neutral-600 border border-neutral-200">
                            {GATE_CATEGORY_LABELS[gate.category] ?? gate.category}
                        </span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded border ${gate.required ? 'bg-indigo-50 text-indigo-700 border-indigo-200' : 'bg-neutral-50 text-neutral-500 border-neutral-200'}`}>
                            {gate.required ? 'Required' : 'Optional'}
                        </span>
                        {blocksLabel && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-50 text-red-700 border border-red-200">
                                Blocks {blocksLabel}
                            </span>
                        )}
                        <span className="text-[10px] text-neutral-400">
                            {milestoneLabel ?? 'Plan-wide gate'}
                        </span>
                        {relatedPackTitles.length > 0 && (
                            <span className="text-[10px] text-neutral-400 truncate">
                                Checks: {relatedPackTitles.join(', ')}
                            </span>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
