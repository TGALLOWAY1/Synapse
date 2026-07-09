// Pure readiness / coverage / traceability layer for the Screens experience
// view. Everything in this module is computed at read time from the joined
// ScreenExperienceIndex (src/lib/screenExperience.ts) plus the PRD's
// canonical feature list — nothing here is persisted, calls an LLM, or
// touches the store. The ONLY persisted inputs are the optional user-set
// `reviewStatus` / `mockupVariantStatus` riding the existing per-version
// `metadata.screenEdits` overlay (see ScreenMetadataEdit).
//
// Phase 2 source-grounding: newly generated inventories carry an explicit
// screen contract (structured states, riskDetails with handling, screen-level
// acceptanceCriteria, a handoff spec — see ScreenItem in src/types). The
// resolvers here PREFER those source fields and fall back to the Phase 1
// derived values for legacy artifacts. Resolution priority everywhere:
//   1. user-set overlay (reviewStatus / mockupVariantStatus),
//   2. source-grounded contract fields from the generated artifact,
//   3. Phase 1 derived values,
//   4. safe "Not specified" fallbacks.
//
// Honesty rule: every derived signal is an *estimate* from the generated
// spec (linked features, states, navigation, risks, mockup joins). Consumers
// must label it as such ("estimated", "derived", "generated — not
// semantically verified") and must never present a derived status as
// user-confirmed — ScreenReadiness.source / *.source distinguish these.

import type {
    Feature, MockupPlatform, ScreenHandoffEvent, ScreenItem, ScreenState, ScreenStateType,
} from '../types';
import type { ParsedFlow } from '../components/renderers/userFlows/types';
import { slugifyScreenName } from './screenInventoryImageStore';
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
    /** A linked feature ref parses to an id that matches no PRD feature. */
    | 'invalid_traceability'
    | 'missing_navigation'
    | 'missing_states'
    | 'states_without_behavior'
    | 'missing_mockup_p0'
    /** Contract-recommended state mockup variants that don't exist yet. */
    | 'missing_state_variants'
    | 'unresolved_risks'
    /** Flow decision steps touching this screen with no branch outcomes. */
    | 'decision_missing_branches'
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
    'invalid_traceability',
    'missing_mockup_p0',
    'missing_state_variants',
    'states_without_behavior',
    'decision_missing_branches',
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
    /** Canonical PRD features — enables invalid-ref validation when present. */
    features?: readonly Feature[];
    /** Contract-recommended state variants still missing a mockup (from
     * buildMockupVariantRows) — 0/absent for legacy screens. */
    missingRequiredVariants?: number;
    /** Flow decision steps referencing this screen whose decisions carry no
     * parseable branch outcomes (see parseDecisionBranches). */
    decisionsWithoutBranches?: number;
}

const isP0 = (screen: ScreenItem): boolean =>
    screen.priority === 'P0' || screen.priority === 'core';

function stateHasBehavior(state: ScreenState): boolean {
    return Boolean(
        (state.description && state.description.trim())
        || (state.trigger && state.trigger.trim())
        || (state.systemBehavior && state.systemBehavior.trim()),
    );
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
    } else if (input.features && input.features.length > 0) {
        // Refs exist AND we have a feature list to validate against: flag id
        // tokens that resolve to no PRD feature (stale or invented refs).
        const validIds = new Set(input.features.map(f => normalizeFeatureId(f.id)));
        const invalid = screen.featureRefs
            .map(raw => raw.trim().match(FEATURE_REF_ID_PATTERN))
            .filter((m): m is RegExpMatchArray => Boolean(m))
            .map(m => m[1])
            .filter(refId => !validIds.has(normalizeFeatureId(refId)));
        if (invalid.length > 0) {
            gaps.push({
                kind: 'invalid_traceability',
                message: invalid.length === 1
                    ? `Linked feature id "${invalid[0]}" doesn't match any PRD feature — the reference may be stale.`
                    : `${invalid.length} linked feature ids (${invalid.join(', ')}) don't match any PRD feature — the references may be stale.`,
            });
        }
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
    if (screen.riskDetails && screen.riskDetails.length > 0) {
        // Source-grounded risks: only those without a proposed handling are
        // unresolved — a generated risk with concrete handling is documented,
        // not an open review item.
        const unhandled = screen.riskDetails.filter(r => !r.proposedHandling?.trim());
        if (unhandled.length > 0) {
            gaps.push({
                kind: 'unresolved_risks',
                message: unhandled.length === 1
                    ? '1 risk noted with no proposed handling recorded.'
                    : `${unhandled.length} risks noted with no proposed handling recorded.`,
            });
        }
    } else {
        const riskCount = screen.risks?.length ?? 0;
        if (riskCount > 0) {
            // Legacy spec: risks are plain text with no mitigation or severity
            // fields, so every risk counts as unresolved until reviewed.
            gaps.push({
                kind: 'unresolved_risks',
                message: riskCount === 1
                    ? '1 risk noted with no proposed handling recorded.'
                    : `${riskCount} risks noted with no proposed handling recorded.`,
            });
        }
    }
    const missingVariants = input.missingRequiredVariants ?? 0;
    if (missingVariants > 0) {
        gaps.push({
            kind: 'missing_state_variants',
            message: missingVariants === 1
                ? '1 recommended state has no mockup variant.'
                : `${missingVariants} recommended states have no mockup variants.`,
        });
    }
    const branchlessDecisions = input.decisionsWithoutBranches ?? 0;
    if (branchlessDecisions > 0) {
        gaps.push({
            kind: 'decision_missing_branches',
            message: branchlessDecisions === 1
                ? 'A flow decision on this screen has no branch outcomes specified.'
                : `${branchlessDecisions} flow decisions on this screen have no branch outcomes specified.`,
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
 * (ScreenMetadataEdit.reviewStatus). Passing `features` enables invalid-ref
 * validation; Phase 2 contract fields (state variants, decision branches)
 * feed in automatically and are absent for legacy artifacts. */
export function buildReadinessIndex(
    index: ScreenExperienceIndex,
    features?: readonly Feature[],
): Map<string, ScreenReadiness> {
    const out = new Map<string, ScreenReadiness>();
    for (const item of index.items) {
        const variants = buildMockupVariantRows(item);
        out.set(item.id, deriveScreenReadiness({
            screen: item.screen,
            hasMockup: Boolean(item.mockupScreen),
            flowRefCount: item.relatedFlows.length,
            userStatus: item.edit?.reviewStatus,
            features,
            // State rows only — the default view is the existing
            // missing_mockup_p0 gap's job, and counting it here would
            // downgrade every legacy screen without a mockup (even P2/P3)
            // to needs_review.
            missingRequiredVariants: variants.filter(v =>
                v.id !== DEFAULT_VARIANT_ID && v.required && v.status === 'missing').length,
            decisionsWithoutBranches: countDecisionsWithoutBranches(item),
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

/**
 * Traceability confidence:
 *   'explicit'  — every ref parses to an id resolving to a real PRD feature
 *                 (the generation-time mapping checks out — still a model
 *                 claim, not a semantic proof; label it as such);
 *   'estimated' — refs exist but at least one doesn't resolve cleanly, so
 *                 coverage is estimated from what does link;
 *   'missing'   — no refs at all.
 */
export type TraceabilityConfidence = 'explicit' | 'estimated' | 'missing';

export interface ScreenTraceability {
    features: ScreenFeatureLink[];
    /** Titles of the user flows referencing this screen (unique, in order). */
    flows: string[];
    confidence: TraceabilityConfidence;
    /** Parsed ref-id tokens that resolve to no PRD feature (stale refs). */
    invalidRefIds: string[];
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
    const invalidRefIds = links
        .filter(l => l.refId && !l.feature && byNormId.size > 0)
        .map(l => l.refId as string);
    const confidence: TraceabilityConfidence = links.length === 0
        ? 'missing'
        : byNormId.size > 0 && links.every(l => l.feature)
            ? 'explicit'
            : 'estimated';
    return {
        features: links,
        flows: flowTitles,
        confidence,
        invalidRefIds,
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

export interface ResolvedAcceptanceCriteria {
    criteria: string[];
    /** 'generated' — from the artifact's own acceptanceCriteria contract
     * fields (screen-level + per-state); 'derived' — Phase 1 restatement of
     * the spec. UI labels must distinguish the two. */
    source: 'generated' | 'derived';
}

const MAX_GENERATED_CRITERIA = 14;

/** Source-grounded acceptance criteria when the generated contract carries
 * them (screen-level plus per-state), Phase 1 derived criteria otherwise. */
export function resolveAcceptanceCriteria(screen: ScreenItem): ResolvedAcceptanceCriteria {
    const generated: string[] = [...(screen.acceptanceCriteria ?? [])];
    for (const state of screen.states ?? []) {
        for (const c of state.acceptanceCriteria ?? []) generated.push(c);
    }
    const cleaned = generated.map(c => c.trim()).filter(Boolean);
    if (cleaned.length > 0) {
        const seen = new Set<string>();
        const deduped = cleaned.filter(c => {
            const key = c.toLowerCase();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
        return { criteria: deduped.slice(0, MAX_GENERATED_CRITERIA), source: 'generated' };
    }
    return { criteria: deriveAcceptanceCriteria(screen), source: 'derived' };
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
 * legacy generated spec, so none is fabricated here; the UI shows
 * "Not specified". (Phase 2 contract artifacts use resolveScreenHandoff.) */
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

export interface ResolvedScreenHandoff {
    /** 'generated' — the artifact carries a handoff contract; 'derived' —
     * Phase 1 re-projection of the spec. Individual fields may still be
     * absent either way — the UI says "Not specified". */
    source: 'generated' | 'derived';
    route?: string;
    routeParams: string[];
    /** primaryComponents from the contract, else the spec's UI regions. */
    components: string[];
    /** State names the implementation must cover. */
    states: string[];
    stateVariables: string[];
    /** Generated events (name/trigger/effect) — empty for legacy specs. */
    events: ScreenHandoffEvent[];
    /** Exit-path interactions (always derivable, shown when no events). */
    exitEvents: Array<{ label: string; target: string; condition?: string }>;
    outputs: string[];
    dataDependencies: string[];
    apiDependencies: string[];
    accessibilityNotes: string[];
    responsiveNotes: string[];
}

/** Developer handoff preferring the generated Phase 2 contract, falling back
 * per-field to the Phase 1 derived projection. */
export function resolveScreenHandoff(screen: ScreenItem): ResolvedScreenHandoff {
    const derived = buildScreenHandoff(screen);
    const h = screen.handoff;
    return {
        source: h ? 'generated' : 'derived',
        route: h?.route,
        routeParams: h?.routeParams ?? [],
        components: h?.primaryComponents?.length ? h.primaryComponents : derived.components,
        states: derived.states,
        stateVariables: h?.stateVariables ?? [],
        events: h?.events ?? [],
        exitEvents: derived.events,
        outputs: derived.outputs,
        dataDependencies: h?.dataDependencies ?? [],
        apiDependencies: h?.apiDependencies ?? [],
        accessibilityNotes: h?.accessibilityNotes ?? [],
        responsiveNotes: h?.responsiveNotes ?? [],
    };
}

// --- Mockup variant tracking (metadata-based, never visual) ---------------------

export type MockupVariantRowStatus = 'generated' | 'missing' | 'accepted' | 'not_needed';

/**
 * One mockup-variant row for a screen: the default view plus one row per
 * documented state. Status is tracked from generated mockup METADATA and the
 * user's overlay — never from inspecting the image. UI copy must say so
 * ("tracked from generated mockup metadata"), and must never claim Synapse
 * looked at the pixels.
 */
export interface MockupVariantRow {
    /** Deterministic id — the overlay key (ScreenMetadataEdit.mockupVariantStatus). */
    id: string;
    label: string;
    /** Platform of the mockup set, when known (mockup settings). */
    platform?: MockupPlatform;
    stateName: string;
    stateType?: ScreenStateType;
    /** Recommended by the generated contract (state.needsMockup) or the
     * default view of the screen. Missing required rows count as a gap. */
    required: boolean;
    status: MockupVariantRowStatus;
    /** True when status comes from the user's overlay (accepted/not_needed). */
    userSet: boolean;
    /** 'mockup_metadata' — joined to an actual generated mockup screen;
     * 'contract' — recommended by the generated state contract;
     * 'derived' — listed because the state exists in the spec. */
    source: 'mockup_metadata' | 'contract' | 'derived';
}

export const DEFAULT_VARIANT_ID = 'default';

/**
 * Variant rows for one screen. The default row reflects whether the screen is
 * in the mockup set (spec-to-spec join — see ScreenExperienceItem.mockupScreen).
 * State rows exist for every documented state; per-state mockup generation
 * isn't wired yet, so a state row is 'missing' unless the user marked it
 * accepted (e.g. covered by an upload) or not needed.
 */
export function buildMockupVariantRows(
    item: Pick<ScreenExperienceItem, 'screen' | 'mockupScreen' | 'edit'>,
    platform?: MockupPlatform,
): MockupVariantRow[] {
    const overlay = item.edit?.mockupVariantStatus ?? {};
    const rows: MockupVariantRow[] = [];

    const defaultOverride = overlay[DEFAULT_VARIANT_ID];
    rows.push({
        id: DEFAULT_VARIANT_ID,
        label: 'Default view',
        platform,
        stateName: 'Default',
        stateType: 'default',
        required: true,
        status: defaultOverride ?? (item.mockupScreen ? 'generated' : 'missing'),
        userSet: Boolean(defaultOverride),
        source: item.mockupScreen ? 'mockup_metadata' : 'derived',
    });

    const seen = new Set<string>([DEFAULT_VARIANT_ID]);
    for (const state of item.screen.states ?? []) {
        if (!state.name?.trim()) continue;
        // A generated contract may model the default view as an explicit
        // state — fold it into the default row rather than duplicating it.
        if (state.type === 'default') continue;
        const base = `state:${slugifyScreenName(state.name)}`;
        let id = base;
        let n = 2;
        while (seen.has(id)) {
            id = `${base}-${n}`;
            n += 1;
        }
        seen.add(id);
        const override = overlay[id];
        const hasContract = state.needsMockup !== undefined || state.required !== undefined
            || state.type !== undefined;
        rows.push({
            id,
            label: state.name,
            platform,
            stateName: state.name,
            stateType: state.type,
            required: state.needsMockup === true,
            status: override ?? 'missing',
            userSet: Boolean(override),
            source: hasContract ? 'contract' : 'derived',
        });
    }
    return rows;
}

// --- Flow decision branches ------------------------------------------------------

export interface DecisionBranch {
    condition: string;
    outcome: string;
}

const ARROW_SPLIT = /→|->/;

/**
 * Parse a flow decision line into structured branches. Handles the two shapes
 * the user_flows format produces:
 *   - arrow lists:  "Start new → Submission form; Resume → Dashboard"
 *   - if/otherwise: "If no role selected, go to step 4; otherwise step 5"
 * Returns [] when no branch outcomes are parseable — callers surface that as
 * "branch outcomes not specified", never invent one.
 */
export function parseDecisionBranches(decision: string): DecisionBranch[] {
    const text = decision.trim();
    if (!text) return [];
    const branches: DecisionBranch[] = [];

    const segments = text.split(/;|\n/).map(s => s.trim()).filter(Boolean);
    for (const segment of segments) {
        if (ARROW_SPLIT.test(segment)) {
            const [condition, ...rest] = segment.split(ARROW_SPLIT);
            const outcome = rest.join(' → ').trim();
            if (condition.trim() && outcome) {
                branches.push({ condition: cleanBranchText(condition), outcome: cleanBranchText(outcome) });
            }
            continue;
        }
        const ifMatch = segment.match(/^if\s+(.+?),\s*(?:then\s+)?(.+)$/i);
        if (ifMatch) {
            branches.push({ condition: cleanBranchText(ifMatch[1]), outcome: cleanBranchText(ifMatch[2]) });
            continue;
        }
        const otherwiseMatch = segment.match(/^(?:otherwise|else)[,\s]+(.+)$/i);
        if (otherwiseMatch && branches.length > 0) {
            branches.push({ condition: 'Otherwise', outcome: cleanBranchText(otherwiseMatch[1]) });
        }
    }
    return branches;
}

const cleanBranchText = (text: string): string =>
    text.trim().replace(/^\*+|\*+$/g, '').replace(/[.,;]+$/, '').trim();

/** Flow decision steps referencing this screen whose decisions have NO
 * parseable branch outcome — the "Decision: user chooses path" smell. */
export function countDecisionsWithoutBranches(
    item: Pick<ScreenExperienceItem, 'relatedFlows'>,
): number {
    let count = 0;
    for (const ref of item.relatedFlows) {
        for (const decision of ref.step.decisions) {
            if (parseDecisionBranches(decision).length === 0) count += 1;
        }
    }
    return count;
}

// --- Artifact-level coverage summary --------------------------------------------

export interface ScreenCoverageSummary {
    totalScreens: number;
    /** PRD features covered by ≥1 screen's featureRefs. Null when the PRD has
     * no feature list to compare against. Estimated — say so in the UI.
     * `mustWithoutPrimaryScreen`: must-have features whose only coverage (if
     * any) comes from P2/P3 screens — a priority-mismatch warning. */
    prdFeatures: {
        covered: number;
        total: number;
        uncovered: Array<{ id: string; name: string }>;
        mustWithoutPrimaryScreen: Array<{ id: string; name: string }>;
    } | null;
    /** Contract-recommended state mockup variants (state.needsMockup) across
     * all screens. Null when no screen carries the Phase 2 contract fields.
     * Tracked from mockup metadata + user overlay — never visual detection. */
    stateVariants: { covered: number; required: number } | null;
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
    invalid_traceability: 'stale PRD links',
    missing_mockup_p0: 'P0 screens without mockups',
    missing_state_variants: 'states without mockup variants',
    states_without_behavior: 'states without behavior',
    decision_missing_branches: 'decisions without branch outcomes',
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
        const referencedByPrimary = new Set<string>(); // by a P0/P1 screen
        for (const item of items) {
            const primary = isP0(item.screen) || item.screen.priority === 'P1'
                || item.screen.priority === 'secondary';
            for (const raw of item.screen.featureRefs ?? []) {
                const match = raw.trim().match(FEATURE_REF_ID_PATTERN);
                if (!match) continue;
                const norm = normalizeFeatureId(match[1]);
                referenced.add(norm);
                if (primary) referencedByPrimary.add(norm);
            }
        }
        const uncovered = features
            .filter(f => !referenced.has(normalizeFeatureId(f.id)))
            .map(f => ({ id: f.id, name: f.name }));
        // Priority mismatch: a must-have feature whose only screen coverage
        // comes from P2/P3 screens (features with NO coverage at all are
        // already in `uncovered` — don't double-report them here).
        const mustWithoutPrimaryScreen = features
            .filter(f => f.priority === 'must'
                && referenced.has(normalizeFeatureId(f.id))
                && !referencedByPrimary.has(normalizeFeatureId(f.id)))
            .map(f => ({ id: f.id, name: f.name }));
        prdFeatures = {
            covered: features.length - uncovered.length,
            total: features.length,
            uncovered,
            mustWithoutPrimaryScreen,
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
    let requiredVariants = 0;
    let coveredVariants = 0;
    for (const item of items) {
        const states = item.screen.states ?? [];
        if (states.length > 0) screensWithStates += 1;
        totalStates += states.length;
        statesWithBehavior += states.filter(stateHasBehavior).length;
        // Source-grounded risks with a proposed handling aren't open items.
        openRisks += item.screen.riskDetails
            ? item.screen.riskDetails.filter(r => !r.proposedHandling?.trim()).length
            : item.screen.risks?.length ?? 0;
        for (const row of buildMockupVariantRows(item)) {
            if (row.id === DEFAULT_VARIANT_ID || !row.required) continue;
            requiredVariants += 1;
            if (row.status !== 'missing') coveredVariants += 1;
        }
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
        stateVariants: requiredVariants > 0
            ? { covered: coveredVariants, required: requiredVariants }
            : null,
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
    | 'draft'
    | 'needs_review'
    | 'accepted'
    | 'ready'
    | 'has_blockers'
    | 'review_recommended'
    | 'outdated_review'
    | 'downstream_review'
    | 'missing_mockups'
    | 'has_risks';

export const SCREEN_LIST_FILTERS: Array<{ id: ScreenListFilter; label: string }> = [
    { id: 'all', label: 'All' },
    { id: 'p0', label: 'P0' },
    { id: 'draft', label: 'Draft' },
    { id: 'needs_review', label: 'Needs review' },
    { id: 'accepted', label: 'Accepted' },
    { id: 'ready', label: 'Ready' },
    { id: 'has_blockers', label: 'Has blockers' },
    { id: 'review_recommended', label: 'Review recommended' },
    // Phase 4B: re-review + downstream-impact filters. Grouped after the
    // existing review filters so the review-focused controls stay together.
    { id: 'outdated_review', label: 'Outdated review' },
    { id: 'downstream_review', label: 'Downstream review' },
    { id: 'missing_mockups', label: 'Missing mockups' },
    { id: 'has_risks', label: 'Has risks' },
];

/** Optional review signals (Phase 4A/4B) so filters can key off the user review
 * status, derived blockers/review items, re-review freshness, and downstream
 * impact — not just the combined readiness. */
export interface ScreenFilterReview {
    /** Explicit user-set status, or undefined when unreviewed (treated as draft). */
    userStatus?: ScreenReviewStatus;
    blockingCount: number;
    reviewCount: number;
    /** Phase 4B: 'outdated' when an accepted screen changed after sign-off. */
    reviewFreshness?: 'current' | 'outdated' | 'unknown';
    /** Phase 4B: true when this screen has a blocking/review downstream impact. */
    downstreamReviewNeeded?: boolean;
}

export function screenMatchesFilter(
    item: ScreenExperienceItem,
    readiness: ScreenReadiness | undefined,
    filter: ScreenListFilter,
    review?: ScreenFilterReview,
): boolean {
    const userStatus = review?.userStatus;
    switch (filter) {
        case 'all':
            return true;
        case 'p0':
            return isP0(item.screen);
        case 'draft':
            // Unreviewed screens read as draft (the derived default), so match
            // either an explicit draft status or no user status at all.
            return userStatus === 'draft' || (!userStatus && readiness?.source === 'derived');
        case 'needs_review':
            return userStatus === 'needs_review'
                || (!userStatus && readiness?.status === 'needs_review');
        case 'accepted':
            return userStatus === 'accepted' || userStatus === 'implementation_ready';
        case 'ready':
            return userStatus === 'implementation_ready'
                || (!userStatus && readiness?.status === 'implementation_ready');
        case 'has_blockers':
            return (review?.blockingCount ?? 0) > 0;
        case 'review_recommended':
            return (review?.blockingCount ?? 0) > 0 || (review?.reviewCount ?? 0) > 0;
        case 'outdated_review':
            return review?.reviewFreshness === 'outdated';
        case 'downstream_review':
            return review?.downstreamReviewNeeded === true;
        case 'missing_mockups':
            return !item.mockupScreen;
        case 'has_risks':
            return (item.screen.risks?.length ?? 0) > 0;
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
