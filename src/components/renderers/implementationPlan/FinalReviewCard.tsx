import { useMemo, useState } from 'react';
import {
    AlertTriangle, ArrowRight, Check, CheckCircle2, ChevronDown, Copy, Files,
    History, Package, ShieldCheck, XCircle,
} from 'lucide-react';
import type { ConsolidatedImplementationPlan } from '../../../types';
import type { DependencyNodeStatus } from '../../../lib/artifactDependencyGraph';
import { isStaleStatus } from '../../../lib/artifactFreshness';
import { copyToClipboard } from '../../../lib/utils/copyToClipboard';
import { promptPackToClipboardText } from '../../../lib/services/implementationPlanAdapter';
import {
    buildCoverageMatrix,
    type OrderedPromptPack,
} from '../../../lib/services/implementationPlanInsights';
import type {
    BuildPacketActionTarget,
    BuildPacketReadiness,
} from '../../../lib/planning/buildPacketReadiness';
import {
    reconcileBuildPacketManifest,
    type BuildPacketApprovalOverlay,
    type BuildPacketManifestEntry,
    type BuildPacketManifestRow,
    type FinalReviewAction,
    type FinalReviewCta,
} from '../../../lib/planning/buildPacketApproval';
import type { CrossCuttingObligationsReport } from '../../../lib/planning/crossCuttingObligations';
import { buildPacketActionLabel } from '../../planning/readinessCheckpointView';
import { CrossCuttingObligationsCard } from '../../artifacts/CrossCuttingObligationsCard';
import { CoverageTab } from './CoverageTab';

/**
 * Everything the Final Review surface needs that the plan artifact itself does
 * not carry. Assembled once by `ArtifactWorkspace` and threaded as ONE prop, so
 * the renderer chain does not grow eight parameters.
 */
export interface PlanFinalReviewContext {
    /** §W6's build-packet evaluation. Absent → the `unavailable` CTA state. */
    packet?: BuildPacketReadiness;
    /** The CURRENT artifact-version manifest, from `useBuildPacketInputs`. */
    manifest?: BuildPacketManifestEntry[];
    /** The recorded approval overlay on this plan version, when readable. */
    approval?: BuildPacketApprovalOverlay | null;
    /** Capability-gated (`canPersistWorkflowState`); false in a demo project. */
    canApprove?: boolean;
    /** Records the approval. Omitted when the project cannot persist. */
    onApprove?: () => void;
    /** Routes a blocker's action target through the existing readiness router. */
    onNavigateTarget?: (target: BuildPacketActionTarget) => void;
    /** §W5's cross-cutting obligations report, folded in here (see below). */
    obligations?: CrossCuttingObligationsReport;
    /** The spine version this packet is evaluated against. */
    spineVersionId?: string;
}

interface Props {
    plan: ConsolidatedImplementationPlan;
    context?: PlanFinalReviewContext;
    /**
     * The resolved CTA. Derived ONCE by `ConsolidatedPlanView` (via
     * `deriveFinalReviewCta`) and passed in, so the plan surface's prompt-copy
     * emphasis and this card's primary action can never disagree about whether
     * the packet is approved.
     */
    cta: FinalReviewCta;
    /** "Version 2" — the PRD version this plan was generated from. */
    prdVersionLabel?: string;
    staleness?: DependencyNodeStatus;
    /** Source artifact versions recorded at generation time ("Data Model v1"). */
    sourceVersions?: string[];
    planMarkdown: string;
    /** The recommended next prompt (first uncopied); null when all are copied. */
    nextPack: OrderedPromptPack | null;
    onNextPackCopied?: (packId: string) => void;
    onOpenPrompts: () => void;
    onConvertToTasks?: () => void;
    onOpenMilestone: (milestoneId: string) => void;
    onOpenRoadmap: () => void;
}

const STATUS_STYLE = {
    complete: { icon: CheckCircle2, cls: 'bg-emerald-50 border-emerald-200 text-emerald-800' },
    incomplete: { icon: XCircle, cls: 'bg-amber-50 border-amber-200 text-amber-800' },
} as const;

const DRIFT_CHIP: Record<BuildPacketManifestRow['drift'], { label: string; cls: string }> = {
    unpinned: { label: 'Not approved yet', cls: 'bg-neutral-50 text-neutral-500 border-neutral-200' },
    match: { label: 'Approved', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
    changed: { label: 'Changed since approval', cls: 'bg-amber-50 text-amber-800 border-amber-200' },
    added: { label: 'Added since approval', cls: 'bg-amber-50 text-amber-800 border-amber-200' },
    removed: { label: 'No current version', cls: 'bg-red-50 text-red-700 border-red-200' },
};

/**
 * FINAL REVIEW — the Implementation Plan's decision surface (plan §W7).
 *
 * Replaces the old executive header's FOUR competing actions (Copy next prompt
 * styled primary regardless of blockers, Review prompts, Convert to tasks, Copy
 * plan) with a state machine that promotes EXACTLY ONE primary action:
 *
 *   not ready  → "Resolve N blockers"  (N from §W6's blocker list)
 *   ready      → "Approve build packet" (the ONE genuine approval)
 *   approved   → "Copy first implementation prompt" / "Start first slice"
 *
 * Copy plan, Review prompts and Convert to tasks are secondary at ALL times,
 * including when the packet is ready — copying a prompt before approval stays
 * possible, but only from the clearly-demoted "More actions" menu.
 *
 * ONE SOURCE FOR INTEGRITY. The blocker list is §W6's `packet.blockers`
 * verbatim, in its criterion order, and §W6 consumes `evaluateProjectFreshness`
 * — the same engine the Dependency Graph reads — so the two can never disagree.
 * The Coverage tab's gap summary is folded in below and its full traceability
 * matrix survives as an expandable detail; the Dependency Graph stays as
 * diagnostics. §W5's cross-cutting obligations card renders here too, next to
 * the blocker its `cross_cutting` criterion raises, instead of floating above
 * the plan as a sibling card.
 */
export function FinalReviewCard({
    plan,
    context,
    cta,
    prdVersionLabel,
    staleness,
    sourceVersions,
    planMarkdown,
    nextPack,
    onNextPackCopied,
    onOpenPrompts,
    onConvertToTasks,
    onOpenMilestone,
    onOpenRoadmap,
}: Props) {
    const [blockersOpen, setBlockersOpen] = useState(false);
    const [copied, setCopied] = useState(false);
    const packet = context?.packet;
    const manifestEntries = context?.manifest ?? [];
    const approval = context?.approval ?? null;

    const reconciliation = reconcileBuildPacketManifest(approval, manifestEntries);
    const status = packet ? STATUS_STYLE[packet.status] : undefined;
    const StatusIcon = status?.icon;
    const isStale = isStaleStatus(staleness);

    const runPrimary = () => {
        if (cta.primary.disabled) return;
        if (cta.primary.id === 'resolve_blockers') return setBlockersOpen(open => !open);
        if (cta.primary.id === 'approve') return context?.onApprove?.();
        if (cta.primary.id !== 'start_build') return;
        if (!nextPack) return onOpenRoadmap();
        void copyToClipboard(promptPackToClipboardText(nextPack.pack)).then(ok => {
            if (!ok) return;
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
            onNextPackCopied?.(nextPack.pack.id);
        });
    };

    const runSecondary = (action: FinalReviewAction) => {
        if (action.id === 'review_prompts') return onOpenPrompts();
        if (action.id === 'convert_tasks') return onConvertToTasks?.();
        if (action.id === 'copy_plan') void copyToClipboard(planMarkdown);
    };

    const primaryCopied = copied && cta.primary.id === 'start_build';

    return (
        <section
            aria-labelledby="plan-final-review-heading"
            className="bg-white rounded-xl border border-neutral-200 p-4 space-y-3 not-prose"
        >
            <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                    <h2 id="plan-final-review-heading" className="flex items-center gap-1.5 text-base font-bold text-neutral-900">
                        <ShieldCheck size={15} className="shrink-0 text-indigo-600" aria-hidden="true" />
                        Final Review
                    </h2>
                    <p className="text-[11px] text-neutral-500 mt-1">
                        The last check before this packet is handed to a build.
                        {prdVersionLabel && <span> Generated from PRD {prdVersionLabel}.</span>}
                    </p>
                </div>
                <div className="flex items-center gap-1.5 flex-wrap">
                    {packet && status && StatusIcon && (
                        <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full border ${status.cls}`}>
                            <StatusIcon size={11} /> {packet.headline}
                        </span>
                    )}
                    {approval && !cta.supersededApproval && (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full border bg-emerald-50 border-emerald-200 text-emerald-800">
                            <Check size={11} /> Packet approved
                        </span>
                    )}
                    {cta.supersededApproval && (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full border bg-amber-50 border-amber-200 text-amber-800">
                            <History size={11} /> Approval superseded
                        </span>
                    )}
                    {isStale && (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full border bg-amber-50 border-amber-200 text-amber-800">
                            <History size={11} /> Needs update
                        </span>
                    )}
                </div>
            </div>

            {/* --- The ONE primary action, plus the demoted menu -------------- */}
            <div className="rounded-lg border border-indigo-100 bg-indigo-50/60 px-3 py-2.5 space-y-2">
                <p className="flex items-start gap-1.5 text-xs text-indigo-900">
                    <ArrowRight size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
                    <span>{cta.rationale}</span>
                </p>
                <div className="flex items-center gap-2 flex-wrap min-w-0">
                    <button
                        type="button"
                        data-testid="final-review-primary"
                        data-cta-state={cta.state}
                        data-cta-action={cta.primary.id}
                        onClick={runPrimary}
                        disabled={cta.primary.disabled}
                        aria-expanded={cta.primary.id === 'resolve_blockers' ? blockersOpen : undefined}
                        title={cta.primary.disabledReason}
                        className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-indigo-600 px-4 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:bg-neutral-300 disabled:text-neutral-600"
                    >
                        {cta.primary.id === 'start_build' && (primaryCopied ? <Check size={14} /> : <Copy size={14} />)}
                        {primaryCopied ? 'Copied' : cta.primary.label}
                    </button>
                    <details className="group relative">
                        <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1 rounded-lg border border-neutral-200 bg-white px-3 text-xs font-medium text-neutral-700 transition hover:bg-neutral-50">
                            <ChevronDown size={13} className="transition group-open:rotate-180" aria-hidden="true" />
                            More actions
                        </summary>
                        <div className="mt-2 flex flex-wrap gap-2">
                            {cta.secondary.map(action => (
                                <button
                                    key={action.id}
                                    type="button"
                                    data-testid={`final-review-secondary-${action.id}`}
                                    onClick={() => runSecondary(action)}
                                    className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-neutral-200 bg-white px-2.5 text-xs font-medium text-neutral-700 transition hover:bg-neutral-50"
                                >
                                    {action.id === 'copy_plan' && <Files size={12} aria-hidden="true" />}
                                    {action.label}
                                </button>
                            ))}
                        </div>
                    </details>
                    {cta.primary.disabledReason && (
                        <p className="text-[11px] text-neutral-600">{cta.primary.disabledReason}</p>
                    )}
                </div>
                {approval && !cta.supersededApproval && (
                    <p className="text-[11px] text-indigo-900/70">
                        Approved {new Date(approval.approvedAt).toLocaleString()} · covers{' '}
                        {reconciliation.rows.filter(row => row.approvedVersionId).length} artifact
                        {reconciliation.rows.filter(row => row.approvedVersionId).length === 1 ? '' : 's'}.
                    </p>
                )}
            </div>

            {/* --- The one blocker list (§W6, in criterion order) ------------- */}
            {packet && !packet.isPacketComplete && blockersOpen && (
                <ol data-testid="final-review-blockers" className="space-y-2">
                    {packet.blockers.map((blocker, index) => (
                        <li
                            key={blocker.id}
                            data-testid="final-review-blocker"
                            data-criterion={blocker.criterionId}
                            className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5"
                        >
                            <p className="flex items-start gap-1.5 text-sm font-semibold text-amber-950">
                                <span className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-amber-300 bg-white text-[10px] font-bold text-amber-800">
                                    {index + 1}
                                </span>
                                {blocker.title}
                            </p>
                            <p className="mt-1 text-xs leading-5 text-amber-900">{blocker.consequence}</p>
                            <p className="mt-1 text-xs leading-5 text-amber-900">
                                <span className="font-semibold">Next: </span>{blocker.remedy}
                            </p>
                            {context?.onNavigateTarget && (
                                <button
                                    type="button"
                                    data-testid="final-review-blocker-action"
                                    onClick={() => context.onNavigateTarget?.(blocker.actionTarget)}
                                    className="mt-1.5 inline-flex min-h-9 items-center gap-1 text-xs font-semibold text-amber-900 underline decoration-amber-400 underline-offset-4 hover:decoration-amber-700"
                                >
                                    {buildPacketActionLabel(blocker.actionTarget)} <ArrowRight size={12} aria-hidden="true" />
                                </button>
                            )}
                        </li>
                    ))}
                </ol>
            )}

            {/* Warnings are recorded, never counted as blockers (§W6). */}
            {packet && packet.warnings.length > 0 && (
                <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
                        Recorded, not blocking
                    </p>
                    <ul className="mt-1 space-y-1">
                        {packet.warnings.map(warning => (
                            <li key={warning.id} className="flex items-start gap-1.5 text-xs text-neutral-600">
                                <AlertTriangle size={11} className="mt-0.5 shrink-0 text-neutral-400" aria-hidden="true" />
                                <span><span className="font-semibold">{warning.title}</span> — {warning.impact}</span>
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {/* --- The pinned artifact-version manifest ---------------------- */}
            <details data-testid="final-review-manifest" className="group rounded-lg border border-neutral-200">
                <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-3 text-sm font-semibold text-neutral-800">
                    <ChevronDown size={15} className="transition group-open:rotate-180" aria-hidden="true" />
                    <Package size={14} className="shrink-0 text-neutral-400" aria-hidden="true" />
                    Artifact versions this approval covers
                    {reconciliation.unpinned ? (
                        <span className="text-xs font-medium text-neutral-500">(nothing approved yet)</span>
                    ) : reconciliation.driftCount > 0 ? (
                        <span className="text-xs font-medium text-amber-700">({reconciliation.driftCount} changed)</span>
                    ) : (
                        <span className="text-xs font-medium text-neutral-500">({reconciliation.rows.length})</span>
                    )}
                </summary>
                <div className="border-t border-neutral-200 px-3 py-2">
                    {(prdVersionLabel || approval?.prdVersionLabel) && (
                        <p className="mb-2 text-[11px] text-neutral-500">
                            <span className="font-semibold uppercase tracking-wider">PRD: </span>
                            {approval?.prdVersionLabel ?? prdVersionLabel}
                            {approval?.prdVersionLabel && prdVersionLabel && approval.prdVersionLabel !== prdVersionLabel && (
                                <span className="text-amber-700"> · now {prdVersionLabel}</span>
                            )}
                        </p>
                    )}
                    {reconciliation.rows.length === 0 ? (
                        <p className="py-1 text-xs italic text-neutral-500">
                            No outputs resolved for this project yet.
                        </p>
                    ) : (
                        <ul className="divide-y divide-neutral-100">
                            {reconciliation.rows.map(row => {
                                const chip = DRIFT_CHIP[row.drift];
                                return (
                                    <li
                                        key={row.nodeId}
                                        data-testid={`final-review-manifest-row-${row.nodeId}`}
                                        data-drift={row.drift}
                                        className="flex flex-wrap items-center gap-2 py-1.5"
                                    >
                                        <span className="min-w-0 flex-1 truncate text-xs font-medium text-neutral-800">
                                            {row.title}
                                        </span>
                                        <span className="font-mono text-[11px] text-neutral-600">
                                            {row.approvedVersionLabel ?? row.currentVersionLabel ?? '—'}
                                            {row.drift === 'changed' && (
                                                <span className="text-amber-700"> → {row.currentVersionLabel ?? '—'}</span>
                                            )}
                                        </span>
                                        <span className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${chip.cls}`}>
                                            {chip.label}
                                        </span>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                    <p className="mt-2 text-[11px] text-neutral-500">
                        An approval pins these exact versions. Regenerating an output does not move the
                        approval forward — it is reported as changed, and the packet needs re-approving.
                    </p>
                </div>
            </details>

            {/* --- §W5's conditional cross-cutting obligations ---------------- */}
            {context?.obligations && (
                <CrossCuttingObligationsCard
                    report={context.obligations}
                    securityPrivacy={plan.securityPrivacy}
                    measurement={plan.measurement}
                />
            )}

            {/* --- Coverage: summary here, full matrix as a detail ------------ */}
            <CoverageSummary
                plan={plan}
                prdVersionLabel={prdVersionLabel}
                staleness={staleness}
                sourceVersions={sourceVersions}
                onOpenMilestone={onOpenMilestone}
            />
        </section>
    );
}

/**
 * The Coverage tab's blocker/gap summary, folded into Final Review (§W7.3). The
 * FULL traceability matrix is preserved verbatim as an expandable detail — it is
 * a diagnostic, not a second readiness authority, so it no longer earns a
 * top-level tab.
 */
function CoverageSummary({
    plan,
    prdVersionLabel,
    staleness,
    sourceVersions,
    onOpenMilestone,
}: {
    plan: ConsolidatedImplementationPlan;
    prdVersionLabel?: string;
    staleness?: DependencyNodeStatus;
    sourceVersions?: string[];
    onOpenMilestone: (milestoneId: string) => void;
}) {
    const matrix = useMemo(() => buildCoverageMatrix(plan), [plan]);
    // Mount the matrix only once opened: it is a wide table plus a mobile card
    // list, and a permanently-mounted copy would also duplicate every milestone
    // label in the accessibility tree behind a collapsed detail.
    const [open, setOpen] = useState(false);
    const provenance = [
        ...(prdVersionLabel ? [`PRD ${prdVersionLabel}`] : []),
        ...(sourceVersions ?? []),
    ];
    return (
        <div data-testid="final-review-coverage" className="rounded-lg border border-neutral-200">
            <button
                type="button"
                data-testid="final-review-coverage-toggle"
                aria-expanded={open}
                onClick={() => setOpen(value => !value)}
                className="flex w-full min-h-11 flex-wrap items-center gap-2 px-3 py-1.5 text-left text-sm font-semibold text-neutral-800"
            >
                <ChevronDown size={15} className={`transition ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
                Traceability matrix
                {matrix.rows.length > 0 && (
                    matrix.gapCount === 0 ? (
                        <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                            <CheckCircle2 size={11} aria-hidden="true" /> No coverage gaps
                        </span>
                    ) : (
                        <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                            <AlertTriangle size={11} aria-hidden="true" /> {matrix.gapCount} coverage gap{matrix.gapCount === 1 ? '' : 's'}
                        </span>
                    )
                )}
                {provenance.length > 0 && (
                    <span className="text-[11px] font-medium text-neutral-500">
                        Built from {provenance.join(' · ')}
                    </span>
                )}
            </button>
            {open && (
                <div className="border-t border-neutral-200 px-3 py-3">
                    <CoverageTab
                        plan={plan}
                        prdVersionLabel={prdVersionLabel}
                        staleness={staleness}
                        sourceVersions={sourceVersions}
                        onOpenMilestone={onOpenMilestone}
                        showSummary={false}
                    />
                </div>
            )}
        </div>
    );
}
