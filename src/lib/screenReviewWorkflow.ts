// Phase 4A: the screen review & approval workflow layer.
//
// This module turns the Screens artifact from a reference surface into a
// review workflow. It answers, per screen and per artifact:
//   - which screens are reviewed / accepted / implementation-ready?
//   - what issues block confidence (blockers vs. review items vs. info)?
//   - can this artifact safely inform implementation planning?
//   - has an accepted screen changed since it was signed off (re-review)?
//
// It is layered ON TOP of the existing readiness/coverage layers
// (src/lib/screenReadiness.ts, src/lib/mockupVariants.ts,
// src/lib/mockupVariantTrust.ts) and NEVER changes their logic. It is PURE and
// read-time only (no store, no IDB, no React, no LLM). Two distinct concepts,
// deliberately not collapsed:
//
//   1. USER review status  — set by the user (draft / needs_review / accepted /
//      implementation_ready), persisted in the screenEdits `reviewStatus`
//      overlay. This is a human sign-off.
//   2. SYSTEM readiness    — derived from quality signals (blockers / review
//      items). This is Synapse's estimate, never a human decision.
//
// A screen can be user-Accepted while system readiness says "review
// recommended" (e.g. a stale mobile mockup), or user-Draft while the system
// says "ready to accept". The UI must show both.
//
// Honesty rules (mirroring the rest of the Screens layer): every derived
// signal is an estimate; freshness/coverage come from stored metadata, never
// from inspecting rendered pixels; language is calm and helpful, never
// alarming ("Review recommended", not "Invalid").

import type {
    Feature, ScreenItem, ScreenState, ScreenReviewChecklist, ScreenReviewMeta, ScreenReviewSignature,
    LegacyScreenPriority, ScreenPriority,
} from '../types';
import type { ScreenExperienceIndex, ScreenExperienceItem } from './screenExperience';
import {
    detectScreenGaps, resolveAcceptanceCriteria, resolveScreenHandoff, countDecisionsWithoutBranches,
    DEFAULT_VARIANT_ID,
    type ScreenReviewStatus,
} from './screenReadiness';
import {
    buildScreenMockupVariants, summarizeScreenVariants,
    type BuildVariantOptions, type DerivedMockupVariant,
} from './mockupVariants';

export type { ScreenReviewStatus } from './screenReadiness';
export { REVIEW_STATUS_LABELS } from './screenReadiness';

// --- Review issues -----------------------------------------------------------

export type ScreenReviewIssueSeverity = 'blocking' | 'review' | 'info';

export type ScreenReviewIssueCategory =
    | 'purpose'
    | 'prd_traceability'
    | 'navigation'
    | 'states'
    | 'risks'
    | 'mockups'
    | 'mockup_freshness'
    | 'acceptance_criteria'
    | 'handoff'
    | 'flow'
    | 'mobile'
    | 'data_model';

export interface ScreenReviewIssue {
    /** Stable id for keys/dedupe. */
    id: string;
    severity: ScreenReviewIssueSeverity;
    category: ScreenReviewIssueCategory;
    /** Short headline (calm language). */
    title: string;
    /** One-sentence explanation. */
    description: string;
    /** What the user could do about it, when there's a clear next step. */
    recommendedAction?: string;
}

export const SEVERITY_LABELS: Record<ScreenReviewIssueSeverity, string> = {
    blocking: 'Blocking',
    review: 'Review recommended',
    info: 'For your information',
};

// --- System readiness --------------------------------------------------------

/** Synapse's derived estimate of a screen's build-readiness — distinct from
 * the user's review status. */
export type SystemReadinessStatus = 'ready' | 'needs_review' | 'blocked';

export const SYSTEM_READINESS_LABELS: Record<SystemReadinessStatus, string> = {
    ready: 'Ready to accept',
    needs_review: 'Review recommended',
    blocked: 'Blocking issues',
};

// --- Signals the derivation consumes -----------------------------------------

/** Everything `deriveScreenReviewIssues` / `buildScreenReviewModel` need. The
 * mockup/freshness fields are precomputed by the caller (the views already
 * build the variant grid); pure tests can pass them directly. */
export interface ScreenReviewSignals {
    screen: ScreenItem;
    hasMockup: boolean;
    flowRefCount: number;
    features?: readonly Feature[];
    /** Explicit user-set status (screenEdits.reviewStatus). */
    userStatus?: ScreenReviewStatus;
    /** Supporting review record (screenEdits.review). */
    reviewMeta?: ScreenReviewMeta;
    /** A recommended Mobile default variant is missing (from the variant grid). */
    mobileMockupMissing?: boolean;
    /** A generated mockup carries no captured coverage metadata (legacy). */
    coverageUnknown?: boolean;
    /** Generated variants that read stale / possibly-stale (freshness review). */
    freshnessStale?: number;
    /** Generated variants whose freshness can't be confirmed (legacy metadata). */
    freshnessUnknown?: number;
    /** Flow decision steps on this screen with no parseable branch outcomes. */
    decisionsWithoutBranches?: number;
    /** Recommended state mockup variants still missing. */
    missingRequiredVariants?: number;
}

const isP0 = (screen: ScreenItem): boolean =>
    screen.priority === 'P0' || screen.priority === 'core';

/** Primary = a screen users routinely land on (P0/P1). Navigation/traceability
 * blockers only apply to primary screens; supporting UI can legitimately lack
 * flow refs or its own PRD feature. */
const isPrimary = (screen: ScreenItem): boolean =>
    isP0(screen) || screen.priority === 'P1' || screen.priority === 'secondary';

function stateHasBehavior(state: ScreenState): boolean {
    return Boolean(
        (state.description && state.description.trim())
        || (state.trigger && state.trigger.trim())
        || (state.systemBehavior && state.systemBehavior.trim()),
    );
}

/**
 * Derive the review issues (blockers / review items / info) for one screen.
 * Reuses the existing gap detection and resolvers so it never drifts from the
 * readiness layer, then classifies by severity with priority-awareness.
 */
export function deriveScreenReviewIssues(signals: ScreenReviewSignals): ScreenReviewIssue[] {
    const { screen } = signals;
    const primary = isPrimary(screen);
    const p0 = isP0(screen);
    const issues: ScreenReviewIssue[] = [];

    const gaps = detectScreenGaps({
        screen,
        hasMockup: signals.hasMockup,
        flowRefCount: signals.flowRefCount,
        features: signals.features,
        missingRequiredVariants: signals.missingRequiredVariants,
        decisionsWithoutBranches: signals.decisionsWithoutBranches,
    });
    const gapKinds = new Set(gaps.map(g => g.kind));
    const gapMessage = (kind: string): string | undefined =>
        gaps.find(g => g.kind === kind)?.message;

    // --- Purpose (blocking) ---------------------------------------------------
    if (gapKinds.has('missing_purpose')) {
        issues.push({
            id: 'purpose_missing',
            severity: 'blocking',
            category: 'purpose',
            title: 'No purpose recorded',
            description: 'This screen has no description of what it is for.',
            recommendedAction: 'Add a short purpose so the intent is clear before building.',
        });
    }

    // --- PRD traceability -----------------------------------------------------
    if (gapKinds.has('missing_traceability')) {
        issues.push({
            id: 'traceability_missing',
            severity: primary ? 'blocking' : 'review',
            category: 'prd_traceability',
            title: 'No linked PRD features',
            description: primary
                ? 'This primary screen is not linked to any PRD feature, so its coverage is unclear.'
                : 'This screen is not linked to any PRD feature — confirm it is intentional supporting UI.',
            recommendedAction: 'Link the PRD features this screen serves, or confirm it is supporting UI.',
        });
    }
    if (gapKinds.has('invalid_traceability')) {
        issues.push({
            id: 'traceability_invalid',
            severity: 'review',
            category: 'prd_traceability',
            title: 'Some linked features may be stale',
            description: gapMessage('invalid_traceability')
                ?? 'One or more linked feature ids no longer match the PRD.',
            recommendedAction: 'Re-link the screen to current PRD features.',
        });
    }

    // --- Navigation (blocking for primary) ------------------------------------
    if (gapKinds.has('missing_navigation')) {
        issues.push({
            id: 'navigation_missing',
            severity: primary ? 'blocking' : 'review',
            category: 'navigation',
            title: 'Entry or exit path not specified',
            description: gapMessage('missing_navigation')
                ?? 'How users arrive at or leave this screen is not specified.',
            recommendedAction: 'Document how users reach this screen and where they go next.',
        });
    }

    // --- States ---------------------------------------------------------------
    const states = screen.states ?? [];
    const requiredNoBehavior = states.filter(s => s.required === true && !stateHasBehavior(s));
    if (requiredNoBehavior.length > 0) {
        issues.push({
            id: 'required_state_no_behavior',
            severity: 'blocking',
            category: 'states',
            title: 'Required state has no behavior',
            description: requiredNoBehavior.length === 1
                ? `The required "${requiredNoBehavior[0].name}" state has no trigger or behavior described.`
                : `${requiredNoBehavior.length} required states have no trigger or behavior described.`,
            recommendedAction: 'Describe what triggers each required state and what the user sees.',
        });
    } else if (gapKinds.has('states_without_behavior')) {
        issues.push({
            id: 'state_no_behavior',
            severity: 'review',
            category: 'states',
            title: 'Some states lack behavior',
            description: gapMessage('states_without_behavior')
                ?? 'A documented state has no trigger or behavior described.',
        });
    }
    if (gapKinds.has('missing_states')) {
        issues.push({
            id: 'states_missing',
            severity: 'review',
            category: 'states',
            title: 'No UI states documented',
            description: 'Empty, loading, and error states may still be needed.',
            recommendedAction: 'Add the empty / loading / error states this screen needs.',
        });
    }

    // --- Mockups --------------------------------------------------------------
    if (gapKinds.has('missing_mockup_p0')) {
        issues.push({
            id: 'mockup_missing_p0',
            severity: 'blocking',
            category: 'mockups',
            title: 'P0 screen without a mockup',
            description: 'This is a P0 screen with no default mockup generated yet.',
            recommendedAction: 'Generate or upload a mockup for this screen.',
        });
    }
    if (signals.mobileMockupMissing) {
        issues.push({
            id: 'mockup_mobile_missing',
            severity: 'review',
            category: 'mobile',
            title: 'Mobile mockup recommended',
            description: 'A mobile variant is recommended for this screen but has not been generated.',
            recommendedAction: 'Generate a mobile variant, or mark it not needed if the screen is desktop-only.',
        });
    }
    if (gapKinds.has('missing_state_variants')) {
        issues.push({
            id: 'mockup_state_variants_missing',
            severity: 'review',
            category: 'mockups',
            title: 'Recommended state mockups missing',
            description: gapMessage('missing_state_variants')
                ?? 'Some recommended state mockup variants have not been generated.',
        });
    }
    if ((signals.freshnessStale ?? 0) > 0) {
        const n = signals.freshnessStale ?? 0;
        issues.push({
            id: 'mockup_freshness_stale',
            severity: 'review',
            category: 'mockup_freshness',
            title: n === 1 ? 'A mockup may be out of date' : 'Some mockups may be out of date',
            description: n === 1
                ? 'A generated mockup predates a change to the screen spec, design system, or PRD.'
                : `${n} generated mockups predate a change to the screen spec, design system, or PRD.`,
            recommendedAction: 'Regenerate the affected mockups to match the current spec.',
        });
    }

    // --- Risks ----------------------------------------------------------------
    const risks = screen.riskDetails ?? [];
    const highUnresolved = risks.filter(r => r.severity === 'high' && !r.proposedHandling?.trim());
    if (highUnresolved.length > 0) {
        issues.push({
            id: 'risk_high_unresolved',
            // A high-severity unresolved risk blocks build-readiness on a P0
            // screen; elsewhere it is a strong review item.
            severity: p0 ? 'blocking' : 'review',
            category: 'risks',
            title: 'Unresolved high-severity risk',
            description: highUnresolved.length === 1
                ? `A high-severity risk has no proposed handling: ${highUnresolved[0].description}`
                : `${highUnresolved.length} high-severity risks have no proposed handling recorded.`,
            recommendedAction: 'Record how each high-severity risk will be handled.',
        });
    } else if (gapKinds.has('unresolved_risks')) {
        issues.push({
            id: 'risk_unresolved',
            severity: 'review',
            category: 'risks',
            title: 'Risks noted without handling',
            description: gapMessage('unresolved_risks')
                ?? 'Risk notes in the spec have no recorded handling yet.',
            recommendedAction: 'Note how each risk will be handled, or mark it acceptable.',
        });
    }

    // --- Acceptance criteria (blocking when none can even be derived) ---------
    if (resolveAcceptanceCriteria(screen).criteria.length === 0) {
        issues.push({
            id: 'acceptance_missing',
            severity: 'blocking',
            category: 'acceptance_criteria',
            title: 'No acceptance criteria',
            description: 'There is not enough detail (intent, navigation, states) to state acceptance criteria.',
            recommendedAction: 'Add the intent, navigation, and states so acceptance criteria can be written.',
        });
    }

    // --- Developer handoff (review only when genuinely empty) -----------------
    const handoff = resolveScreenHandoff(screen);
    const handoffEmpty = !handoff.route && handoff.components.length === 0
        && handoff.events.length === 0 && handoff.exitEvents.length === 0;
    if (handoffEmpty) {
        issues.push({
            id: 'handoff_incomplete',
            severity: 'review',
            category: 'handoff',
            title: 'Developer handoff is thin',
            description: 'Route, primary components, and interactions are all unspecified for this screen.',
            recommendedAction: 'Fill in a route, key components, and interactions before implementation.',
        });
    }

    // --- Flow decisions -------------------------------------------------------
    if (gapKinds.has('decision_missing_branches')) {
        issues.push({
            id: 'decision_unspecified',
            severity: 'review',
            category: 'flow',
            title: 'Flow decision without outcomes',
            description: gapMessage('decision_missing_branches')
                ?? 'A flow decision on this screen has no branch outcomes specified.',
            recommendedAction: 'Specify what each decision branch leads to in the user flow.',
        });
    }

    // --- Info: freshness/coverage unknown, no flow refs -----------------------
    if ((signals.freshnessUnknown ?? 0) > 0) {
        issues.push({
            id: 'mockup_freshness_unknown',
            severity: 'info',
            category: 'mockup_freshness',
            title: 'Mockup freshness unknown',
            description: 'An older mockup has no source metadata, so Synapse cannot confirm it is up to date.',
        });
    } else if (signals.coverageUnknown) {
        issues.push({
            id: 'coverage_unknown',
            severity: 'info',
            category: 'mockups',
            title: 'Mockup coverage unknown',
            description: 'This mockup predates coverage metadata, so which spec items it represents is unconfirmed.',
        });
    }
    if (gapKinds.has('no_flow_refs')) {
        issues.push({
            id: 'flow_missing',
            severity: 'info',
            category: 'flow',
            title: 'Not referenced by a user flow',
            description: 'No user flow currently references this screen — that may be fine for supporting UI.',
        });
    }

    return issues;
}

// --- Review model (per screen) -----------------------------------------------

export interface ScreenReviewModel {
    /** User-set status, or undefined when the user hasn't reviewed it. */
    userStatus?: ScreenReviewStatus;
    /** Synapse's derived readiness (independent of userStatus). */
    systemReadiness: SystemReadinessStatus;
    issues: ScreenReviewIssue[];
    blockingCount: number;
    reviewCount: number;
    infoCount: number;
    /** True when a user-set status carries open blocking/review issues — the
     * screen was accepted/promoted over warnings. */
    acceptedOverWarnings: boolean;
    /** Re-review status vs. the sign-off signature (see compareReviewFreshness). */
    freshness: ScreenReviewFreshnessStatus;
    checklist: ScreenReviewChecklist;
    /** Ticked / total checklist items. */
    checklistProgress: { checked: number; total: number };
    reviewMeta?: ScreenReviewMeta;
}

const CHECKLIST_ITEM_KEYS: Array<keyof ScreenReviewChecklist> = [
    'purposeMatchesPrd', 'entryExitPathsReviewed', 'statesReviewed', 'risksReviewed',
    'mockupsReviewed', 'mobileReviewed', 'acceptanceCriteriaReviewed', 'developerHandoffReviewed',
];

export const CHECKLIST_LABELS: Record<keyof ScreenReviewChecklist, string> = {
    purposeMatchesPrd: 'Purpose matches the PRD',
    entryExitPathsReviewed: 'Entry and exit paths are correct',
    statesReviewed: 'Required states are complete',
    risksReviewed: 'Risks and edge cases are handled',
    mockupsReviewed: 'Mockups match the intended layout',
    mobileReviewed: 'Mobile / responsive behavior reviewed',
    acceptanceCriteriaReviewed: 'Acceptance criteria are sufficient',
    developerHandoffReviewed: 'Developer handoff details are sufficient',
};

function systemReadinessFrom(issues: readonly ScreenReviewIssue[]): SystemReadinessStatus {
    if (issues.some(i => i.severity === 'blocking')) return 'blocked';
    if (issues.some(i => i.severity === 'review')) return 'needs_review';
    return 'ready';
}

/** Build the full review model for one screen from precomputed signals. */
export function buildScreenReviewModel(signals: ScreenReviewSignals): ScreenReviewModel {
    const issues = deriveScreenReviewIssues(signals);
    const systemReadiness = systemReadinessFrom(issues);
    const blockingCount = issues.filter(i => i.severity === 'blocking').length;
    const reviewCount = issues.filter(i => i.severity === 'review').length;
    const infoCount = issues.filter(i => i.severity === 'info').length;
    const userStatus = signals.userStatus;
    const signedOff = userStatus === 'accepted' || userStatus === 'implementation_ready';
    const acceptedOverWarnings = signedOff && (blockingCount > 0 || reviewCount > 0);
    const checklist = signals.reviewMeta?.checklist ?? {};
    const checked = CHECKLIST_ITEM_KEYS.filter(k => checklist[k] === true).length;
    return {
        userStatus,
        systemReadiness,
        issues,
        blockingCount,
        reviewCount,
        infoCount,
        acceptedOverWarnings,
        freshness: compareReviewFreshness(signals.reviewMeta?.signature, signals.screen),
        checklist,
        checklistProgress: { checked, total: CHECKLIST_ITEM_KEYS.length },
        reviewMeta: signals.reviewMeta,
    };
}

// --- Item-level convenience (view helper) ------------------------------------

export interface BuildReviewModelOptions extends BuildVariantOptions {
    features?: readonly Feature[];
}

/** Compute the review model for a joined ScreenExperienceItem, deriving the
 * mockup/freshness signals from the variant grid so callers don't repeat it.
 * The views (list + detail) use this; pure tests can use buildScreenReviewModel
 * directly with explicit signals. */
export function buildScreenReviewModelForItem(
    item: ScreenExperienceItem,
    options: BuildReviewModelOptions = {},
): ScreenReviewModel {
    const { features, ...variantOptions } = options;
    const variants = buildScreenMockupVariants(item, variantOptions);
    const summary = summarizeScreenVariants(variants);
    const missingRequiredVariants = variants.filter(
        v => v.id !== DEFAULT_VARIANT_ID && v.required && v.status === 'missing',
    ).length;
    const freshness = countVariantFreshness(variants);
    return buildScreenReviewModel({
        screen: item.screen,
        hasMockup: Boolean(item.mockupScreen),
        flowRefCount: item.relatedFlows.length,
        features,
        userStatus: item.edit?.reviewStatus,
        reviewMeta: item.edit?.review,
        mobileMockupMissing: summary.mobileMissing,
        coverageUnknown: summary.coverageUnknown,
        freshnessStale: freshness.stale,
        freshnessUnknown: freshness.unknown,
        decisionsWithoutBranches: countDecisionsWithoutBranches(item),
        missingRequiredVariants,
    });
}

function countVariantFreshness(variants: readonly DerivedMockupVariant[]): { stale: number; unknown: number } {
    let stale = 0;
    let unknown = 0;
    for (const v of variants) {
        if (!v.freshness) continue;
        if (v.freshness.status === 'stale' || v.freshness.status === 'possibly_stale') stale += 1;
        else if (v.freshness.status === 'unknown') unknown += 1;
    }
    return { stale, unknown };
}

/** Options for the whole-index builder: the per-item options plus an optional
 * per-screen generated-variant lookup (mirrors the coverage summary). */
export interface BuildReviewIndexOptions extends Omit<BuildReviewModelOptions, 'generatedVariants'> {
    generatedVariantsByScreen?: (screenId: string) => BuildVariantOptions['generatedVariants'];
}

/** Review model for every screen in the index, keyed by canonical id. */
export function buildScreenReviewIndex(
    index: ScreenExperienceIndex,
    options: BuildReviewIndexOptions = {},
): Map<string, ScreenReviewModel> {
    const { generatedVariantsByScreen, ...itemOptions } = options;
    const out = new Map<string, ScreenReviewModel>();
    for (const item of index.items) {
        out.set(item.id, buildScreenReviewModelForItem(item, {
            ...itemOptions,
            generatedVariants: generatedVariantsByScreen?.(item.id),
        }));
    }
    return out;
}

// --- Status transitions ------------------------------------------------------

/** The transitions the UI offers, given the current user status. A screen with
 * no user status yet behaves like 'draft'. */
export interface ReviewTransitions {
    canAccept: boolean;
    canRequestChanges: boolean;
    canMarkImplementationReady: boolean;
}

export function reviewTransitionsFor(status: ScreenReviewStatus | undefined): ReviewTransitions {
    const s = status ?? 'draft';
    return {
        // Accept is offered from any state except already-accepted.
        canAccept: s !== 'accepted',
        // Request changes is always available (an escape hatch).
        canRequestChanges: true,
        // Implementation-ready is a promotion from accepted (or a direct
        // promotion the UI confirms) — never offered when already there.
        canMarkImplementationReady: s !== 'implementation_ready',
    };
}

/** Whether marking implementation-ready is clean (no blocking issues) — the UI
 * still allows an override with a reason when blockers exist. */
export function canMarkImplementationReadyCleanly(model: ScreenReviewModel): boolean {
    return model.blockingCount === 0;
}

// --- Review freshness (re-review after acceptance) ---------------------------

export type ScreenReviewFreshnessStatus = 'current' | 'outdated' | 'unknown';

export const REVIEW_FRESHNESS_LABELS: Record<ScreenReviewFreshnessStatus, string> = {
    current: 'Review current',
    outdated: 'Review may be outdated',
    unknown: 'Review freshness unknown',
};

/**
 * Compare the signature captured at sign-off against the current screen spec.
 *   - 'unknown'  — no stored signature (never reviewed, or a legacy record).
 *   - 'outdated' — the screen-contract hash moved since sign-off.
 *   - 'current'  — the hash matches; the review still reflects the spec.
 * Mirrors the mockup-freshness ethos: legacy records are NEVER falsely
 * "outdated", and this is a metadata comparison, never a visual check.
 */
export function compareReviewFreshness(
    signature: ScreenReviewSignature | undefined,
    screen: ScreenItem,
): ScreenReviewFreshnessStatus {
    if (!signature?.screenContractHash) return 'unknown';
    return signature.screenContractHash === computeScreenReviewHash(screen) ? 'current' : 'outdated';
}

/** Build the signature to STORE when a screen is accepted / implementation-
 * ready. Uses the same hash as the comparison so storage and comparison can't
 * drift. */
export function buildScreenReviewSignature(
    screen: ScreenItem,
    context: { prdVersionId?: string; screenVersionId?: string; designSystemVersionId?: string } = {},
): ScreenReviewSignature {
    return {
        screenContractHash: computeScreenReviewHash(screen),
        prdVersionId: context.prdVersionId,
        screenVersionId: context.screenVersionId,
        designSystemVersionId: context.designSystemVersionId,
    };
}

// --- Screen-contract hashing (self-contained; mirrors mockupVariantTrust) -----

function canonicalStringify(value: unknown): string {
    if (value === null || value === undefined || typeof value !== 'object') {
        return JSON.stringify(value ?? null);
    }
    if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(',')}]`;
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return `{${keys.map(k => `${JSON.stringify(k)}:${canonicalStringify(obj[k])}`).join(',')}}`;
}

function fnv1a(input: string): string {
    let h = 0x811c9dc5;
    for (let i = 0; i < input.length; i++) {
        h ^= input.charCodeAt(i);
        h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
}

function stableHash(value: unknown): string {
    const canonical = canonicalStringify(value);
    return `${fnv1a(canonical)}${fnv1a(canonical + ':v1')}`;
}

function normalizePriority(priority: ScreenPriority | LegacyScreenPriority): ScreenPriority {
    switch (priority) {
        case 'P0': case 'core': return 'P0';
        case 'P1': case 'secondary': return 'P1';
        case 'P2': case 'supporting': return 'P2';
        case 'P3': return 'P3';
        default: return 'P1';
    }
}

const cleanList = (values: Array<string | undefined | null>): string[] => {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const v of values) {
        const t = v?.trim();
        if (!t) continue;
        const key = t.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(t);
    }
    return out;
};

/**
 * Hash the screen-spec content a reviewer signs off on. Covers the substantive
 * spec fields (purpose, intent, priority, states, navigation, UI regions,
 * risks, acceptance criteria, traceability, handoff) and DELIBERATELY excludes
 * the display-only rename (`name`) and overlay-only fields (notes, review
 * status, variant marks) — so a pure display rename never trips "review
 * outdated", while a spec regeneration or a substantive edit does.
 */
export function computeScreenReviewHash(screen: ScreenItem): string {
    const states = (screen.states ?? []).map(s => ({
        name: s.name ?? '',
        type: s.type ?? null,
        trigger: s.trigger ?? '',
        description: s.description ?? '',
        systemBehavior: s.systemBehavior ?? '',
        required: s.required ?? null,
        needsMockup: s.needsMockup ?? null,
        acceptanceCriteria: cleanList(s.acceptanceCriteria ?? []),
    }));
    const risks = (screen.riskDetails && screen.riskDetails.length > 0)
        ? screen.riskDetails.map(r => ({
            description: r.description ?? '',
            severity: r.severity ?? null,
            proposedHandling: r.proposedHandling ?? '',
        }))
        : cleanList(screen.risks ?? []).map(description => ({ description, severity: null, proposedHandling: '' }));
    const contract = {
        purpose: screen.purpose ?? '',
        userIntent: screen.userIntent ?? '',
        priority: normalizePriority(screen.priority),
        entryPoints: cleanList(screen.entryPoints ?? []),
        exitPaths: (screen.exitPaths ?? []).map(e => ({
            label: e.label ?? '', target: e.target ?? '', condition: e.condition ?? '',
        })),
        coreUIRegions: cleanList([
            ...(screen.coreUIElements ?? []),
            ...(screen.coreUIElements?.length ? [] : (screen.components ?? [])),
        ]),
        outputData: cleanList(screen.outputData ?? []),
        featureRefs: cleanList(screen.featureRefs ?? []),
        acceptanceCriteria: cleanList(screen.acceptanceCriteria ?? []),
        handoff: screen.handoff ? canonicalStringify(screen.handoff) : '',
        states,
        risks,
    };
    return stableHash(contract);
}

// --- Artifact-level readiness gate -------------------------------------------

export interface ScreenArtifactReviewReadiness {
    /** Whether the Screens artifact is ready to inform implementation planning.
     * A readiness gate, NOT a hard lock — the UI stays fully usable either way. */
    ready: boolean;
    totalScreens: number;
    accepted: number;
    implementationReady: number;
    needsReview: number;
    draft: number;
    /** Total blocking issues across all screens. */
    blockers: number;
    /** Total review items across all screens. */
    reviewItems: number;
    p0: {
        total: number;
        /** P0 screens the user has Accepted or marked Implementation ready. */
        signedOff: number;
        /** P0 screens with ≥1 blocking issue. */
        withBlockers: number;
        /** P0 screens the user has not yet Accepted/promoted (draft/needs_review/unset). */
        notSignedOff: Array<{ id: string; name: string }>;
    };
    /** Human-readable "why not ready" reasons (empty when ready). */
    reasons: string[];
    /** One deterministic headline for the panel. */
    message: string;
}

interface ArtifactReadinessScreen {
    id: string;
    name: string;
    isP0: boolean;
    model: ScreenReviewModel;
}

/**
 * Roll the per-screen review models up into the artifact-level gate. P0 screens
 * are the gate: the artifact is ready when every P0 screen is user-signed-off
 * (Accepted or Implementation ready) and no P0 screen carries blocking issues.
 * Everything is advisory — nothing here blocks rendering or generation.
 */
export function buildScreenArtifactReviewReadiness(
    screens: readonly ArtifactReadinessScreen[],
): ScreenArtifactReviewReadiness {
    let accepted = 0;
    let implementationReady = 0;
    let needsReview = 0;
    let draft = 0;
    let blockers = 0;
    let reviewItems = 0;
    let p0Total = 0;
    let p0SignedOff = 0;
    let p0WithBlockers = 0;
    const notSignedOff: Array<{ id: string; name: string }> = [];

    for (const { id, name, isP0: p0, model } of screens) {
        const status = model.userStatus;
        if (status === 'accepted') accepted += 1;
        else if (status === 'implementation_ready') implementationReady += 1;
        else if (status === 'needs_review') needsReview += 1;
        else draft += 1; // unset behaves as draft
        blockers += model.blockingCount;
        reviewItems += model.reviewCount;
        if (p0) {
            p0Total += 1;
            const signedOff = status === 'accepted' || status === 'implementation_ready';
            if (signedOff) p0SignedOff += 1;
            else notSignedOff.push({ id, name });
            if (model.blockingCount > 0) p0WithBlockers += 1;
        }
    }

    const reasons: string[] = [];
    if (notSignedOff.length > 0) {
        reasons.push(notSignedOff.length === 1
            ? '1 P0 screen has not been accepted yet.'
            : `${notSignedOff.length} P0 screens have not been accepted yet.`);
    }
    if (p0WithBlockers > 0) {
        reasons.push(p0WithBlockers === 1
            ? '1 P0 screen has blocking issues.'
            : `${p0WithBlockers} P0 screens have blocking issues.`);
    }
    // No P0 screens at all → nothing to gate on, but we still note it so the
    // panel isn't misleadingly green for an empty/atypical set.
    const ready = p0Total > 0 && notSignedOff.length === 0 && p0WithBlockers === 0;

    let message: string;
    if (screens.length === 0) {
        message = 'No screens to review yet.';
    } else if (ready) {
        message = 'Ready for implementation planning — all P0 screens are accepted and no blocking issues remain.';
    } else if (p0Total === 0) {
        message = 'No P0 screens are marked yet. Set priorities and review the key screens before building.';
    } else {
        message = 'Not ready for implementation planning yet. Review the P0 screens flagged below before using this artifact as the build source.';
    }

    return {
        ready,
        totalScreens: screens.length,
        accepted,
        implementationReady,
        needsReview,
        draft,
        blockers,
        reviewItems,
        p0: { total: p0Total, signedOff: p0SignedOff, withBlockers: p0WithBlockers, notSignedOff },
        reasons,
        message,
    };
}

/** Convenience: build the artifact readiness gate straight from an index +
 * a review-model map. */
export function summarizeArtifactReviewReadiness(
    index: ScreenExperienceIndex,
    models: ReadonlyMap<string, ScreenReviewModel>,
): ScreenArtifactReviewReadiness {
    const screens: ArtifactReadinessScreen[] = index.items.map(item => ({
        id: item.id,
        name: item.screen.name || item.id,
        isP0: isP0(item.screen),
        model: models.get(item.id) ?? EMPTY_REVIEW_MODEL,
    }));
    return buildScreenArtifactReviewReadiness(screens);
}

const EMPTY_REVIEW_MODEL: ScreenReviewModel = {
    systemReadiness: 'ready',
    issues: [],
    blockingCount: 0,
    reviewCount: 0,
    infoCount: 0,
    acceptedOverWarnings: false,
    freshness: 'unknown',
    checklist: {},
    checklistProgress: { checked: 0, total: CHECKLIST_ITEM_KEYS.length },
};
