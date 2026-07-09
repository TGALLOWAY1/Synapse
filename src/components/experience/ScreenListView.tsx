// Canonical screen list for the Experience workspace — redesigned "flow-first".
//
// Read-only: every row is derived from the screen_inventory artifact via the
// pure join layer (src/lib/screenExperience.ts), the flow-view helpers
// (src/lib/screenFlowView.ts), and the derived readiness / review / handoff /
// downstream layers. Nothing here writes to the store.
//
// The information architecture leads with the product experience — what screens
// exist, how they connect, and which flow they belong to — and keeps
// implementation, traceability, readiness, and review data available but
// visually secondary (a per-card "Details" disclosure + a collapsed
// project-metadata section). A single compact control row replaces the old
// 14-chip filter explosion.

import {
    AlertTriangle, ArrowRight, ChevronDown, ChevronRight, Image as ImageIcon,
    Layers, Search, SlidersHorizontal, Workflow, X,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import type { DataModelContent, Feature, MockupPlatform, StructuredImplementationPlan } from '../../types';
import type { ScreenExperienceIndex, ScreenExperienceItem } from '../../lib/screenExperience';
import {
    screenMatchesFilter,
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
import {
    buildScreenGroups, deriveScreenConnections, flowFilterOptions, hasFlowGrouping,
    type ScreenGroupMode,
} from '../../lib/screenFlowView';
import type { VariantTrustContext } from '../../lib/mockupVariantTrust';
import { PRIORITY_STYLES, stylablePriority } from '../renderers/screenPriority';
import type { ScreensHandoffExportManifestInput } from '../../lib/screenHandoffExport';
import { ScreenCoveragePanel } from './ScreenCoveragePanel';
import { ScreenPreflightPanel } from './ScreenPreflightPanel';
import { ScreensHandoffExportPanel } from './ScreensHandoffExportPanel';
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
    /** Phase 5B: resolved Data Model content for handoff trace correlation. */
    traceDataModel?: DataModelContent | null;
    /** Phase 5B: resolved Implementation Plan content for handoff trace correlation. */
    tracePlan?: StructuredImplementationPlan | null;
    /** Phase 5C: project name for the export package title / filename. */
    projectName?: string;
    /** Phase 5C: manifest source ids + artifact presence for the export bundle. */
    exportManifest?: ScreensHandoffExportManifestInput;
    /** Opens the Screen Detail view — keyed by the stable canonical id. */
    onSelectScreen: (screenId: string) => void;
    /**
     * Opens the confirmed "Generate remaining mockups" flow. Absent (no mockup
     * artifact yet / unparseable payload) the button is hidden. Nothing is
     * generated without this explicit confirmation.
     */
    onGenerateMissingMockups?: () => void;
}

type PriorityFilter = 'all' | 'P0' | 'P1' | 'P2' | 'P3';
type StatusFilter = 'all' | 'draft' | 'needs_review' | 'accepted' | 'ready';
type SortMode = 'group' | 'priority' | 'name' | 'readiness';

/** Advanced (power-user) filters — the long tail that used to be top-level chips. */
const ADVANCED_FILTERS: Array<{ id: ScreenListFilter; label: string }> = [
    { id: 'has_blockers', label: 'Has blockers' },
    { id: 'review_recommended', label: 'Review recommended' },
    { id: 'outdated_review', label: 'Outdated review' },
    { id: 'downstream_review', label: 'Downstream review' },
    { id: 'handoff_ready', label: 'Handoff ready' },
    { id: 'handoff_blocked', label: 'Handoff blocked' },
    { id: 'missing_mockups', label: 'Missing mockups' },
    { id: 'has_risks', label: 'Has risks' },
];

const READINESS_RANK: Record<ScreenReadiness['status'], number> = {
    implementation_ready: 0, accepted: 1, needs_review: 2, draft: 3,
};
const PRIORITY_RANK: Record<string, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };

export function ScreenListView({
    index, readiness, reviewModels = EMPTY_REVIEW_MODELS, artifactReview, coverage,
    variantCoverage, mockupPlatform, mobileRelevant,
    generatedVariantsByScreen, trustContext, features, traceDataModel, tracePlan,
    projectName, exportManifest,
    onSelectScreen, onGenerateMissingMockups,
}: Props) {
    const flowsAvailable = useMemo(() => hasFlowGrouping(index), [index]);
    const [search, setSearch] = useState('');
    const [priority, setPriority] = useState<PriorityFilter>('all');
    const [flow, setFlow] = useState<string>('all');
    const [status, setStatus] = useState<StatusFilter>('all');
    const [sort, setSort] = useState<SortMode>('group');
    const [group, setGroup] = useState<ScreenGroupMode>(flowsAvailable ? 'flow' : 'section');
    const [advanced, setAdvanced] = useState<ReadonlySet<ScreenListFilter>>(() => new Set());
    const [advancedOpen, setAdvancedOpen] = useState(false);
    const [metadataOpen, setMetadataOpen] = useState(false);

    // Phase 4B: downstream impact analysis — per-screen impacts (detail chips +
    // filters), the artifact-level rollup, and the implementation preflight.
    const downstream = useMemo(
        () => analyzeScreensDownstream(index, reviewModels, artifactReview),
        [index, reviewModels, artifactReview],
    );
    const downstreamByScreen = downstream.impactsByScreen;

    // Phase 5A: per-screen implementation handoff packages.
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
                dataModel: traceDataModel, implementationPlan: tracePlan,
            }));
        }
        return map;
    }, [index, reviewModels, downstreamByScreen, mockupPlatform, mobileRelevant, generatedVariantsByScreen, trustContext, features, traceDataModel, tracePlan]);

    const p0Ids = useMemo(
        () => new Set(index.items.filter(i => i.screen.priority === 'P0' || i.screen.priority === 'core').map(i => i.id)),
        [index],
    );
    const handoffRollup = useMemo(
        () => buildScreensHandoffRollup([...handoffByScreen.values()], p0Ids),
        [handoffByScreen, p0Ids],
    );
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

    const flowOptions = useMemo(() => flowFilterOptions(index), [index]);

    // Combined predicate over the compact controls: search ∧ priority ∧ flow ∧
    // status ∧ every active advanced filter.
    const matches = (item: ScreenExperienceItem): boolean => {
        if (search.trim()) {
            const needle = search.trim().toLowerCase();
            const haystack = `${item.screen.name} ${item.screen.purpose ?? ''} ${item.relatedFlows.map(r => r.flow.title).join(' ')}`.toLowerCase();
            if (!haystack.includes(needle)) return false;
        }
        if (priority !== 'all' && stylablePriority(item.screen.priority) !== priority) return false;
        if (flow !== 'all' && !item.relatedFlows.some(r => r.flow.title === flow)) return false;
        const review = filterReviewFor(item);
        const rd = readiness.get(item.id);
        if (status !== 'all' && !screenMatchesFilter(item, rd, status, review)) return false;
        for (const adv of advanced) {
            if (!screenMatchesFilter(item, rd, adv, review)) return false;
        }
        return true;
    };

    const sortItems = (items: readonly ScreenExperienceItem[]): ScreenExperienceItem[] => {
        if (sort === 'group') return [...items];
        const copy = [...items];
        copy.sort((a, b) => {
            if (sort === 'name') return a.screen.name.localeCompare(b.screen.name);
            if (sort === 'priority') {
                return (PRIORITY_RANK[stylablePriority(a.screen.priority)] ?? 9)
                    - (PRIORITY_RANK[stylablePriority(b.screen.priority)] ?? 9);
            }
            // readiness
            const ra = readiness.get(a.id)?.status ?? 'draft';
            const rb = readiness.get(b.id)?.status ?? 'draft';
            return READINESS_RANK[ra] - READINESS_RANK[rb];
        });
        return copy;
    };

    const groups = useMemo(() => buildScreenGroups(index, group), [index, group]);

    const filteredGroups = groups
        .map(g => ({ ...g, items: sortItems(g.items.filter(matches)) }))
        .filter(g => g.items.length > 0);

    const totalMatches = filteredGroups.reduce((sum, g) => sum + g.items.length, 0);
    const advancedCount = advanced.size;
    const anyFilterActive = Boolean(search.trim()) || priority !== 'all' || flow !== 'all'
        || status !== 'all' || advancedCount > 0;

    const toggleAdvanced = (id: ScreenListFilter) => {
        setAdvanced(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    };
    const clearFilters = () => {
        setSearch(''); setPriority('all'); setFlow('all'); setStatus('all');
        setAdvanced(new Set());
    };

    if (index.items.length === 0) {
        return (
            <div className="max-w-xl mx-auto bg-white rounded-xl border border-dashed border-neutral-300 p-10 text-center">
                <div className="w-12 h-12 rounded-full bg-indigo-50 flex items-center justify-center mx-auto mb-3">
                    <Layers size={20} className="text-indigo-500" />
                </div>
                <h3 className="text-sm font-semibold text-neutral-800">No screens yet</h3>
                <p className="text-xs text-neutral-500 mt-1">
                    Generate a Screen Inventory to see screens.
                </p>
            </div>
        );
    }

    return (
        <div className="max-w-3xl xl:max-w-5xl mx-auto space-y-5">
            {/* Compact control row — replaces the old 14-chip filter explosion. */}
            <div className="bg-white rounded-xl border border-neutral-200 p-3 space-y-3 sticky top-0 z-10">
                <div className="flex flex-wrap items-center gap-2">
                    <label className="relative flex-1 min-w-[10rem]">
                        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400" aria-hidden />
                        <input
                            type="search"
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                            placeholder="Search screens…"
                            aria-label="Search screens"
                            className="w-full pl-8 pr-2 py-1.5 text-sm rounded-lg border border-neutral-200 focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-300"
                        />
                    </label>
                    <SelectControl label="Priority" value={priority} onChange={v => setPriority(v as PriorityFilter)}
                        options={[
                            { value: 'all', label: 'All priorities' },
                            { value: 'P0', label: 'P0' }, { value: 'P1', label: 'P1' },
                            { value: 'P2', label: 'P2' }, { value: 'P3', label: 'P3' },
                        ]} />
                    <SelectControl label="Flow" value={flow} onChange={setFlow}
                        options={[
                            { value: 'all', label: 'All flows' },
                            ...flowOptions.map(f => ({ value: f, label: f })),
                        ]} />
                    <SelectControl label="Status" value={status} onChange={v => setStatus(v as StatusFilter)}
                        options={[
                            { value: 'all', label: 'Any status' },
                            { value: 'draft', label: 'Draft' },
                            { value: 'needs_review', label: 'Needs review' },
                            { value: 'accepted', label: 'Accepted' },
                            { value: 'ready', label: 'Ready' },
                        ]} />
                    <SelectControl label="Sort" value={sort} onChange={v => setSort(v as SortMode)}
                        options={[
                            { value: 'group', label: 'Flow order' },
                            { value: 'priority', label: 'Priority' },
                            { value: 'name', label: 'Name' },
                            { value: 'readiness', label: 'Readiness' },
                        ]} />
                    <SelectControl label="Group" value={group} onChange={v => setGroup(v as ScreenGroupMode)}
                        options={[
                            ...(flowsAvailable ? [{ value: 'flow', label: 'By flow' }] : []),
                            { value: 'section', label: 'By section' },
                            { value: 'priority', label: 'By priority' },
                        ]} />
                    <button
                        type="button"
                        onClick={() => setAdvancedOpen(o => !o)}
                        aria-expanded={advancedOpen}
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition ${
                            advancedCount > 0
                                ? 'border-indigo-300 text-indigo-700 bg-indigo-50'
                                : 'border-neutral-200 text-neutral-600 hover:border-indigo-300 hover:text-indigo-700'
                        }`}
                    >
                        <SlidersHorizontal size={13} aria-hidden />
                        Advanced
                        {advancedCount > 0 && (
                            <span className="tabular-nums bg-indigo-600 text-white rounded-full px-1.5">{advancedCount}</span>
                        )}
                    </button>
                </div>

                {advancedOpen && (
                    <div className="flex flex-wrap items-center gap-1.5 border-t border-neutral-100 pt-2.5">
                        <span className="text-[11px] uppercase tracking-wide text-neutral-400 mr-1">Advanced filters</span>
                        {ADVANCED_FILTERS.map(f => {
                            const active = advanced.has(f.id);
                            return (
                                <button
                                    key={f.id}
                                    type="button"
                                    aria-pressed={active}
                                    onClick={() => toggleAdvanced(f.id)}
                                    className={`px-2.5 py-1 rounded-full text-xs font-medium transition ${
                                        active
                                            ? 'bg-indigo-600 text-white'
                                            : 'bg-white text-neutral-600 ring-1 ring-neutral-200 hover:ring-indigo-300 hover:text-indigo-700'
                                    }`}
                                >
                                    {f.label}
                                </button>
                            );
                        })}
                    </div>
                )}

                <div className="flex items-center gap-2 text-[11px] text-neutral-400">
                    <span className="tabular-nums">{totalMatches} of {index.items.length} screens</span>
                    {anyFilterActive && (
                        <button
                            type="button"
                            onClick={clearFilters}
                            className="inline-flex items-center gap-1 text-indigo-600 hover:text-indigo-800"
                        >
                            <X size={11} aria-hidden /> Clear filters
                        </button>
                    )}
                </div>
            </div>

            {filteredGroups.length === 0 && (
                <div className="bg-white rounded-xl border border-dashed border-neutral-300 p-8 text-center">
                    <Layers size={18} className="text-neutral-300 mx-auto mb-2" />
                    <p className="text-sm text-neutral-600">
                        No screens match this filter.
                    </p>
                </div>
            )}

            {filteredGroups.map((section) => (
                <section key={section.id}>
                    <header className="mb-2.5 flex items-baseline gap-2">
                        {group === 'flow' && section.id !== '__other__' && (
                            <Workflow size={15} className="text-indigo-400 shrink-0 self-center" aria-hidden />
                        )}
                        <h3 className="text-base font-semibold text-neutral-800">{section.title}</h3>
                        <span className="text-[11px] text-neutral-400">
                            {section.items.length}{filteredGroups.length !== groups.length || totalMatches !== index.items.length ? ' matching' : ''}
                        </span>
                        {section.subtitle && group !== 'flow' && (
                            <span className="text-xs text-neutral-400 truncate">· {section.subtitle}</span>
                        )}
                    </header>
                    <ul className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                        {section.items.map((item, i) => (
                            <li key={item.id}>
                                <ScreenCard
                                    ordinal={sort === 'group' && group === 'flow' && section.id !== '__other__' ? i + 1 : undefined}
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

            {/* Secondary: project readiness & metadata — collapsed by default so
                the screens themselves stay the primary focus. Kept mounted. */}
            <CollapsibleSection
                title="Project readiness & metadata"
                subtitle="Coverage, review readiness, implementation preflight & export"
                open={metadataOpen}
                onToggle={() => setMetadataOpen(o => !o)}
            >
                <div className="space-y-4">
                    <ScreenCoveragePanel
                        summary={coverage}
                        variantCoverage={variantCoverage}
                        artifactReview={artifactReview}
                        downstreamRollup={downstream.rollup}
                        handoffRollup={handoffRollup}
                        onGenerateMissingMockups={onGenerateMissingMockups}
                    />
                    <ScreenPreflightPanel preflight={preflight} />
                    <ScreensHandoffExportPanel
                        input={{
                            projectName,
                            handoffs: [...handoffByScreen.values()],
                            reviewModels,
                            preflight,
                            handoffRollup,
                            p0Ids,
                            manifest: exportManifest,
                        }}
                    />
                </div>
            </CollapsibleSection>
        </div>
    );
}

// --- Compact select control ---------------------------------------------------

function SelectControl({
    label, value, onChange, options,
}: {
    label: string;
    value: string;
    onChange: (value: string) => void;
    options: Array<{ value: string; label: string }>;
}) {
    return (
        <label className="inline-flex items-center gap-1 text-xs text-neutral-500">
            <span className="sr-only">{label}</span>
            <select
                value={value}
                onChange={e => onChange(e.target.value)}
                aria-label={label}
                className="py-1.5 pl-2 pr-6 rounded-lg border border-neutral-200 text-neutral-700 bg-white text-xs focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-300"
            >
                {options.map(o => (
                    <option key={o.value} value={o.value}>{label}: {o.label}</option>
                ))}
            </select>
        </label>
    );
}

// --- Collapsible metadata section --------------------------------------------

function CollapsibleSection({
    title, subtitle, open, onToggle, children,
}: {
    title: string;
    subtitle?: string;
    open: boolean;
    onToggle: () => void;
    children: React.ReactNode;
}) {
    return (
        <section className="bg-white rounded-xl border border-neutral-200">
            <button
                type="button"
                onClick={onToggle}
                aria-expanded={open}
                className="w-full flex items-center gap-3 px-4 py-3 text-left"
            >
                <ChevronDown
                    size={16}
                    className={`text-neutral-400 transition-transform ${open ? '' : '-rotate-90'}`}
                    aria-hidden
                />
                <span className="flex-1 min-w-0">
                    <span className="block text-sm font-semibold text-neutral-800">{title}</span>
                    {subtitle && <span className="block text-xs text-neutral-400 truncate">{subtitle}</span>}
                </span>
            </button>
            {/* Kept mounted (hidden, not unmounted) so panel state survives a
                collapse and derived content is always present. */}
            <div className={open ? 'px-4 pb-4' : 'hidden'}>{children}</div>
        </section>
    );
}

// --- Screen card -------------------------------------------------------------

const SYSTEM_READINESS_TONE: Record<ScreenReviewModel['systemReadiness'], string> = {
    ready: 'text-emerald-600',
    needs_review: 'text-amber-600',
    blocked: 'text-red-600',
};

function ScreenCard({
    ordinal, item, readiness, reviewModel, downstreamImpact, handoff, mockupPlatform, mobileRelevant, generatedVariants, trustContext, onSelect,
}: {
    ordinal?: number;
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
    const [detailsOpen, setDetailsOpen] = useState(false);
    const { screen } = item;
    const priority = stylablePriority(screen.priority);
    const connections = deriveScreenConnections(item);
    const variants = buildScreenMockupVariants(item, {
        platform: mockupPlatform, mobileRelevant, generatedVariants, trustContext,
    });
    const variantSummary = summarizeScreenVariants(variants);

    // A single, muted status indicator (readiness) is the only secondary signal
    // shown by default — the badge already distinguishes derived vs. user-set.
    // Everything else lives behind "Details".
    return (
        <div className="h-full bg-white rounded-lg border border-neutral-200 hover:border-indigo-300 hover:shadow-sm transition flex flex-col">
            <button
                type="button"
                onClick={onSelect}
                className="w-full text-left p-4 flex flex-col gap-2.5 group flex-1"
            >
                <div className="flex items-start gap-2.5">
                    {ordinal !== undefined && (
                        <span className="shrink-0 mt-0.5 w-5 h-5 rounded-full bg-neutral-100 text-neutral-500 text-[11px] font-semibold flex items-center justify-center tabular-nums">
                            {ordinal}
                        </span>
                    )}
                    <div className="flex-1 min-w-0">
                        <h4 className="font-semibold text-neutral-800 text-sm leading-tight group-hover:text-indigo-700 transition-colors">
                            {screen.name}
                        </h4>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                        {item.isEdited && (
                            <span className="text-[10px] uppercase tracking-wide text-neutral-500 bg-neutral-100 px-1.5 py-0.5 rounded">
                                Edited
                            </span>
                        )}
                        <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${PRIORITY_STYLES[priority]}`}>
                            {priority}
                        </span>
                    </div>
                </div>

                {screen.purpose && (
                    <p className="text-xs leading-relaxed text-neutral-600 line-clamp-2">
                        {screen.purpose}
                    </p>
                )}

                {/* Flow connection — the hero. Names, not counts. */}
                <FlowStrip name={screen.name} connections={connections} />

                {/* One-line, low-color footer: mockup availability + readiness. */}
                <div className="mt-auto pt-2 flex items-center gap-3 flex-wrap text-[11px] text-neutral-500">
                    <span className="inline-flex items-center gap-1" title="Mockup availability for this screen">
                        <ImageIcon size={12} className={variantSummary.hasMockup ? 'text-emerald-500' : 'text-neutral-300'} />
                        {variantSummary.hasMockup ? 'Mockup ready' : 'No mockup'}
                    </span>
                    {readiness && <ReadinessBadge readiness={readiness} />}
                    <ChevronRight size={13} className="ml-auto text-neutral-300 group-hover:text-indigo-400 transition-colors" aria-hidden />
                </div>
            </button>

            {/* Progressive disclosure — implementation / traceability / review /
                risk / handoff / downstream, none of it competing by default. */}
            <div className="px-4 pb-3">
                <button
                    type="button"
                    onClick={() => setDetailsOpen(o => !o)}
                    aria-expanded={detailsOpen}
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-neutral-500 hover:text-indigo-600 transition"
                >
                    <ChevronDown size={12} className={`transition-transform ${detailsOpen ? '' : '-rotate-90'}`} aria-hidden />
                    {detailsOpen ? 'Hide details' : 'Show details'}
                </button>
                {detailsOpen && (
                    <CardDetails
                        item={item}
                        connections={connections}
                        reviewModel={reviewModel}
                        downstreamImpact={downstreamImpact}
                        handoff={handoff}
                        variantSummary={variantSummary}
                    />
                )}
            </div>
        </div>
    );
}

/** The mini flow visualization: This screen → next screens (by exit-path
 * target). Falls back to the flow it belongs to when there are no exit paths. */
function FlowStrip({ name, connections }: { name: string; connections: ReturnType<typeof deriveScreenConnections> }) {
    if (connections.outgoing.length > 0) {
        return (
            <div className="flex items-center gap-1.5 flex-wrap text-[11px]" title={`${name} leads to ${connections.outgoing.join(', ')}`}>
                <span className="text-[10px] uppercase tracking-wide text-neutral-400">Next</span>
                {connections.outgoing.slice(0, 3).map((target, i) => (
                    <span key={i} className="inline-flex items-center gap-1 text-neutral-600">
                        <ArrowRight size={11} className="text-neutral-300" aria-hidden />
                        <span className="max-w-[8rem] truncate">{target}</span>
                    </span>
                ))}
                {connections.outgoing.length > 3 && (
                    <span className="text-neutral-400">+{connections.outgoing.length - 3}</span>
                )}
            </div>
        );
    }
    if (connections.flowTitles.length > 0) {
        return (
            <div className="flex items-center gap-1.5 text-[11px] text-neutral-500">
                <Workflow size={11} className="text-indigo-300" aria-hidden />
                <span className="text-neutral-400">Part of</span>
                <span className="font-medium text-neutral-600 truncate" title={connections.flowTitles.join(', ')}>
                    {connections.flowTitles.join(', ')}
                </span>
            </div>
        );
    }
    return (
        <div className="text-[11px] text-neutral-400">Not yet connected to a flow</div>
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

/** Secondary metadata, revealed on demand. Neutral typography with warning
 * color reserved for genuine issues (blockers, risks, stale/blocked states). */
function CardDetails({
    item, connections, reviewModel, downstreamImpact, handoff, variantSummary,
}: {
    item: ScreenExperienceItem;
    connections: ReturnType<typeof deriveScreenConnections>;
    reviewModel?: ScreenReviewModel;
    downstreamImpact?: ScreenDownstreamImpact;
    handoff?: ScreenImplementationHandoff;
    variantSummary: ReturnType<typeof summarizeScreenVariants>;
}) {
    const { screen } = item;
    const featureRefs = screen.featureRefs ?? [];
    const riskCount = screen.risks?.length ?? 0;
    const stateCount = screen.states?.length ?? 0;
    const downstreamActionable = downstreamImpact?.impactedArtifacts.filter(a => a.severity !== 'info') ?? [];

    return (
        <dl className="mt-2.5 pt-2.5 border-t border-neutral-100 space-y-2 text-[11px]">
            {/* Connections */}
            {(connections.incoming.length > 0 || connections.outgoing.length > 0) && (
                <DetailRow label="Connected to">
                    {connections.outgoing.length > 0 ? connections.outgoing.join(', ') : '—'}
                    {connections.incoming.length > 0 && (
                        <span className="block text-neutral-400 mt-0.5">
                            Reached from: {connections.incoming.join(', ')}
                        </span>
                    )}
                </DetailRow>
            )}

            {/* Review */}
            {reviewModel && (
                <DetailRow label="Review">
                    <span className="text-neutral-700">
                        {reviewModel.userStatus ? REVIEW_STATUS_LABELS[reviewModel.userStatus] : 'Not reviewed'}
                    </span>
                    <span className="text-neutral-300 mx-1" aria-hidden>·</span>
                    <span className={SYSTEM_READINESS_TONE[reviewModel.systemReadiness]}>
                        {reviewModel.blockingCount > 0
                            ? `${reviewModel.blockingCount} ${reviewModel.blockingCount === 1 ? 'blocker' : 'blockers'}`
                            : reviewModel.reviewCount > 0
                                ? `${reviewModel.reviewCount} review ${reviewModel.reviewCount === 1 ? 'item' : 'items'}`
                                : SYSTEM_READINESS_LABELS[reviewModel.systemReadiness]}
                    </span>
                    {reviewModel.freshness === 'outdated' && (
                        <span className="block text-amber-600 mt-0.5">Review may be outdated — the screen changed after sign-off.</span>
                    )}
                </DetailRow>
            )}

            {/* Traceability */}
            <DetailRow label="Traceability">
                {featureRefs.length > 0
                    ? `Covers ${featureRefs.length} PRD ${featureRefs.length === 1 ? 'feature' : 'features'}: ${featureRefs.join(', ')}`
                    : <span className="text-neutral-400">No linked PRD features — review recommended</span>}
            </DetailRow>

            {/* Implementation / handoff */}
            {handoff && (
                <DetailRow label="Handoff">
                    <span className={
                        handoff.readiness.status === 'blocked' ? 'text-red-600'
                            : handoff.readiness.status === 'review_recommended' ? 'text-amber-600'
                                : 'text-emerald-600'
                    }>
                        {HANDOFF_STATUS_LABELS[handoff.readiness.status]}
                    </span>
                    {handoff.traceBridge && (handoff.traceBridge.implementationPlan.confidence === 'missing'
                        || ['weak', 'estimated', 'missing'].includes(handoff.traceBridge.overall.confidence)) && (
                        <span className="block text-amber-600 mt-0.5">
                            Downstream trace estimated or missing — confirm before building.
                        </span>
                    )}
                </DetailRow>
            )}

            {/* Mockup coverage detail */}
            <DetailRow label="Mockups">
                {variantSummary.hasMockup ? variantSummary.label : 'Not generated yet'}
                {variantSummary.coverageUnknown && (
                    <span className="block text-neutral-400 mt-0.5">Coverage unknown — generated before coverage metadata was captured.</span>
                )}
            </DetailRow>

            {/* States */}
            <DetailRow label="States">
                {stateCount > 0 ? `${stateCount} documented` : <span className="text-neutral-400">None documented</span>}
            </DetailRow>

            {/* Risks */}
            {riskCount > 0 && (
                <DetailRow label="Risks">
                    <span className="inline-flex items-center gap-1 text-amber-700">
                        <AlertTriangle size={10} aria-hidden />
                        {riskCount} to review
                    </span>
                </DetailRow>
            )}

            {/* Downstream impact */}
            {downstreamActionable.length > 0 && (
                <DetailRow label="Downstream">
                    <span className={downstreamImpact?.summary.hasBlockingImpact ? 'text-red-600' : 'text-amber-600'}>
                        {downstreamImpact?.summary.hasBlockingImpact
                            ? 'Implementation not ready'
                            : `Downstream review: ${downstreamActionable.slice(0, 2).map(a => DOWNSTREAM_LABELS[a.kind] ?? a.kind).join(', ')}`}
                    </span>
                </DetailRow>
            )}
        </dl>
    );
}

const HANDOFF_STATUS_LABELS: Record<ScreenImplementationHandoff['readiness']['status'], string> = {
    ready: 'Ready',
    review_recommended: 'Needs review',
    blocked: 'Blocked',
};

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="flex gap-2">
            <dt className="w-20 shrink-0 text-neutral-400 uppercase tracking-wide text-[10px] pt-0.5">{label}</dt>
            <dd className="flex-1 min-w-0 text-neutral-600">{children}</dd>
        </div>
    );
}
