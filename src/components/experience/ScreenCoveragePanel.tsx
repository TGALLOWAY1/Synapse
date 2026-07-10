// Screen Coverage & Readiness — the artifact-level rollup card at the top of
// the Screens list. Replaces the old mockup-only coverage card with a broader
// derived view: PRD feature coverage, flow representation, P0 completeness,
// state documentation, mockups, open risks, and implementation readiness.
// Everything shown here is ESTIMATED from the generated spec (see
// src/lib/screenReadiness.ts) — the copy must keep saying so; never present
// these numbers as a full PRD validation.

import { useState } from 'react';
import {
    AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, Circle, ClipboardCheck, Gauge,
    Image as ImageIcon, Sparkles,
} from 'lucide-react';
import type { ScreenCoverageSummary } from '../../lib/screenReadiness';
import type { ScreenArtifactReviewReadiness } from '../../lib/screenReviewWorkflow';
import type { ScreensDownstreamImpactRollup } from '../../lib/screenDownstreamImpact';
import type { ScreensHandoffRollup } from '../../lib/screenImplementationHandoff';
import type { MockupVariantCoverageSummary } from '../../lib/mockupVariants';

interface Props {
    summary: ScreenCoverageSummary;
    /** Artifact-level mockup-variant rollup (Phase 3A). Absent/null → the
     * variant rows are hidden (e.g. no screens). */
    variantCoverage?: MockupVariantCoverageSummary | null;
    /** Artifact-level review readiness gate (Phase 4A). Absent → the review
     * readiness section is hidden (legacy callers). */
    artifactReview?: ScreenArtifactReviewReadiness;
    /** Artifact-level downstream-impact rollup (Phase 4B). Absent → the
     * downstream readiness section is hidden (legacy callers). */
    downstreamRollup?: ScreensDownstreamImpactRollup;
    /** Artifact-level implementation-handoff rollup (Phase 5A). Absent → the
     * handoff readiness section is hidden (legacy callers). */
    handoffRollup?: ScreensHandoffRollup;
    /** Opens the confirmed "Generate remaining mockups" flow (absent → no
     * mockup artifact yet; the action row is hidden). */
    onGenerateMissingMockups?: () => void;
}

type RowTone = 'good' | 'todo' | 'risk';

/** One row in the "Ready for Development" required checklist. `good` = a green
 * check (done), `risk` = a genuine implementation risk (amber), `todo` = still
 * in progress but NOT alarming (neutral). Only genuine risk ever uses warning
 * color — an unmet-but-optional item is never amber. */
function RequiredRow({ label, value, tone, hint }: {
    label: string;
    value: string;
    tone: RowTone;
    hint?: string;
}) {
    const Icon = tone === 'good' ? CheckCircle2 : tone === 'risk' ? AlertTriangle : Circle;
    const iconColor = tone === 'good'
        ? 'text-emerald-500'
        : tone === 'risk' ? 'text-amber-500' : 'text-neutral-300';
    const valueColor = tone === 'risk' ? 'text-amber-700' : 'text-neutral-700';
    return (
        <div className="flex items-center justify-between gap-3 py-1" title={hint}>
            <span className="flex items-center gap-1.5 text-xs text-neutral-700 min-w-0">
                <Icon size={13} className={`shrink-0 ${iconColor}`} aria-hidden />
                <span className="truncate">{label}</span>
            </span>
            <span className={`text-xs font-medium tabular-nums text-right shrink-0 ${valueColor}`}>{value}</span>
        </div>
    );
}

/** Slim progress meter. `good` fills emerald; `neutral` fills indigo and is
 * never a warning color (used for the optional expanded-coverage bar). */
function ProgressBar({ pct, tone, trailingLabel }: {
    pct: number;
    tone: 'good' | 'neutral';
    trailingLabel?: string;
}) {
    const clamped = Math.max(0, Math.min(1, pct));
    const track = tone === 'good' ? 'bg-emerald-100' : 'bg-indigo-100';
    const fill = tone === 'good' ? 'bg-emerald-500' : 'bg-indigo-400';
    return (
        <div className="flex items-center gap-2">
            <div className={`h-2 flex-1 rounded-full overflow-hidden ${track}`}>
                <div className={`h-full rounded-full ${fill}`} style={{ width: `${Math.round(clamped * 100)}%` }} />
            </div>
            {trailingLabel && (
                <span className="text-[10px] font-medium text-neutral-500 tabular-nums shrink-0">{trailingLabel}</span>
            )}
        </div>
    );
}

export function ScreenCoveragePanel({ summary, variantCoverage, artifactReview, downstreamRollup, handoffRollup, onGenerateMissingMockups }: Props) {
    const [showUncovered, setShowUncovered] = useState(false);
    const {
        totalScreens, prdFeatures, flows, p0, states, openRisks,
        ready, readyWithWarnings, message,
    } = summary;
    if (totalScreens === 0) return null;

    // Clean-ready screens: implementation-ready and NOT a user override that
    // still carries derived warnings. Every screen being clean-ready is
    // necessary for the all-clear, but not sufficient — see `coreComplete`
    // below, which also requires no genuine artifact-level risk (mockup
    // variants never factor in either way).
    const readyClean = Math.max(0, ready - readyWithWarnings);
    const readyComplete = readyClean === totalScreens;

    // --- Required (implementation-critical) checklist -----------------------
    // Only genuine implementation risk (missing PRD coverage, a P0 without its
    // primary mockup, unhandled risks) is styled amber. Everything else that is
    // simply not-yet-done reads as a calm "in progress", never a failure.
    const required: Array<{ key: string; label: string; value: string; tone: RowTone; hint?: string }> = [];
    if (prdFeatures) {
        const done = prdFeatures.covered === prdFeatures.total;
        required.push({
            key: 'prd', label: 'PRD features linked',
            value: `${prdFeatures.covered} / ${prdFeatures.total}`,
            tone: done ? 'good' : 'risk',
            hint: 'PRD features referenced by at least one screen — estimated from feature ids, not a full PRD validation',
        });
    } else {
        required.push({ key: 'prd', label: 'PRD features linked', value: 'No feature list', tone: 'todo' });
    }
    if (flows) {
        const done = flows.represented === flows.total;
        required.push({
            key: 'flows', label: 'User flows represented',
            value: `${flows.represented} / ${flows.total}`,
            tone: done ? 'good' : 'todo',
            hint: 'User flows with at least one step matched to a screen',
        });
    } else {
        required.push({ key: 'flows', label: 'User flows represented', value: 'No flows yet', tone: 'todo' });
    }
    {
        const usesP0 = p0.total > 0;
        const done = usesP0 ? p0.withMockup === p0.total : summary.mockups.covered === summary.mockups.total;
        required.push({
            key: 'primary', label: 'Primary mockups',
            value: usesP0 ? `${p0.withMockup} / ${p0.total} key screens` : `${summary.mockups.covered} / ${summary.mockups.total} screens`,
            // A P0 (key) screen without its one primary mockup is genuine risk;
            // a non-critical screen still awaiting its mockup is just in progress.
            tone: done ? 'good' : usesP0 ? 'risk' : 'todo',
            hint: 'Every key screen should have one primary implementation-quality mockup. Extra variants are optional (see Expanded Design Coverage).',
        });
    }
    {
        const done = states.screensWithStates === totalScreens;
        required.push({
            key: 'states', label: 'Screen states documented',
            value: `${states.screensWithStates} / ${totalScreens}`,
            tone: done ? 'good' : 'todo',
            hint: states.totalStates > 0
                ? `${states.statesWithBehavior} of ${states.totalStates} documented states describe a trigger or behavior`
                : undefined,
        });
    }
    required.push({
        key: 'risks', label: 'Open risks',
        value: openRisks === 0 ? 'None noted' : `${openRisks} to review`,
        tone: openRisks === 0 ? 'good' : 'risk',
        hint: 'Risk notes in the spec with no recorded handling yet — review them per screen',
    });
    required.push({
        key: 'ready', label: 'Screens confirmed',
        value: `${readyClean} / ${totalScreens} screens`,
        tone: readyComplete ? 'good' : 'todo',
        hint: 'Screens you have signed off with Confirm Screen (excluding any confirmed over open warnings)',
    });

    // The green "all-clear" is shown only when every screen is clean-ready AND
    // no genuine artifact-level implementation risk remains — an amber required
    // row (uncovered PRD features, a P0 without its primary mockup, open risks)
    // or a must-have feature owned only by a low-priority screen. Otherwise the
    // celebratory headline would contradict the risk rows / uncovered-feature
    // disclosure rendered directly below it.
    const hasImplementationRisk = required.some(r => r.tone === 'risk')
        || (prdFeatures?.mustWithoutPrimaryScreen.length ?? 0) > 0;
    const coreComplete = readyComplete && !hasImplementationRisk;

    // When every screen is clean-ready but an artifact-level risk remains
    // (uncovered PRD feature, a must-have owned only by a low-priority screen),
    // the per-screen `message` still reads "All N screens pass…" — an all-clear
    // that would sit directly above the amber disclosure. Use a dedicated
    // risk-aware headline for that case instead of reusing that message.
    const headline = coreComplete
        ? 'Implementation coverage is complete. Every screen is confirmed and has its required assets — optional design documentation can be generated whenever you like.'
        : readyComplete
            ? 'Every screen is confirmed, but some required coverage still needs review before implementation — see the flagged items below.'
            : message;

    const missingMockups = summary.mockups.total - summary.mockups.covered;
    const hasExpanded = Boolean(variantCoverage && variantCoverage.additionalTotal > 0);

    return (
        <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
            <div className="flex items-start gap-3">
                <div className={`mt-0.5 h-8 w-8 shrink-0 rounded-lg flex items-center justify-center ${coreComplete ? 'bg-emerald-50' : 'bg-indigo-50'}`}>
                    <Gauge size={16} className={coreComplete ? 'text-emerald-600' : 'text-indigo-600'} />
                </div>
                <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2 flex-wrap">
                        <h3 className="text-sm font-semibold text-neutral-900">Screen Coverage &amp; Readiness</h3>
                        <span className="text-[10px] uppercase tracking-wide text-neutral-400">
                            Estimated from the generated spec
                        </span>
                    </div>
                    <p className="mt-1 text-xs leading-relaxed text-neutral-600">{headline}</p>

                    {/* --- Ready for Development (required implementation assets) --- */}
                    <div className="mt-3">
                        <div className="flex items-baseline justify-between gap-2 mb-1.5">
                            <h4 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                                {coreComplete && <CheckCircle2 size={13} className="text-emerald-500" aria-hidden />}
                                Ready for Development
                            </h4>
                            <span className="text-[11px] font-medium text-neutral-500 tabular-nums">
                                {readyClean} / {totalScreens} screens
                            </span>
                        </div>
                        <ProgressBar
                            pct={totalScreens > 0 ? readyClean / totalScreens : 0}
                            tone="good"
                            trailingLabel={totalScreens > 0 ? `${Math.round((readyClean / totalScreens) * 100)}%` : undefined}
                        />
                        <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-x-6">
                            {required.map(r => (
                                <RequiredRow key={r.key} label={r.label} value={r.value} tone={r.tone} hint={r.hint} />
                            ))}
                        </div>
                    </div>

                    {prdFeatures && prdFeatures.mustWithoutPrimaryScreen.length > 0 && (
                        <p className="mt-2 text-[11px] text-amber-700">
                            {prdFeatures.mustWithoutPrimaryScreen.length === 1
                                ? `Must-have feature ${prdFeatures.mustWithoutPrimaryScreen[0].id} (${prdFeatures.mustWithoutPrimaryScreen[0].name}) is only covered by lower-priority screens`
                                : `${prdFeatures.mustWithoutPrimaryScreen.length} must-have features are only covered by lower-priority screens`}
                            {' '}— check whether a P0/P1 screen should own {prdFeatures.mustWithoutPrimaryScreen.length === 1 ? 'it' : 'them'}.
                        </p>
                    )}
                    {prdFeatures && prdFeatures.uncovered.length > 0 && (
                        <div className="mt-2">
                            <button
                                type="button"
                                onClick={() => setShowUncovered(v => !v)}
                                className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-700 hover:text-amber-900"
                            >
                                {showUncovered ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                                {prdFeatures.uncovered.length === 1
                                    ? '1 PRD feature not linked to any screen'
                                    : `${prdFeatures.uncovered.length} PRD features not linked to any screen`}
                            </button>
                            {showUncovered && (
                                <ul className="mt-1.5 space-y-1 text-[11px] text-neutral-600">
                                    {prdFeatures.uncovered.map(f => (
                                        <li key={f.id} className="flex gap-1.5 items-start">
                                            <AlertTriangle size={11} className="text-amber-500 mt-0.5 shrink-0" aria-hidden />
                                            <span>
                                                <span className="font-mono font-medium text-neutral-700">{f.id}</span>
                                                {' '}{f.name} — some coverage is still unclear; review recommended before implementation.
                                            </span>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    )}

                    {(missingMockups > 0 && onGenerateMissingMockups) && (
                        <div className="mt-3 flex flex-wrap items-center gap-2">
                            <button
                                type="button"
                                onClick={onGenerateMissingMockups}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs bg-indigo-600 hover:bg-indigo-700 text-white rounded-md transition"
                            >
                                <ImageIcon size={12} />
                                {missingMockups === 1 ? 'Generate the missing mockup' : `Generate ${missingMockups} missing mockups`}
                            </button>
                            <span className="text-[11px] text-neutral-400">
                                Adding coverage is free — image generation is confirmed separately.
                            </span>
                        </div>
                    )}

                    {/* --- Expanded Design Coverage (optional enhancement) --- */}
                    {hasExpanded && variantCoverage && (
                        <ExpandedCoverageSection variant={variantCoverage} />
                    )}

                    {/* Freshness / legacy signals for EXISTING generated mockups
                        (primary or variant). Rendered independently of the
                        variants section so they still surface for desktop /
                        simple projects that have only primary mockups
                        (additionalTotal === 0, no Expanded section). Neutral —
                        an out-of-date or metadata-less mockup is a nudge, not an
                        implementation blocker. */}
                    {variantCoverage && (variantCoverage.freshness.review > 0 || variantCoverage.legacyUnknownMockups > 0) && (
                        <div className="mt-3 space-y-1">
                            {variantCoverage.freshness.review > 0 && (
                                <p className="text-[11px] text-neutral-500">
                                    {variantCoverage.freshness.review} generated {variantCoverage.freshness.review === 1 ? 'mockup' : 'mockups'}
                                    {' '}may be worth refreshing after recent spec, design-system, or PRD changes.
                                </p>
                            )}
                            {variantCoverage.legacyUnknownMockups > 0 && (
                                <p className="text-[11px] text-neutral-400">
                                    {variantCoverage.legacyUnknownMockups} older {variantCoverage.legacyUnknownMockups === 1 ? 'mockup' : 'mockups'}
                                    {' '}predate coverage metadata — visually useful, but their spec coverage is unconfirmed.
                                </p>
                            )}
                        </div>
                    )}

                    {coreComplete && (
                        <p className="mt-3 inline-flex items-center gap-1.5 text-[11px] text-emerald-700">
                            <CheckCircle2 size={12} /> Core assets complete — statuses are estimates, so give screens a final review before building.
                        </p>
                    )}

                    {artifactReview && artifactReview.totalScreens > 0 && (
                        <ReviewReadinessSection review={artifactReview} />
                    )}

                    {downstreamRollup && (
                        <DownstreamReadinessSection rollup={downstreamRollup} />
                    )}

                    {handoffRollup && handoffRollup.total > 0 && (
                        <HandoffReadinessSection rollup={handoffRollup} />
                    )}
                </div>
            </div>
        </div>
    );
}

/**
 * Optional "Expanded Design Coverage" — the additional viewport × state mockup
 * variants a user can generate on demand. This is deliberately framed as a
 * premium enhancement, NOT a checklist to complete: no warning color, positive
 * "N generated · M available on demand" messaging, an "Optional" progress bar,
 * and a discovery card pointing at the per-screen Mockups tab (where the actual
 * on-demand variant generation lives). Additional variants never affect a
 * screen's readiness — see src/lib/screenReadiness.ts.
 */
function ExpandedCoverageSection({ variant }: { variant: MockupVariantCoverageSummary }) {
    const total = variant.additionalTotal;
    const generated = variant.additionalGenerated;
    const remaining = Math.max(0, total - generated);
    const pct = total > 0 ? generated / total : 0;
    const statLine = generated === 0
        ? `${total} available on demand`
        : remaining === 0
            ? `All ${total} generated`
            : `${generated} generated · ${remaining} available on demand`;

    return (
        <div className="mt-4 pt-4 border-t border-neutral-100">
            <div className="flex items-center justify-between gap-2 mb-1">
                <div className="flex items-center gap-1.5">
                    <Sparkles size={13} className="text-indigo-400" aria-hidden />
                    <h4 className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                        Expanded Design Coverage
                    </h4>
                </div>
                <span className="text-[10px] uppercase tracking-wide text-neutral-400">Optional</span>
            </div>
            <p className="text-[11px] leading-relaxed text-neutral-500">
                Primary screens are prioritized first. Additional variants — empty, loading, error, and
                responsive layouts — are generated only when you request them, to keep projects fast.
            </p>

            <div className="mt-2.5 space-y-1.5">
                <div className="flex items-baseline justify-between gap-3">
                    <span className="text-xs text-neutral-700">Expanded coverage</span>
                    <span className="text-xs font-medium text-neutral-700 tabular-nums">{statLine}</span>
                </div>
                <ProgressBar pct={pct} tone="neutral" trailingLabel="Optional" />

                {variant.p0Total > 0 && (
                    <div className="flex items-baseline justify-between gap-3">
                        <span className="text-xs text-neutral-500">Mobile previews (key screens)</span>
                        <span className="text-xs text-neutral-500 tabular-nums">
                            {variant.p0WithMobile} / {variant.p0Total} · optional
                        </span>
                    </div>
                )}
            </div>

            <div className="mt-3 rounded-lg border border-indigo-100 bg-indigo-50/40 p-3">
                <p className="flex items-center gap-1.5 text-xs font-medium text-neutral-800">
                    <Sparkles size={12} className="text-indigo-500" aria-hidden />
                    Expand coverage when you need it
                </p>
                <p className="text-[11px] text-neutral-600 mt-1">
                    Open a screen&rsquo;s <span className="font-medium text-neutral-700">Mockups</span> tab to generate
                    additional variants — empty, loading, error, and success states, plus mobile and alternate
                    layouts — on demand.
                </p>
            </div>
        </div>
    );
}

/**
 * Phase 5A rollup, demoted to one quiet line (audit H2/C1): implementation
 * handoff is an Implementation-Plan concern, so inside Screens it must never
 * issue a verdict banner that competes with — or contradicts — the review
 * gate above. Amber is reserved for genuinely blocked screens; everything
 * else reads as neutral information. Details live in the export panel below.
 */
function HandoffReadinessSection({ rollup }: { rollup: ScreensHandoffRollup }) {
    return (
        <div className="mt-4 pt-4 border-t border-neutral-100">
            <div className="flex items-center gap-1.5 mb-1">
                <ClipboardCheck size={13} className="text-neutral-400" aria-hidden />
                <h4 className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">Implementation handoff</h4>
            </div>
            {rollup.blocked > 0 ? (
                <p className="text-[11px] text-amber-700">
                    {rollup.blocked} {rollup.blocked === 1 ? 'screen is' : 'screens are'} blocked for handoff —
                    resolve the blocking review items before packaging.
                </p>
            ) : (
                <p className="text-[11px] text-neutral-500">
                    {rollup.ready} of {rollup.total} screens ready to package
                    {rollup.reviewRecommended > 0
                        ? ` · ${rollup.reviewRecommended} with advisory review notes`
                        : ''} — see the export panel below.
                </p>
            )}
            {rollup.trace && (rollup.trace.p0PlanMissing > 0 || rollup.trace.p0DataModelMissing > 0) && (
                <p className="mt-1 text-[11px] text-amber-700">
                    {rollup.trace.p0PlanMissing > 0 && (
                        `${rollup.trace.p0PlanMissing} P0 ${rollup.trace.p0PlanMissing === 1 ? 'screen lacks' : 'screens lack'} an Implementation Plan match. `
                    )}
                    {rollup.trace.p0DataModelMissing > 0 && (
                        `${rollup.trace.p0DataModelMissing} P0 ${rollup.trace.p0DataModelMissing === 1 ? 'screen has' : 'screens have'} data dependencies with no Data Model match.`
                    )}
                </p>
            )}
        </div>
    );
}

/**
 * Phase 4B rollup, demoted (audit C1/H2): when nothing changed downstream it
 * renders NOTHING — the old always-on green "Ready for implementation
 * planning" banner duplicated (and could contradict) the review gate above.
 * It only speaks when a change/blocker actually ripples downstream.
 */
function DownstreamReadinessSection({ rollup }: { rollup: ScreensDownstreamImpactRollup }) {
    if (rollup.overallStatus === 'ready') return null;
    return (
        <div className="mt-4 pt-4 border-t border-neutral-100">
            <div className="flex items-center gap-1.5 mb-2">
                <Gauge size={13} className="text-neutral-400" aria-hidden />
                <h4 className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">Downstream impact</h4>
            </div>
            <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3 flex items-start gap-2">
                <AlertTriangle size={15} className="text-amber-600 mt-0.5 shrink-0" aria-hidden />
                <div className="min-w-0">
                    <p className="text-xs font-medium text-amber-800">
                        {rollup.overallStatus === 'not_ready'
                            ? 'Screen changes affect downstream artifacts'
                            : 'Review recommended before regenerating downstream artifacts'}
                    </p>
                    <p className="text-[11px] text-neutral-600 mt-0.5">
                        {rollup.totalImpactedScreens === 1
                            ? '1 screen may affect downstream artifacts (mockups, data model, implementation plan).'
                            : `${rollup.totalImpactedScreens} screens may affect downstream artifacts (mockups, data model, implementation plan).`}
                    </p>
                    {rollup.recommendedNextActions.length > 0 && (
                        <ul className="mt-1.5 space-y-0.5 text-[11px] text-neutral-600">
                            {rollup.recommendedNextActions.slice(0, 3).map((a, i) => (
                                <li key={i} className="flex gap-1.5">
                                    <span className="text-neutral-400 select-none">·</span>
                                    <span>{a}</span>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            </div>
        </div>
    );
}

/** Phase 4A: the review & approval rollup + implementation-readiness gate. A
 * readiness signal, never a hard lock — the UI stays fully usable either way. */
function ReviewReadinessSection({ review }: { review: ScreenArtifactReviewReadiness }) {
    return (
        <div className="mt-4 pt-4 border-t border-neutral-100">
            <div className="flex items-center gap-1.5 mb-2">
                <ClipboardCheck size={13} className="text-neutral-400" aria-hidden />
                <h4 className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">Review readiness</h4>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-600">
                <span>{review.totalScreens} {review.totalScreens === 1 ? 'screen' : 'screens'} total</span>
                <span className="text-sky-700">{review.accepted + review.implementationReady} confirmed</span>
                <span className="text-amber-700">{review.needsReview + review.draft} need review</span>
                {review.blockers > 0 && (
                    <span className="text-red-700">{review.blockers} {review.blockers === 1 ? 'blocker' : 'blockers'}</span>
                )}
                {review.reviewItems > 0 && (
                    <span className="text-amber-700">{review.reviewItems} review {review.reviewItems === 1 ? 'item' : 'items'}</span>
                )}
            </div>

            <div className={`mt-3 rounded-lg border p-3 flex items-start gap-2 ${
                review.ready ? 'border-emerald-200 bg-emerald-50/60' : 'border-amber-200 bg-amber-50/60'
            }`}>
                {review.ready
                    ? <CheckCircle2 size={15} className="text-emerald-600 mt-0.5 shrink-0" aria-hidden />
                    : <AlertTriangle size={15} className="text-amber-600 mt-0.5 shrink-0" aria-hidden />}
                <div className="min-w-0">
                    <p className={`text-xs font-medium ${review.ready ? 'text-emerald-800' : 'text-amber-800'}`}>
                        {review.ready ? 'Ready for implementation planning' : 'Not ready for implementation planning yet'}
                    </p>
                    <p className="text-[11px] text-neutral-600 mt-0.5">{review.message}</p>
                    {!review.ready && review.reasons.length > 0 && (
                        <ul className="mt-1.5 space-y-0.5 text-[11px] text-amber-700">
                            {review.reasons.map((r, i) => (
                                <li key={i} className="flex gap-1.5">
                                    <span className="text-amber-400 select-none">·</span>
                                    <span>{r}</span>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            </div>
        </div>
    );
}
