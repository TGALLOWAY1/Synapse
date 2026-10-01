import { useEffect, useMemo, useRef, useState } from 'react';
import {
    AlertTriangle, ArrowRight, Check, CheckCircle2, ChevronDown, Circle, Copy, Files,
    History, Package, ShieldCheck,
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
import {
    buildPacketActionLabel,
    type BuildPacketActionTarget,
    type BuildPacketReadiness,
} from '../../../lib/planning/buildPacketReadiness';
import {
    reconcileBuildPacketManifest,
    type BuildPacketApprovalOverlay,
    type BuildPacketManifestEntry,
    type BuildPacketManifestRow,
    type FinalReviewAction,
    type FinalReviewCta,
} from '../../../lib/planning/buildPacketApproval';
import type {
    CrossCuttingObligationStatus,
    CrossCuttingObligationsReport,
} from '../../../lib/planning/crossCuttingObligations';
import type { FlagPlanningConcernResult } from '../../../lib/planning/flagToPlan';
import { CrossCuttingObligationsCard } from '../../artifacts/CrossCuttingObligationsCard';
import { CoverageTab } from './CoverageTab';

/**
 * Everything the Final Review surface needs that the plan artifact itself does
 * not carry. Assembled once by `ArtifactWorkspace` and threaded as ONE prop, so
 * the renderer chain does not grow eight parameters.
 */
export interface PlanFinalReviewContext {
    /** §W6's advisory build-packet evaluation. Absent → no checklist. */
    packet?: BuildPacketReadiness;
    /** The CURRENT artifact-version manifest, from `useBuildPacketInputs`. */
    manifest?: BuildPacketManifestEntry[];
    /** The recorded approval overlay on this plan version, when readable. */
    approval?: BuildPacketApprovalOverlay | null;
    /** Capability-gated (`canPersistWorkflowState`); false in a demo project. */
    canApprove?: boolean;
    /** Records the optional sign-off. Omitted when the project cannot persist. */
    onApprove?: () => void;
    /** Opens the fix for a packet check (an artifact slot or a PRD feature). */
    onNavigateTarget?: (target: BuildPacketActionTarget) => void;
    /** §W5's cross-cutting obligations report, folded in here (see below). */
    obligations?: CrossCuttingObligationsReport;
    /**
     * User-initiated: flags an unresolved obligation as a planning concern and
     * opens the Decision Center on it. Capability-gated by `ArtifactWorkspace`
     * exactly like `onApprove` — omitted in a read-only/demo project, and then
     * the flag renders with no write action at all.
     */
    onAddressObligation?: (
        status: CrossCuttingObligationStatus,
    ) => FlagPlanningConcernResult | void;
    /** The spine version this packet is evaluated against. */
    spineVersionId?: string;
}

interface Props {
    plan: ConsolidatedImplementationPlan;
    context?: PlanFinalReviewContext;
    /**
     * The resolved CTA. Derived ONCE by `ConsolidatedPlanView` (via
     * `deriveFinalReviewCta`) and passed in, so the plan surface's prompt-copy
     * emphasis and this card's primary action can never disagree.
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
    /** Opens and focuses a precise Final Review subsection. */
    initialSection?: 'coverage';
}

const DRIFT_CHIP: Record<BuildPacketManifestRow['drift'], { label: string; cls: string }> = {
    unpinned: { label: 'Not approved yet', cls: 'bg-neutral-50 text-neutral-500 border-neutral-200' },
    match: { label: 'Approved', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
    changed: { label: 'Changed since approval', cls: 'bg-amber-50 text-amber-800 border-amber-200' },
    added: { label: 'Added since approval', cls: 'bg-amber-50 text-amber-800 border-amber-200' },
    removed: { label: 'No current version', cls: 'bg-red-50 text-red-700 border-red-200' },
};

/**
 * FINAL REVIEW — the Implementation Plan's review surface (plan §W7).
 *
 * ADVISORY, NOT A GATE. The build-packet checks (§W6) are an estimated,
 * derived report: the card lists them as a checklist with a navigable fix per
 * open check, and nothing — copying prompts, exporting, converting to tasks —
 * waits on them. Exactly one primary action, always the next build step
 * (copy the next implementation prompt). "Approve build packet" is an
 * OPTIONAL sign-off that pins the current artifact versions and reports
 * "changed since approval" when an output moves; it is never required.
 *
 * ONE SOURCE FOR INTEGRITY. The checklist is §W6's `packet.criteria` /
 * `packet.blockers` verbatim, in criterion order, and §W6 consumes
 * `evaluateProjectFreshness` — the same engine the Dependency Graph reads — so
 * the two can never disagree. The Coverage tab's gap summary is folded in
 * below and its full traceability matrix survives as an expandable detail.
 * §W5's cross-cutting obligations card renders here too, next to the
 * `cross_cutting` check it corresponds to.
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
    initialSection,
}: Props) {
    const [copied, setCopied] = useState(false);
    const packet = context?.packet;
    const manifestEntries = context?.manifest ?? [];
    const approval = context?.approval ?? null;

    const reconciliation = reconcileBuildPacketManifest(approval, manifestEntries);
    const isStale = isStaleStatus(staleness);
    const passingCount = packet?.criteria.filter(criterion => !criterion.blocking).length ?? 0;
    const approveAction = cta.secondary.find(action => action.id === 'approve');
    const menuActions = cta.secondary.filter(action => action.id !== 'approve');

    const runPrimary = () => {
        if (cta.primary.disabled) return;
        if (!nextPack) return onOpenRoadmap();
        void copyToClipboard(promptPackToClipboardText(nextPack.pack)).then(ok => {
            if (!ok) return;
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
            onNextPackCopied?.(nextPack.pack.id);
        });
    };

    const runSecondary = (action: FinalReviewAction) => {
        if (action.disabled) return;
        if (action.id === 'approve') return context?.onApprove?.();
        if (action.id === 'review_prompts') return onOpenPrompts();
        if (action.id === 'convert_tasks') return onConvertToTasks?.();
        if (action.id === 'copy_plan') void copyToClipboard(planMarkdown);
    };

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
                        A last look before this packet goes to a build. The checks are estimated and advisory.
                        {prdVersionLabel && <span> Generated from PRD {prdVersionLabel}.</span>}
                    </p>
                </div>
                <div className="flex items-center gap-1.5 flex-wrap">
                    {packet && (
                        <span
                            data-testid="final-review-status"
                            className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full border ${
                                packet.isPacketComplete
                                    ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                                    : 'bg-neutral-50 border-neutral-200 text-neutral-700'
                            }`}
                        >
                            {packet.isPacketComplete ? <CheckCircle2 size={11} aria-hidden="true" /> : <Circle size={11} aria-hidden="true" />}
                            {packet.isPacketComplete
                                ? 'All checks pass'
                                : `${passingCount} of ${packet.criteria.length} checks pass`}
                            <span className="font-normal opacity-75">· estimated</span>
                        </span>
                    )}
                    {cta.approvalState === 'approved' && (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full border bg-emerald-50 border-emerald-200 text-emerald-800">
                            <Check size={11} /> Packet approved
                        </span>
                    )}
                    {cta.approvalState === 'superseded' && (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full border bg-amber-50 border-amber-200 text-amber-800">
                            <History size={11} /> Changed since approval
                        </span>
                    )}
                    {isStale && (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full border bg-amber-50 border-amber-200 text-amber-800">
                            <History size={11} /> Needs update
                        </span>
                    )}
                </div>
            </div>

            {/* --- The ONE primary action, the optional sign-off, the menu ---- */}
            <div className="rounded-lg border border-indigo-100 bg-indigo-50/60 px-3 py-2.5 space-y-2">
                <p className="flex items-start gap-1.5 text-xs text-indigo-900">
                    <ArrowRight size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
                    <span>{cta.rationale}</span>
                </p>
                <div className="flex items-center gap-2 flex-wrap min-w-0">
                    <button
                        type="button"
                        data-testid="final-review-primary"
                        data-cta-action={cta.primary.id}
                        onClick={runPrimary}
                        disabled={cta.primary.disabled}
                        title={cta.primary.disabledReason}
                        className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-indigo-600 px-4 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:bg-neutral-300 disabled:text-neutral-600"
                    >
                        {nextPack && (copied ? <Check size={14} /> : <Copy size={14} />)}
                        {copied ? 'Copied' : cta.primary.label}
                    </button>
                    {approveAction && (
                        <button
                            type="button"
                            data-testid="final-review-approve"
                            onClick={() => runSecondary(approveAction)}
                            disabled={approveAction.disabled}
                            title={approveAction.disabledReason}
                            className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-indigo-200 bg-white px-3 text-xs font-semibold text-indigo-800 transition hover:bg-indigo-50 disabled:cursor-not-allowed disabled:text-neutral-400"
                        >
                            <Check size={13} aria-hidden="true" />
                            {approveAction.label}
                            <span className="font-normal text-indigo-700/70">(optional)</span>
                        </button>
                    )}
                    <details className="group relative">
                        <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1 rounded-lg border border-neutral-200 bg-white px-3 text-xs font-medium text-neutral-700 transition hover:bg-neutral-50">
                            <ChevronDown size={13} className="transition group-open:rotate-180" aria-hidden="true" />
                            More actions
                        </summary>
                        <div className="mt-2 flex flex-wrap gap-2">
                            {menuActions.map(action => (
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
                    {approveAction?.disabledReason && (
                        <p className="text-[11px] text-neutral-600">{approveAction.disabledReason}</p>
                    )}
                </div>
                {approval && cta.approvalState === 'approved' && (
                    <p className="text-[11px] text-indigo-900/70">
                        Approved {new Date(approval.approvedAt).toLocaleString()} · covers{' '}
                        {reconciliation.rows.filter(row => row.approvedVersionId).length} artifact
                        {reconciliation.rows.filter(row => row.approvedVersionId).length === 1 ? '' : 's'}.
                    </p>
                )}
            </div>

            {/* --- The packet checklist (§W6, in criterion order) ------------- */}
            {packet && (
                <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
                        Packet checks <span className="font-normal normal-case tracking-normal">· estimated, advisory</span>
                    </p>
                    <ol data-testid="final-review-checks" className="mt-1.5 space-y-1.5">
                        {packet.criteria.map(criterion => {
                            const open = criterion.blocking;
                            const criterionBlockers = packet.blockers.filter(blocker => blocker.criterionId === criterion.id);
                            return (
                                <li
                                    key={criterion.id}
                                    data-testid="final-review-check"
                                    data-criterion={criterion.id}
                                    data-open={open ? 'true' : 'false'}
                                    className={`rounded-lg border px-3 py-2 ${open ? 'border-amber-200 bg-amber-50/60' : 'border-neutral-200'}`}
                                >
                                    <p className="flex items-start gap-1.5 text-sm font-medium text-neutral-900">
                                        {open
                                            ? <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-600" aria-hidden="true" />
                                            : criterion.status === 'met'
                                                ? <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-emerald-600" aria-hidden="true" />
                                                : <Circle size={14} className="mt-0.5 shrink-0 text-neutral-400" aria-hidden="true" />}
                                        <span className="min-w-0">{criterion.label}</span>
                                    </p>
                                    {open && (
                                        <>
                                            <p className="mt-0.5 pl-5 text-xs leading-5 text-neutral-700">{criterion.explanation}</p>
                                            <ul className="mt-1 space-y-1.5 pl-5">
                                                {criterionBlockers.map(blocker => (
                                                    <li key={blocker.id} data-testid="final-review-blocker" className="text-xs leading-5 text-neutral-800">
                                                        <span className="font-semibold">{blocker.title}</span>
                                                        <span className="text-neutral-600"> — {blocker.consequence}</span>
                                                        <span className="block text-neutral-600"><span className="font-semibold">Fix: </span>{blocker.remedy}</span>
                                                        {context?.onNavigateTarget && (
                                                            <button
                                                                type="button"
                                                                data-testid="final-review-blocker-action"
                                                                onClick={() => context.onNavigateTarget?.(blocker.actionTarget)}
                                                                className="mt-0.5 inline-flex min-h-9 items-center gap-1 font-semibold text-amber-900 underline decoration-amber-400 underline-offset-4 hover:decoration-amber-700"
                                                            >
                                                                {buildPacketActionLabel(blocker.actionTarget)} <ArrowRight size={12} aria-hidden="true" />
                                                            </button>
                                                        )}
                                                    </li>
                                                ))}
                                            </ul>
                                        </>
                                    )}
                                </li>
                            );
                        })}
                    </ol>
                </div>
            )}

            {/* Warnings are recorded, never counted as open checks (§W6). */}
            {packet && packet.warnings.length > 0 && (
                <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
                        Recorded, not counted
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
                    Artifact versions an approval covers
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
                        Approving is optional. It pins these exact versions; regenerating an output does not move
                        the approval forward — it is reported as changed since approval.
                    </p>
                </div>
            </details>

            {/* --- §W5's conditional cross-cutting obligations ----------------
                A COMPACT FLAG, not a second panel: the checklist above is the
                one statement of severity, and the flag points at it. See
                CrossCuttingObligationsCard. */}
            {context?.obligations && (
                <CrossCuttingObligationsCard
                    report={context.obligations}
                    securityPrivacy={plan.securityPrivacy}
                    measurement={plan.measurement}
                    onAddressObligation={context.onAddressObligation}
                />
            )}

            {/* --- Coverage: summary here, full matrix as a detail ------------ */}
            <CoverageSummary
                plan={plan}
                prdVersionLabel={prdVersionLabel}
                staleness={staleness}
                sourceVersions={sourceVersions}
                onOpenMilestone={onOpenMilestone}
                initiallyOpen={initialSection === 'coverage'}
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
    initiallyOpen = false,
}: {
    plan: ConsolidatedImplementationPlan;
    prdVersionLabel?: string;
    staleness?: DependencyNodeStatus;
    sourceVersions?: string[];
    onOpenMilestone: (milestoneId: string) => void;
    initiallyOpen?: boolean;
}) {
    const matrix = useMemo(() => buildCoverageMatrix(plan), [plan]);
    // Mount the matrix only once opened: it is a wide table plus a mobile card
    // list, and a permanently-mounted copy would also duplicate every milestone
    // label in the accessibility tree behind a collapsed detail.
    const [open, setOpen] = useState(initiallyOpen);
    const sectionRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (!initiallyOpen) return;
        sectionRef.current?.scrollIntoView?.({ block: 'center' });
        sectionRef.current?.focus({ preventScroll: true });
    }, [initiallyOpen]);
    const provenance = [
        ...(prdVersionLabel ? [`PRD ${prdVersionLabel}`] : []),
        ...(sourceVersions ?? []),
    ];
    return (
        <div
            ref={sectionRef}
            id="implementation-plan-coverage"
            tabIndex={-1}
            data-testid="final-review-coverage"
            className="rounded-lg border border-neutral-200"
        >
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
