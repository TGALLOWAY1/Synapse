// Canonical screen list for the Experience workspace. Read-only: every row is
// derived from the screen_inventory artifact via the pure join layer
// (src/lib/screenExperience.ts) plus the derived readiness layer
// (src/lib/screenReadiness.ts) — nothing here writes to the store. Rows show
// what the other experience artifacts say about each screen (flow refs,
// mockup coverage), the derived/user-set review status, and click through to
// the Screen Detail view. The Screen Coverage & Readiness panel at the top
// replaces the old mockup-only coverage card.

import { AlertTriangle, AppWindow, ChevronRight, Image as ImageIcon, Layers, Workflow } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { Feature, MockupPlatform } from '../../types';
import type { ScreenExperienceIndex, ScreenExperienceItem } from '../../lib/screenExperience';
import {
    SCREEN_LIST_FILTERS, screenMatchesFilter,
    type ScreenCoverageSummary, type ScreenFilterReview, type ScreenListFilter, type ScreenReadiness,
} from '../../lib/screenReadiness';
import {
    REVIEW_STATUS_LABELS, SYSTEM_READINESS_LABELS,
    type ScreenArtifactReviewReadiness, type ScreenReviewModel,
} from '../../lib/screenReviewWorkflow';
import {
    analyzeScreensDownstream, buildScreensPreflight,
    type ScreenDownstreamImpact,
} from '../../lib/screenDownstreamImpact';
import {
    buildScreenImplementationHandoff, buildScreensHandoffRollup, buildHandoffPreflightContribution,
    type ScreenImplementationHandoff,
} from '../../lib/screenImplementationHandoff';
import {
    buildScreenMockupVariants, summarizeScreenVariants,
    type GeneratedVariantMap, type MockupVariantCoverageSummary,
} from '../../lib/mockupVariants';
import type { VariantTrustContext } from '../../lib/mockupVariantTrust';
import { PRIORITY_STYLES, stylablePriority } from '../renderers/screenPriority';
import { ScreenCoveragePanel } from './ScreenCoveragePanel';
import { ScreenPreflightPanel } from './ScreenPreflightPanel';
import { ReadinessBadge } from './ReadinessBadge';

const EMPTY_REVIEW_MODELS: ReadonlyMap<string, ScreenReviewModel> = new Map();

interface Props {
    index: ScreenExperienceIndex;
    /** Per-screen readiness keyed by canonical id (src/lib/screenReadiness). */
    readiness: ReadonlyMap<string, ScreenReadiness>;
    /** Per-screen review model keyed by canonical id (Phase 4A). Absent → cards
     * fall back to readiness-only, filters treat everything as unreviewed. */
    reviewModels?: ReadonlyMap<string, ScreenReviewModel>;
    /** Artifact-level review readiness gate for the coverage panel (Phase 4A). */
    artifactReview?: ScreenArtifactReviewReadiness;
    /** Artifact-level coverage rollup for the top panel. */
    coverage: ScreenCoverageSummary;
    /** Artifact-level mockup-variant rollup for the coverage panel (Phase 3A). */
    variantCoverage?: MockupVariantCoverageSummary | null;
    /** Generation platform of the mockup set — drives per-screen variant
     * derivation (viewport). */
    mockupPlatform?: MockupPlatform;
    /** True when the project is mobile-relevant (mobile-first / responsive). */
    mobileRelevant?: boolean;
    /** Phase 3B: resolves a screen's manifest-backed generated variants so the
     * card reflects real generation (e.g. "Mobile: generated"). */
    generatedVariantsByScreen?: (screenId: string) => GeneratedVariantMap | undefined;
    /** Phase 3C: current trust context for per-screen variant freshness. */
    trustContext?: VariantTrustContext;
    /** Canonical PRD features — enables handoff/traceability derivation (Phase 5A). */
    features?: readonly Feature[];
    /** Opens the Screen Detail view — keyed by the stable canonical id. */
    onSelectScreen: (screenId: string) => void;
    /**
     * Opens the confirmed "Generate remaining mockups" flow. Absent (no mockup
     * artifact yet / unparseable payload) the button is hidden. Nothing is
     * generated without this explicit confirmation.
     */
    onGenerateMissingMockups?: () => void;
}

export function ScreenListView({
    index, readiness, reviewModels = EMPTY_REVIEW_MODELS, artifactReview, coverage,
    variantCoverage, mockupPlatform, mobileRelevant,
    generatedVariantsByScreen, trustContext, features, onSelectScreen, onGenerateMissingMockups,
}: Props) {
    const [filter, setFilter] = useState<ScreenListFilter>('all');

    // Phase 4B: downstream impact analysis — per-screen impacts (row chips +
    // filters), the artifact-level rollup, and the implementation preflight.
    // Derived once from the review models; pure & memoized, never persisted.
    const downstream = useMemo(
        () => analyzeScreensDownstream(index, reviewModels, artifactReview),
        [index, reviewModels, artifactReview],
    );
    const downstreamByScreen = downstream.impactsByScreen;

    // Phase 5A: per-screen implementation handoff packages (route/components/
    // state/events/data/mockups/QA/build tasks + readiness). Derived from the
    // review model + variant grid + downstream impact — pure & memoized.
    const handoffByScreen = useMemo(() => {
        const map = new Map<string, ScreenImplementationHandoff>();
        for (const item of index.items) {
            const model = reviewModels.get(item.id);
            if (!model) continue;
            const variants = buildScreenMockupVariants(item, {
                platform: mockupPlatform, mobileRelevant,
                generatedVariants: generatedVariantsByScreen?.(item.id), trustContext,
            });
            map.set(item.id, buildScreenImplementationHandoff({
                item, reviewModel: model, variants,
                downstream: downstreamByScreen.get(item.id), features,
            }));
        }
        return map;
    }, [index, reviewModels, downstreamByScreen, mockupPlatform, mobileRelevant, generatedVariantsByScreen, trustContext, features]);

    const p0Ids = useMemo(
        () => new Set(index.items.filter(i => i.screen.priority === 'P0' || i.screen.priority === 'core').map(i => i.id)),
        [index],
    );
    const handoffRollup = useMemo(
        () => buildScreensHandoffRollup([...handoffByScreen.values()], p0Ids),
        [handoffByScreen, p0Ids],
    );
    // Fold handoff issues into the Phase 4B preflight (handoff contributions are
    // structural — screenDownstreamImpact never imports the handoff module).
    const preflight = useMemo(() => {
        const contribution = buildHandoffPreflightContribution([...handoffByScreen.values()], p0Ids);
        return buildScreensPreflight(downstream.inputs, artifactReview, contribution);
    }, [handoffByScreen, p0Ids, downstream.inputs, artifactReview]);

    const filterReviewFor = (item: ScreenExperienceItem): ScreenFilterReview | undefined => {
        const model = reviewModels.get(item.id);
        if (!model) return undefined;
        const impact = downstreamByScreen.get(item.id);
        return {
            userStatus: model.userStatus,
            blockingCount: model.blockingCount,
            reviewCount: model.reviewCount,
            reviewFreshness: model.freshness,
            downstreamReviewNeeded: impact
                ? impact.summary.hasBlockingImpact || impact.summary.reviewCount > 0
                : false,
            handoffReadiness: handoffByScreen.get(item.id)?.readiness.status,
        };
    };

    // Per-filter match counts so empty filters are obvious before clicking.
    const filterCounts = useMemo(() => {
        const counts = new Map<ScreenListFilter, number>();
        for (const { id } of SCREEN_LIST_FILTERS) {
            counts.set(id, index.items.filter(item =>
                screenMatchesFilter(item, readiness.get(item.id), id, filterReviewFor(item))).length);
        }
        return counts;
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [index, readiness, reviewModels, downstreamByScreen, handoffByScreen]);

    if (index.items.length === 0) {
        return (
            <div className="max-w-xl mx-auto bg-white rounded-xl border border-dashed border-neutral-300 p-10 text-center">
                <div className="w-12 h-12 rounded-full bg-indigo-50 flex items-center justify-center mx-auto mb-3">
                    <AppWindow size={20} className="text-indigo-500" />
                </div>
                <h3 className="text-sm font-semibold text-neutral-800">No screens yet</h3>
                <p className="text-xs text-neutral-500 mt-1">
                    Generate a Screen Inventory to see screens.
                </p>
            </div>
        );
    }

    const filteredSections = index.sections
        .map(section => ({
            ...section,
            items: section.items.filter(item =>
                screenMatchesFilter(item, readiness.get(item.id), filter, filterReviewFor(item))),
        }))
        .filter(section => section.items.length > 0);

    return (
        <div className="max-w-3xl xl:max-w-5xl mx-auto space-y-6">
            <ScreenCoveragePanel
                summary={coverage}
                variantCoverage={variantCoverage}
                artifactReview={artifactReview}
                downstreamRollup={downstream.rollup}
                handoffRollup={handoffRollup}
                onGenerateMissingMockups={onGenerateMissingMockups}
            />

            <ScreenPreflightPanel preflight={preflight} />


            <div className="flex items-center gap-1.5 flex-wrap" role="group" aria-label="Filter screens">
                {SCREEN_LIST_FILTERS.map(f => {
                    const active = f.id === filter;
                    const count = filterCounts.get(f.id) ?? 0;
                    return (
                        <button
                            key={f.id}
                            type="button"
                            aria-pressed={active}
                            onClick={() => setFilter(f.id)}
                            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition ${
                                active
                                    ? 'bg-indigo-600 text-white'
                                    : 'bg-white text-neutral-600 ring-1 ring-neutral-200 hover:ring-indigo-300 hover:text-indigo-700'
                            }`}
                        >
                            {f.label}
                            {f.id !== 'all' && (
                                <span className={`tabular-nums ${active ? 'text-indigo-200' : 'text-neutral-400'}`}>
                                    {count}
                                </span>
                            )}
                        </button>
                    );
                })}
            </div>

            {filteredSections.length === 0 && (
                <div className="bg-white rounded-xl border border-dashed border-neutral-300 p-8 text-center">
                    <Layers size={18} className="text-neutral-300 mx-auto mb-2" />
                    <p className="text-sm text-neutral-600">
                        No screens match this filter.
                    </p>
                </div>
            )}

            {filteredSections.map((section, sectionIdx) => (
                <section key={section.title + sectionIdx}>
                    <header className="mb-3">
                        <h3 className="text-base font-semibold text-neutral-800">
                            {section.title}
                        </h3>
                        {section.description && (
                            <p className="text-xs text-neutral-500 mt-1">{section.description}</p>
                        )}
                        <div className="mt-1 text-[11px] uppercase tracking-wide text-neutral-400">
                            {section.items.length} {section.items.length === 1 ? 'screen' : 'screens'}
                            {filter !== 'all' && ' matching'}
                        </div>
                    </header>
                    <ul className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                        {section.items.map(item => (
                            <li key={item.id}>
                                <ScreenRow
                                    item={item}
                                    readiness={readiness.get(item.id)}
                                    reviewModel={reviewModels.get(item.id)}
                                    downstreamImpact={downstreamByScreen.get(item.id)}
                                    handoff={handoffByScreen.get(item.id)}
                                    mockupPlatform={mockupPlatform}
                                    mobileRelevant={mobileRelevant}
                                    generatedVariants={generatedVariantsByScreen?.(item.id)}
                                    trustContext={trustContext}
                                    onSelect={() => onSelectScreen(item.id)}
                                />
                            </li>
                        ))}
                    </ul>
                </section>
            ))}
        </div>
    );
}

const SYSTEM_READINESS_TONE: Record<ScreenReviewModel['systemReadiness'], string> = {
    ready: 'text-emerald-600',
    needs_review: 'text-amber-600',
    blocked: 'text-red-600',
};

function ScreenRow({
    item, readiness, reviewModel, downstreamImpact, handoff, mockupPlatform, mobileRelevant, generatedVariants, trustContext, onSelect,
}: {
    item: ScreenExperienceItem;
    readiness?: ScreenReadiness;
    reviewModel?: ScreenReviewModel;
    downstreamImpact?: ScreenDownstreamImpact;
    handoff?: ScreenImplementationHandoff;
    mockupPlatform?: MockupPlatform;
    mobileRelevant?: boolean;
    generatedVariants?: GeneratedVariantMap;
    trustContext?: VariantTrustContext;
    onSelect: () => void;
}) {
    const { screen } = item;
    const priority = stylablePriority(screen.priority);
    const flowCount = item.relatedFlows.length;
    const entryCount = screen.entryPoints?.length ?? 0;
    const exitCount = screen.exitPaths?.length ?? 0;
    const stateCount = screen.states?.length ?? 0;
    const riskCount = screen.risks?.length ?? 0;
    const featureRefs = screen.featureRefs ?? [];
    const variants = buildScreenMockupVariants(item, {
        platform: mockupPlatform, mobileRelevant, generatedVariants, trustContext,
    });
    const variantSummary = summarizeScreenVariants(variants);
    // Compact freshness signal — count generated variants worth a review.
    const freshReview = variants.filter(
        v => v.freshness && (v.freshness.status === 'stale' || v.freshness.status === 'possibly_stale'),
    ).length;

    return (
        <button
            type="button"
            onClick={onSelect}
            className="w-full h-full text-left bg-white rounded-lg border border-neutral-200 p-4 hover:border-indigo-300 hover:shadow-sm transition group flex flex-col"
        >
            <div className="flex items-start justify-between gap-2">
                <h4 className="font-semibold text-neutral-800 text-sm leading-tight group-hover:text-indigo-700 transition-colors">
                    {screen.name}
                </h4>
                <div className="flex items-center gap-1.5 shrink-0">
                    {item.isEdited && (
                        <span className="text-[10px] uppercase tracking-wide text-violet-700 bg-violet-50 ring-1 ring-violet-200 px-1.5 py-0.5 rounded">
                            Edited
                        </span>
                    )}
                    {screen.type && screen.type !== 'screen' && (
                        <span className="text-[10px] uppercase tracking-wide text-neutral-500 bg-neutral-100 px-1.5 py-0.5 rounded">
                            {screen.type}
                        </span>
                    )}
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${PRIORITY_STYLES[priority]}`}>
                        {priority}
                    </span>
                </div>
            </div>

            {screen.purpose && (
                <p className="text-xs leading-relaxed text-neutral-600 mt-2 line-clamp-2">
                    {screen.purpose}
                </p>
            )}

            <div className="mt-2.5 flex items-center gap-1.5 flex-wrap">
                {readiness && <ReadinessBadge readiness={readiness} />}
                {featureRefs.length > 0 ? (
                    <span
                        className="text-[10px] text-violet-700 bg-violet-50 ring-1 ring-violet-200 px-1.5 py-0.5 rounded-full"
                        title={`Linked PRD features: ${featureRefs.join(', ')}`}
                    >
                        Covers {featureRefs.length} {featureRefs.length === 1 ? 'feature' : 'features'}
                    </span>
                ) : (
                    <span
                        className="text-[10px] text-neutral-400 bg-neutral-50 ring-1 ring-neutral-200 px-1.5 py-0.5 rounded-full"
                        title="No linked PRD features found — review recommended"
                    >
                        No PRD links
                    </span>
                )}
                {riskCount > 0 && (
                    <span className="inline-flex items-center gap-1 text-[10px] text-amber-700 bg-amber-50 ring-1 ring-amber-200 px-1.5 py-0.5 rounded-full">
                        <AlertTriangle size={9} aria-hidden />
                        {riskCount} {riskCount === 1 ? 'risk' : 'risks'} to review
                    </span>
                )}
                {variantSummary.mobileMissing && (
                    <span
                        className="text-[10px] text-amber-700 bg-amber-50 ring-1 ring-amber-200 px-1.5 py-0.5 rounded-full"
                        title="No mobile mockup variant yet"
                    >
                        Mobile: missing
                    </span>
                )}
                {freshReview > 0 && (
                    <span
                        className="text-[10px] text-amber-700 bg-amber-50 ring-1 ring-amber-200 px-1.5 py-0.5 rounded-full"
                        title="One or more generated mockup variants may be stale — the screen spec, design system, or PRD changed after generation"
                    >
                        Freshness: {freshReview} to review
                    </span>
                )}
                {variantSummary.coverageUnknown && (
                    <span
                        className="text-[10px] text-neutral-500 bg-neutral-50 ring-1 ring-neutral-200 px-1.5 py-0.5 rounded-full"
                        title="This mockup was generated before coverage metadata was captured"
                    >
                        Coverage: unknown
                    </span>
                )}
                {reviewModel?.freshness === 'outdated' && (
                    <span
                        className="text-[10px] text-amber-700 bg-amber-50 ring-1 ring-amber-200 px-1.5 py-0.5 rounded-full"
                        title="This screen changed after it was reviewed — re-review recommended"
                    >
                        Review may be outdated
                    </span>
                )}
                {downstreamImpact && <DownstreamChip impact={downstreamImpact} />}
                {handoff && <HandoffChip status={handoff.readiness.status} />}
            </div>

            {reviewModel && (
                <div className="mt-2 flex items-center gap-2 flex-wrap text-[11px]">
                    <span className="text-neutral-400 uppercase tracking-wide text-[10px]">Review</span>
                    <span className="font-medium text-neutral-700">
                        {reviewModel.userStatus ? REVIEW_STATUS_LABELS[reviewModel.userStatus] : 'Not reviewed'}
                    </span>
                    <span className="text-neutral-300" aria-hidden>·</span>
                    <span className={SYSTEM_READINESS_TONE[reviewModel.systemReadiness]}>
                        {reviewModel.blockingCount > 0
                            ? `${reviewModel.blockingCount} ${reviewModel.blockingCount === 1 ? 'blocker' : 'blockers'}`
                            : reviewModel.reviewCount > 0
                                ? `${reviewModel.reviewCount} review ${reviewModel.reviewCount === 1 ? 'item' : 'items'}`
                                : SYSTEM_READINESS_LABELS[reviewModel.systemReadiness]}
                    </span>
                    {reviewModel.blockingCount > 0 && reviewModel.reviewCount > 0 && (
                        <span className="text-amber-600">
                            + {reviewModel.reviewCount} review {reviewModel.reviewCount === 1 ? 'item' : 'items'}
                        </span>
                    )}
                </div>
            )}

            <div className="mt-auto pt-3 flex items-center gap-3 flex-wrap text-[11px] text-neutral-500">
                <span
                    className="inline-flex items-center gap-1"
                    title="States documented in the spec (empty / loading / error variants)"
                >
                    <Layers size={11} className={stateCount > 0 ? 'text-sky-500' : 'text-neutral-300'} />
                    {stateCount > 0 ? `${stateCount} ${stateCount === 1 ? 'state' : 'states'}` : 'No states'}
                </span>
                <span
                    className="inline-flex items-center gap-1"
                    title="Mockup variant coverage — generated vs. recommended (viewport × state), tracked from mockup metadata"
                >
                    <ImageIcon size={11} className={variantSummary.hasMockup ? 'text-emerald-500' : 'text-neutral-300'} />
                    {variantSummary.hasMockup
                        ? `Mockups: ${variantSummary.label}`
                        : 'No mockup'}
                </span>
                <span
                    className="inline-flex items-center gap-1"
                    title="User-flow steps referencing this screen"
                >
                    <Workflow size={11} className={flowCount > 0 ? 'text-indigo-500' : 'text-neutral-300'} />
                    {flowCount > 0
                        ? `${flowCount} flow ${flowCount === 1 ? 'step' : 'steps'}`
                        : 'No flow refs'}
                </span>
                {(entryCount > 0 || exitCount > 0) && (
                    <span title="Ways users arrive at this screen (incoming) and leave it (outgoing)">
                        {entryCount} incoming · {exitCount} outgoing
                    </span>
                )}
                <ChevronRight size={13} className="ml-auto text-neutral-300 group-hover:text-indigo-400 transition-colors" aria-hidden />
            </div>
        </button>
    );
}

const DOWNSTREAM_LABELS: Record<string, string> = {
    mockups: 'Mockups',
    data_model: 'Data Model',
    implementation_plan: 'Implementation Plan',
    prompt_pack: 'Developer Prompts',
    user_flows: 'User Flows',
    design_system: 'Design System',
    export: 'Export',
};

/** Compact downstream-impact chip — shown only when a change/blocker actually
 * impacts a downstream artifact (info-only impacts show no chip, to avoid
 * cluttering every legacy card). */
function DownstreamChip({ impact }: { impact: ScreenDownstreamImpact }) {
    const actionable = impact.impactedArtifacts.filter(a => a.severity !== 'info');
    if (actionable.length === 0) return null;
    const blocking = impact.summary.hasBlockingImpact;
    const names = actionable.slice(0, 2).map(a => DOWNSTREAM_LABELS[a.kind] ?? a.kind);
    const label = blocking
        ? 'Implementation not ready'
        : `Downstream review: ${names.join(', ')}${actionable.length > names.length ? '…' : ''}`;
    const tone = blocking
        ? 'text-red-700 bg-red-50 ring-red-200'
        : 'text-amber-700 bg-amber-50 ring-amber-200';
    return (
        <span
            className={`text-[10px] px-1.5 py-0.5 rounded-full ring-1 ${tone}`}
            title={blocking
                ? 'This screen has blocking readiness issues — downstream implementation is affected'
                : 'This screen changed or needs review — the named downstream artifacts may be worth re-checking'}
        >
            {label}
        </span>
    );
}

const HANDOFF_CHIP_META: Record<ScreenImplementationHandoff['readiness']['status'], {
    label: string; tone: string; title: string;
}> = {
    ready: {
        label: 'Handoff ready',
        tone: 'text-emerald-700 bg-emerald-50 ring-emerald-200',
        title: 'This screen has an accepted spec and a build-ready handoff package',
    },
    review_recommended: {
        label: 'Handoff needs review',
        tone: 'text-amber-700 bg-amber-50 ring-amber-200',
        title: 'The handoff package is usable but has review items — confirm before building',
    },
    blocked: {
        label: 'Handoff blocked',
        tone: 'text-red-700 bg-red-50 ring-red-200',
        title: 'Resolve the blockers before using this screen as a build source',
    },
};

/** Compact implementation-handoff readiness chip (Phase 5A). */
function HandoffChip({ status }: { status: ScreenImplementationHandoff['readiness']['status'] }) {
    const meta = HANDOFF_CHIP_META[status];
    return (
        <span className={`text-[10px] px-1.5 py-0.5 rounded-full ring-1 ${meta.tone}`} title={meta.title}>
            {meta.label}
        </span>
    );
}
