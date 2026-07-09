// Screen Coverage & Readiness — the artifact-level rollup card at the top of
// the Screens list. Replaces the old mockup-only coverage card with a broader
// derived view: PRD feature coverage, flow representation, P0 completeness,
// state documentation, mockups, open risks, and implementation readiness.
// Everything shown here is ESTIMATED from the generated spec (see
// src/lib/screenReadiness.ts) — the copy must keep saying so; never present
// these numbers as a full PRD validation.

import { useState } from 'react';
import {
    AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, Gauge, Image as ImageIcon,
} from 'lucide-react';
import type { ScreenCoverageSummary } from '../../lib/screenReadiness';
import type { MockupVariantCoverageSummary } from '../../lib/mockupVariants';

interface Props {
    summary: ScreenCoverageSummary;
    /** Artifact-level mockup-variant rollup (Phase 3A). Absent/null → the
     * variant rows are hidden (e.g. no screens). */
    variantCoverage?: MockupVariantCoverageSummary | null;
    /** Opens the confirmed "Generate remaining mockups" flow (absent → no
     * mockup artifact yet; the action row is hidden). */
    onGenerateMissingMockups?: () => void;
}

function MetricRow({
    label, value, hint, tone = 'neutral',
}: {
    label: string;
    value: string;
    hint?: string;
    tone?: 'neutral' | 'good' | 'warn';
}) {
    const valueColor = tone === 'good'
        ? 'text-emerald-700'
        : tone === 'warn'
            ? 'text-amber-700'
            : 'text-neutral-800';
    return (
        <div className="flex items-baseline justify-between gap-3 py-1.5" title={hint}>
            <span className="text-xs text-neutral-600">{label}</span>
            <span className={`text-xs font-semibold tabular-nums text-right ${valueColor}`}>{value}</span>
        </div>
    );
}

export function ScreenCoveragePanel({ summary, variantCoverage, onGenerateMissingMockups }: Props) {
    const [showUncovered, setShowUncovered] = useState(false);
    const {
        totalScreens, prdFeatures, stateVariants, flows, p0, states, mockups, openRisks,
        ready, readyWithWarnings, message,
    } = summary;
    if (totalScreens === 0) return null;

    // "All clear" only when every screen is ready AND none of those are
    // user-overridden while derived warnings remain — otherwise the green
    // all-clear treatment would hide unresolved warnings at the artifact level.
    const allReady = ready === totalScreens && readyWithWarnings === 0;
    const missingMockups = mockups.total - mockups.covered;

    return (
        <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
            <div className="flex items-start gap-3">
                <div className={`mt-0.5 h-8 w-8 shrink-0 rounded-lg flex items-center justify-center ${allReady ? 'bg-emerald-50' : 'bg-indigo-50'}`}>
                    <Gauge size={16} className={allReady ? 'text-emerald-600' : 'text-indigo-600'} />
                </div>
                <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2 flex-wrap">
                        <h3 className="text-sm font-semibold text-neutral-900">Screen Coverage &amp; Readiness</h3>
                        <span className="text-[10px] uppercase tracking-wide text-neutral-400">
                            Estimated from the generated spec
                        </span>
                    </div>
                    <p className="mt-1 text-xs leading-relaxed text-neutral-600">{message}</p>

                    <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-x-6 divide-y divide-neutral-100 sm:divide-y-0 text-xs">
                        <div className="divide-y divide-neutral-100">
                            {prdFeatures ? (
                                <MetricRow
                                    label="PRD features linked"
                                    value={`${prdFeatures.covered} / ${prdFeatures.total}`}
                                    hint="PRD features referenced by at least one screen's linked features — estimated from feature ids, not a full PRD validation"
                                    tone={prdFeatures.covered === prdFeatures.total ? 'good' : 'warn'}
                                />
                            ) : (
                                <MetricRow label="PRD features linked" value="No feature list to compare" />
                            )}
                            {flows ? (
                                <MetricRow
                                    label="User flows represented"
                                    value={`${flows.represented} / ${flows.total}`}
                                    hint="User flows with at least one step matched to a screen"
                                    tone={flows.represented === flows.total ? 'good' : 'warn'}
                                />
                            ) : (
                                <MetricRow label="User flows represented" value="No flows generated yet" />
                            )}
                            <MetricRow
                                label="P0 screens with mockups"
                                value={p0.total === 0 ? 'No P0 screens' : `${p0.withMockup} / ${p0.total}`}
                                tone={p0.total > 0 && p0.withMockup < p0.total ? 'warn' : p0.total > 0 ? 'good' : 'neutral'}
                            />
                        </div>
                        <div className="divide-y divide-neutral-100">
                            <MetricRow
                                label="Screens documenting states"
                                value={`${states.screensWithStates} / ${totalScreens}`}
                                hint={states.totalStates > 0
                                    ? `${states.statesWithBehavior} of ${states.totalStates} documented states describe a trigger or behavior`
                                    : undefined}
                                tone={states.screensWithStates < totalScreens ? 'warn' : 'good'}
                            />
                            <MetricRow
                                label="Mockups"
                                value={`${mockups.covered} / ${mockups.total} screens`}
                                tone={missingMockups > 0 ? 'neutral' : 'good'}
                            />
                            {variantCoverage && variantCoverage.recommendedTotal > 0 && (
                                <MetricRow
                                    label="Mockup variants"
                                    value={`${variantCoverage.recommendedGenerated} / ${variantCoverage.recommendedTotal} recommended`}
                                    hint="Recommended viewport × state variants generated or accepted across all screens — tracked from mockup metadata and your marks, never from inspecting images"
                                    tone={variantCoverage.recommendedGenerated < variantCoverage.recommendedTotal ? 'warn' : 'good'}
                                />
                            )}
                            {variantCoverage && variantCoverage.p0Total > 0 && (
                                <MetricRow
                                    label="Mobile coverage (P0)"
                                    value={`${variantCoverage.p0WithMobile} / ${variantCoverage.p0Total} P0 screens`}
                                    hint="P0 screens with a generated or accepted Mobile default variant"
                                    tone={variantCoverage.p0WithMobile < variantCoverage.p0Total ? 'warn' : 'good'}
                                />
                            )}
                            {variantCoverage && variantCoverage.legacyUnknownMockups > 0 && (
                                <MetricRow
                                    label="Legacy mockups (coverage unknown)"
                                    value={`${variantCoverage.legacyUnknownMockups}`}
                                    hint="Mockups generated before coverage metadata was captured — visually useful, but Synapse can't confirm which spec items they represent"
                                    tone="neutral"
                                />
                            )}
                            {stateVariants && (
                                <MetricRow
                                    label="Recommended state variants"
                                    value={`${stateVariants.covered} / ${stateVariants.required}`}
                                    hint="State mockup variants the generated spec recommends — tracked from mockup metadata and your accepted/not-needed marks, never from inspecting images"
                                    tone={stateVariants.covered < stateVariants.required ? 'warn' : 'good'}
                                />
                            )}
                            <MetricRow
                                label="Open risks"
                                value={openRisks === 0 ? 'None noted' : `${openRisks} to review`}
                                hint="Risk notes in the spec have no recorded handling yet — review them per screen"
                                tone={openRisks > 0 ? 'warn' : 'good'}
                            />
                            <MetricRow
                                label="Ready for implementation"
                                value={`${ready} / ${totalScreens} screens`}
                                tone={allReady ? 'good' : 'neutral'}
                            />
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
                    {allReady && (
                        <p className="mt-3 inline-flex items-center gap-1.5 text-[11px] text-emerald-700">
                            <CheckCircle2 size={12} /> Derived checks pass — statuses are estimates, so give screens a final review.
                        </p>
                    )}
                </div>
            </div>
        </div>
    );
}
