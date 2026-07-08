// Pure, derived readiness / coverage / traceability layer for the Screens
// experience view. Everything in this module is computed at read time from
// the joined ScreenExperienceIndex (src/lib/screenExperience.ts) plus the
// PRD's canonical feature list — nothing here is persisted, calls an LLM, or
// touches the store. The ONLY persisted input is the optional user-set
// `reviewStatus` riding the existing per-version `metadata.screenEdits`
// overlay (see ScreenMetadataEdit).
//
// Honesty rule: every derived signal is an *estimate* from the generated
// spec (linked features, states, navigation, risks, mockup joins). Consumers
// must label it as such ("estimated", "derived") and must never present a
// derived status as user-confirmed — ScreenReadiness.source distinguishes
// the two.

import type { Feature, ScreenItem, ScreenState } from '../types';
import type { ParsedFlow } from '../components/renderers/userFlows/types';
import type { ScreenExperienceIndex, ScreenExperienceItem } from './screenExperience';

// --- Review status -----------------------------------------------------------

/** Lightweight per-screen review state. Persisted only when user-set (via the
 * screenEdits overlay); otherwise derived from the spec at read time. */
export type ScreenReviewStatus =
    | 'draft'
    | 'needs_review'
    | 'accepted'
    | 'implementation_ready';

export const REVIEW_STATUS_LABELS: Record<ScreenReviewStatus, string> = {
    draft: 'Draft',
    needs_review: 'Needs review',
    accepted: 'Accepted',
    implementation_ready: 'Ready to build',
};

export const VALID_REVIEW_STATUSES: ReadonlySet<string> = new Set([
    'draft', 'needs_review', 'accepted', 'implementation_ready',
]);

// --- Gap detection -----------------------------------------------------------

export type ScreenGapKind =
    | 'missing_purpose'
    | 'missing_traceability'
    | 'missing_navigation'
    | 'missing_states'
    | 'states_without_behavior'
    | 'missing_mockup_p0'
    | 'unresolved_risks'
    | 'no_flow_refs'
    /** User marked the screen accepted/ready while derived warnings remain. */
    | 'accepted_with_warnings';

export interface ScreenGap {
    kind: ScreenGapKind;
    message: string;
}

/** Gap kinds that push a derived status to needs_review (vs merely draft). */
const REVIEW_TRIGGER_GAPS: ReadonlySet<ScreenGapKind> = new Set([
    'unresolved_risks',
    'missing_states',
    'missing_traceability',
    'missing_mockup_p0',
    'states_without_behavior',
]);

export interface ScreenReadiness {
    status: ScreenReviewStatus;
    /** 'user' = explicitly set via the edit overlay; 'derived' = estimated
     * from the spec. UI must say which. */
    source: 'user' | 'derived';
    /** Short human reasons behind a non-ready status (capped). */
    reasons: string[];
    /** Full derived gap list — shown even when a user-set status masks it. */
    gaps: ScreenGap[];
}

interface ReadinessInput {
    screen: ScreenItem;
    hasMockup: boolean;
    flowRefCount: number;
    /** Explicit user-set status from the screenEdits overlay, if any. */
    userStatus?: ScreenReviewStatus;
}

const isP0 = (screen: ScreenItem): boolean =>
    screen.priority === 'P0' || screen.priority === 'core';

function stateHasBehavior(state: ScreenState): boolean {
    return Boolean((state.description && state.description.trim()) || (state.trigger && state.trigger.trim()));
}

/** Derive the gap list for one screen. Pure spec inspection — conservative,
 * never invents severity or intent the data doesn't carry. */
export function detectScreenGaps(input: Omit<ReadinessInput, 'userStatus'>): ScreenGap[] {
    const { screen, hasMockup, flowRefCount } = input;
    const gaps: ScreenGap[] = [];

    if (!screen.purpose || !screen.purpose.trim()) {
        gaps.push({ kind: 'missing_purpose', message: 'No purpose/description recorded.' });
    }
    if (!screen.featureRefs || screen.featureRefs.length === 0) {
        gaps.push({
            kind: 'missing_traceability',
            message: 'No linked PRD features — coverage of this screen is unclear.',
        });
    }
    const hasEntry = (screen.entryPoints?.length ?? 0) > 0;
    const hasExit = (screen.exitPaths?.length ?? 0) > 0;
    if (!hasEntry || !hasExit) {
        gaps.push({
            kind: 'missing_navigation',
            message: !hasEntry && !hasExit
                ? 'Entry and exit navigation not specified.'
                : !hasEntry
                    ? 'Entry navigation not specified.'
                    : 'Exit navigation not specified.',
        });
    }
    const states = screen.states ?? [];
    if (states.length === 0) {
        gaps.push({
            kind: 'missing_states',
            message: 'No UI states documented (empty / loading / error states may be missing).',
        });
    } else {
        const bare = states.filter(s => !stateHasBehavior(s));
        if (bare.length > 0) {
            gaps.push({
                kind: 'states_without_behavior',
                message: bare.length === 1
                    ? `1 state ("${bare[0].name}") has no trigger or behavior described.`
                    : `${bare.length} states have no trigger or behavior described.`,
            });
        }
    }
    if (isP0(screen) && !hasMockup) {
        gaps.push({
            kind: 'missing_mockup_p0',
            message: 'P0 screen without a mockup.',
        });
    }
    const riskCount = screen.risks?.length ?? 0;
    if (riskCount > 0) {
        // The generated spec records risks as plain text with no mitigation or
        // severity fields, so every risk counts as unresolved until reviewed.
        gaps.push({
            kind: 'unresolved_risks',
            message: riskCount === 1
                ? '1 risk noted with no proposed handling recorded.'
                : `${riskCount} risks noted with no proposed handling recorded.`,
        });
    }
    if (flowRefCount === 0) {
        gaps.push({
            kind: 'no_flow_refs',
            message: 'Not referenced by any user flow.',
        });
    }
    return gaps;
}

const MAX_REASONS = 3;

function reasonsFromGaps(gaps: ScreenGap[]): string[] {
    const messages = gaps.map(g => g.message);
    if (messages.length <= MAX_REASONS) return messages;
    return [
        ...messages.slice(0, MAX_REASONS),
        `…and ${messages.length - MAX_REASONS} more.`,
    ];
}

/**
 * Readiness for one screen. A user-set status always wins (source 'user');
 * otherwise the status is derived:
 *   - no gaps at all             → implementation_ready
 *   - any review-trigger gap     → needs_review
 *   - other gaps only            → draft (defined, still being specified)
 */
export function deriveScreenReadiness(input: ReadinessInput): ScreenReadiness {
    const gaps = detectScreenGaps(input);
    if (input.userStatus) {
        const masked = (input.userStatus === 'accepted' || input.userStatus === 'implementation_ready')
            && gaps.some(g => REVIEW_TRIGGER_GAPS.has(g.kind));
        const allGaps = masked
            ? [...gaps, {
                kind: 'accepted_with_warnings' as const,
                message: 'Marked as reviewed while derived warnings remain — double-check the gaps below.',
            }]
            : gaps;
        return {
            status: input.userStatus,
            source: 'user',
            reasons: masked ? ['Marked by you — derived warnings still remain.'] : [],
            gaps: allGaps,
        };
    }
    if (gaps.length === 0) {
        return { status: 'implementation_ready', source: 'derived', reasons: [], gaps };
    }
    const status: ScreenReviewStatus = gaps.some(g => REVIEW_TRIGGER_GAPS.has(g.kind))
        ? 'needs_review'
        : 'draft';
    return { status, source: 'derived', reasons: reasonsFromGaps(gaps), gaps };
}

/** Readiness for every screen in the index, keyed by canonical screen id.
 * The user-set status (when any) rides the item's edit overlay
 * (ScreenMetadataEdit.reviewStatus). */
export function buildReadinessIndex(
    index: ScreenExperienceIndex,
): Map<string, ScreenReadiness> {
    const out = new Map<string, ScreenReadiness>();
    for (const item of index.items) {
        out.set(item.id, deriveScreenReadiness({
            screen: item.screen,
            hasMockup: Boolean(item.mockupScreen),
            flowRefCount: item.relatedFlows.length,
            userStatus: item.edit?.reviewStatus,
        }));
    }
    return out;
}

// --- PRD traceability --------------------------------------------------------

/** Loose feature-id token, e.g. "F1", "f-014", "feat-2". */
const FEATURE_REF_ID_PATTERN = /^(f-?\d+|feat-?\d+)\b\s*[:\-—]?\s*(.*)$/i;

/** Normalize a feature id for matching: lowercase, alphanumerics only
 * (matches the userFlows StepCard convention: "F-1" ≡ "f1"). */
export function normalizeFeatureId(id: string): string {
    return id.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export interface ScreenFeatureLink {
    /** The raw featureRefs string as generated. */
    raw: string;
    /** Parsed feature-id token, when the ref carries one. */
    refId?: string;
    /** The canonical PRD feature this ref resolves to, when it matches. */
    feature?: Feature;
}

export interface ScreenTraceability {
    features: ScreenFeatureLink[];
    /** Titles of the user flows referencing this screen (unique, in order). */
    flows: string[];
    /**
     * 'estimated' — linked feature refs exist (traceability derived from
     * them, not from a full PRD validation); 'missing' — no refs at all.
     */
    completeness: 'estimated' | 'missing';
}

export function buildScreenTraceability(
    item: Pick<ScreenExperienceItem, 'screen' | 'relatedFlows'>,
    features: readonly Feature[] | undefined,
): ScreenTraceability {
    const byNormId = new Map<string, Feature>();
    for (const f of features ?? []) {
        byNormId.set(normalizeFeatureId(f.id), f);
    }
    const links: ScreenFeatureLink[] = (item.screen.featureRefs ?? []).map(raw => {
        const match = raw.trim().match(FEATURE_REF_ID_PATTERN);
        const refId = match ? match[1] : undefined;
        const feature = refId ? byNormId.get(normalizeFeatureId(refId)) : undefined;
        return { raw: raw.trim(), refId, feature };
    });
    const flowTitles: string[] = [];
    const seen = new Set<number>();
    for (const ref of item.relatedFlows) {
        if (seen.has(ref.flowIndex)) continue;
        seen.add(ref.flowIndex);
        flowTitles.push(ref.flow.title);
    }
    return {
        features: links,
        flows: flowTitles,
        completeness: links.length > 0 ? 'estimated' : 'missing',
    };
}

// --- Acceptance criteria (derived) --------------------------------------------

const trimSentence = (text: string): string => text.trim().replace(/\.+$/, '');

const MAX_CRITERIA = 8;

/**
 * Deterministic, conservative acceptance criteria derived from the screen's
 * own spec (intent, exits, states, risks). Nothing is invented — every line
 * restates a fact the spec already carries in checkable form. Consumers must
 * label the list as derived.
 */
export function deriveAcceptanceCriteria(screen: ScreenItem): string[] {
    const out: string[] = [];
    if (screen.userIntent?.trim()) {
        out.push(`The user can accomplish their goal on this screen: ${trimSentence(screen.userIntent)}.`);
    }
    for (const exit of screen.exitPaths ?? []) {
        if (!exit.label?.trim() || !exit.target?.trim()) continue;
        const base = `"${trimSentence(exit.label)}" takes the user to ${trimSentence(exit.target)}`;
        out.push(exit.condition?.trim() ? `${base} when ${trimSentence(exit.condition)}.` : `${base}.`);
    }
    for (const state of screen.states ?? []) {
        if (!state.name?.trim()) continue;
        if (state.trigger?.trim()) {
            out.push(`The "${trimSentence(state.name)}" state appears when ${trimSentence(state.trigger)}.`);
        } else if (state.description?.trim()) {
            out.push(`The "${trimSentence(state.name)}" state is handled: ${trimSentence(state.description)}.`);
        }
    }
    for (const risk of screen.risks ?? []) {
        if (!risk.trim()) continue;
        out.push(`Edge case accounted for: ${trimSentence(risk)}.`);
    }
    // Dedupe while preserving order, then cap so the list stays reviewable.
    const seen = new Set<string>();
    const deduped = out.filter(c => {
        const key = c.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
    return deduped.slice(0, MAX_CRITERIA);
}

// --- Developer handoff (derived) -----------------------------------------------

export interface ScreenHandoff {
    /** Suggested UI regions/components — the spec's own core UI list. */
    components: string[];
    /** UI states the implementation must cover (state names). */
    states: string[];
    /** Interaction events derived from exit paths ("label → target"). */
    events: Array<{ label: string; target: string; condition?: string }>;
    /** Data the screen produces/collects (spec outputData). */
    outputs: string[];
}

/** Lightweight developer-handoff view of the spec. Purely a re-projection of
 * existing fields — no route, prop, or accessibility data exists in the
 * generated spec, so none is fabricated here; the UI shows "Not specified". */
export function buildScreenHandoff(screen: ScreenItem): ScreenHandoff {
    const components = (screen.coreUIElements && screen.coreUIElements.length > 0
        ? screen.coreUIElements
        : screen.components ?? []).filter(c => c.trim());
    return {
        components,
        states: (screen.states ?? []).map(s => s.name).filter(n => Boolean(n?.trim())),
        events: (screen.exitPaths ?? [])
            .filter(e => e.label?.trim() && e.target?.trim())
            .map(e => ({ label: e.label.trim(), target: e.target.trim(), condition: e.condition?.trim() || undefined })),
        outputs: (screen.outputData ?? []).filter(o => o.trim()),
    };
}

// --- Artifact-level coverage summary --------------------------------------------

export interface ScreenCoverageSummary {
    totalScreens: number;
    /** PRD features covered by ≥1 screen's featureRefs. Null when the PRD has
     * no feature list to compare against. Estimated — say so in the UI. */
    prdFeatures: { covered: number; total: number; uncovered: Array<{ id: string; name: string }> } | null;
    /** User flows with ≥1 step matched to a screen. Null when no flows
     * artifact exists (distinct from "flows exist but none matched"). */
    flows: { represented: number; total: number } | null;
    p0: { total: number; withMockup: number };
    states: { screensWithStates: number; totalStates: number; statesWithBehavior: number };
    mockups: { covered: number; total: number };
    /** Total risk entries across all screens (all unresolved — see gaps). */
    openRisks: number;
    /** Screens whose (user-set or derived) status is implementation_ready. */
    ready: number;
    /** Subset of `ready` that was user-overridden while derived review-trigger
     * warnings remain (accepted_with_warnings) — these must never let the
     * rollup claim the derived checks pass. */
    readyWithWarnings: number;
    needsReview: number;
    /** One friendly, deterministic readiness sentence for the panel. */
    message: string;
}

const GAP_KIND_SHORT: Partial<Record<ScreenGapKind, string>> = {
    unresolved_risks: 'unresolved risks',
    missing_states: 'missing states',
    missing_traceability: 'missing PRD links',
    missing_mockup_p0: 'P0 screens without mockups',
    states_without_behavior: 'states without behavior',
};

function buildMessage(
    total: number,
    ready: number,
    readyWithWarnings: number,
    needsReview: number,
    topGapKinds: ScreenGapKind[],
): string {
    if (total === 0) return 'No screens yet.';
    // "Ready" alone isn't clean if a user marked a screen ready over unresolved
    // derived warnings — those must still be surfaced, never hidden behind an
    // all-clear message.
    const cleanReady = ready - readyWithWarnings;
    if (cleanReady === total) {
        return `All ${total} screens pass the derived readiness checks. Review them once more before implementation.`;
    }
    const parts: string[] = [
        `${cleanReady} of ${total} screens pass the derived readiness checks.`,
    ];
    if (needsReview > 0) {
        const gapText = topGapKinds
            .map(k => GAP_KIND_SHORT[k])
            .filter((s): s is string => Boolean(s))
            .slice(0, 2)
            .join(' and ');
        parts.push(gapText
            ? `${needsReview} need${needsReview === 1 ? 's' : ''} review — mostly ${gapText}.`
            : `${needsReview} need${needsReview === 1 ? 's' : ''} review.`);
    }
    if (readyWithWarnings > 0) {
        parts.push(
            `${readyWithWarnings} marked ready ${readyWithWarnings === 1 ? 'still has' : 'still have'} open warnings.`,
        );
    }
    return parts.join(' ');
}

/**
 * Artifact-level coverage & readiness rollup for the Screens list panel.
 * `flows` should be the FULL parsed user_flows list (or null when the
 * artifact doesn't exist) — the index alone can't distinguish "no flows
 * artifact" from "flows that reference no screens".
 */
export function buildScreenCoverageSummary(
    index: ScreenExperienceIndex,
    readiness: ReadonlyMap<string, ScreenReadiness>,
    flows: readonly ParsedFlow[] | null,
    features: readonly Feature[] | undefined,
): ScreenCoverageSummary {
    const items = index.items;
    const total = items.length;

    // PRD feature coverage — estimated purely from featureRefs id tokens.
    let prdFeatures: ScreenCoverageSummary['prdFeatures'] = null;
    if (features && features.length > 0) {
        const referenced = new Set<string>();
        for (const item of items) {
            for (const raw of item.screen.featureRefs ?? []) {
                const match = raw.trim().match(FEATURE_REF_ID_PATTERN);
                if (match) referenced.add(normalizeFeatureId(match[1]));
            }
        }
        const uncovered = features
            .filter(f => !referenced.has(normalizeFeatureId(f.id)))
            .map(f => ({ id: f.id, name: f.name }));
        prdFeatures = {
            covered: features.length - uncovered.length,
            total: features.length,
            uncovered,
        };
    }

    // Flow representation.
    let flowCoverage: ScreenCoverageSummary['flows'] = null;
    if (flows && flows.length > 0) {
        const represented = new Set<number>();
        for (const item of items) {
            for (const ref of item.relatedFlows) represented.add(ref.flowIndex);
        }
        flowCoverage = { represented: represented.size, total: flows.length };
    }

    const p0Items = items.filter(i => isP0(i.screen));
    let screensWithStates = 0;
    let totalStates = 0;
    let statesWithBehavior = 0;
    let openRisks = 0;
    for (const item of items) {
        const states = item.screen.states ?? [];
        if (states.length > 0) screensWithStates += 1;
        totalStates += states.length;
        statesWithBehavior += states.filter(stateHasBehavior).length;
        openRisks += item.screen.risks?.length ?? 0;
    }

    let ready = 0;
    let readyWithWarnings = 0;
    let needsReview = 0;
    const gapCounts = new Map<ScreenGapKind, number>();
    for (const item of items) {
        const r = readiness.get(item.id);
        if (!r) continue;
        if (r.status === 'implementation_ready') {
            ready += 1;
            // A user override that still carries review-trigger warnings is
            // "ready" only because a human said so — it must not make the
            // artifact-level rollup read as all-clear.
            if (r.gaps.some(g => g.kind === 'accepted_with_warnings')) readyWithWarnings += 1;
        }
        if (r.status === 'needs_review') needsReview += 1;
        for (const gap of r.gaps) {
            gapCounts.set(gap.kind, (gapCounts.get(gap.kind) ?? 0) + 1);
        }
    }
    const topGapKinds = Array.from(gapCounts.entries())
        .filter(([kind]) => REVIEW_TRIGGER_GAPS.has(kind))
        .sort((a, b) => b[1] - a[1])
        .map(([kind]) => kind);

    return {
        totalScreens: total,
        prdFeatures,
        flows: flowCoverage,
        p0: { total: p0Items.length, withMockup: p0Items.filter(i => i.mockupScreen).length },
        states: { screensWithStates, totalStates, statesWithBehavior },
        mockups: { covered: index.mockupCoverage.summary.mockedScreens, total },
        openRisks,
        ready,
        readyWithWarnings,
        needsReview,
        message: buildMessage(total, ready, readyWithWarnings, needsReview, topGapKinds),
    };
}

// --- List filters ---------------------------------------------------------------

export type ScreenListFilter =
    | 'all'
    | 'p0'
    | 'needs_review'
    | 'missing_mockups'
    | 'has_risks'
    | 'ready';

export const SCREEN_LIST_FILTERS: Array<{ id: ScreenListFilter; label: string }> = [
    { id: 'all', label: 'All' },
    { id: 'p0', label: 'P0' },
    { id: 'needs_review', label: 'Needs review' },
    { id: 'missing_mockups', label: 'Missing mockups' },
    { id: 'has_risks', label: 'Has risks' },
    { id: 'ready', label: 'Ready' },
];

export function screenMatchesFilter(
    item: ScreenExperienceItem,
    readiness: ScreenReadiness | undefined,
    filter: ScreenListFilter,
): boolean {
    switch (filter) {
        case 'all':
            return true;
        case 'p0':
            return isP0(item.screen);
        case 'needs_review':
            return readiness?.status === 'needs_review';
        case 'missing_mockups':
            return !item.mockupScreen;
        case 'has_risks':
            return (item.screen.risks?.length ?? 0) > 0;
        case 'ready':
            return readiness?.status === 'implementation_ready';
    }
}

// --- Mockup spec coverage (Mockups tab) ------------------------------------------

export interface MockupSpecCoverageRow {
    element: string;
    /** 'in_spec' — the element appears in the mockup screen's own spec;
     * 'not_in_spec' — the inventory lists it but the mockup spec doesn't. */
    status: 'in_spec' | 'not_in_spec';
}

const tokenize = (text: string): Set<string> =>
    new Set(
        text
            .toLowerCase()
            .split(/[^a-z0-9]+/)
            .filter(t => t.length > 2),
    );

/**
 * Map the inventory screen's core UI elements against the mockup screen's own
 * spec (coreUIElements). This is a *spec-to-spec* comparison — token overlap,
 * not visual detection — so the UI must present it as "in the mockup spec",
 * never "visible in the image". Returns [] when either side lists nothing
 * (no honest comparison possible).
 */
export function buildMockupSpecCoverage(
    inventoryScreen: ScreenItem,
    mockupElements: readonly string[] | undefined,
): MockupSpecCoverageRow[] {
    const specElements = (inventoryScreen.coreUIElements && inventoryScreen.coreUIElements.length > 0
        ? inventoryScreen.coreUIElements
        : inventoryScreen.components ?? []).filter(e => e.trim());
    if (specElements.length === 0 || !mockupElements || mockupElements.length === 0) return [];
    const mockupTokens = mockupElements.map(tokenize);
    return specElements.map(element => {
        const elTokens = tokenize(element);
        const matched = mockupTokens.some(mt => {
            let overlap = 0;
            for (const t of elTokens) if (mt.has(t)) overlap += 1;
            return overlap >= Math.min(2, elTokens.size) && overlap > 0;
        });
        return { element, status: matched ? 'in_spec' : 'not_in_spec' };
    });
}
