// Phase 4B: downstream impact tracking + Screens implementation preflight.
//
// Phase 4A gave each screen a review workflow (user sign-off vs. system
// readiness) and an artifact-level readiness gate. Phase 4B layers ON TOP of
// that (and NEVER changes it): when an accepted screen changes after sign-off,
// or a P0 screen carries blockers, or its mockups read stale, downstream
// artifacts (mockups, data model, implementation plan, …) may now be worth
// re-checking. This module derives — purely, at read time, from already-computed
// review models — *which* downstream artifacts are impacted and *how urgently*,
// rolls that up to an artifact-level "downstream readiness" verdict, and
// assembles a lightweight implementation/export preflight.
//
// It is PURE (no store, no IDB, no React, no LLM) and DERIVED (nothing here is
// persisted — a stale persisted verdict would be worse than none). Honesty
// rules mirror the rest of the Screens layer: everything is an estimate; legacy
// metadata is INFO, never a blocker; language stays calm and actionable
// ("Review recommended", "Changed after sign-off"), never punitive.

import type { ScreenItem } from '../types';
import type { ScreenExperienceIndex, ScreenExperienceItem } from './screenExperience';
import type { ScreenReviewStatus } from './screenReadiness';
import type {
    ScreenArtifactReviewReadiness, ScreenReviewFreshnessStatus, ScreenReviewModel,
} from './screenReviewWorkflow';

// --- Types -------------------------------------------------------------------

export type DownstreamArtifactKind =
    | 'mockups'
    | 'data_model'
    | 'implementation_plan'
    | 'prompt_pack'
    | 'user_flows'
    | 'design_system'
    | 'export';

export type DownstreamImpactSeverity = 'blocking' | 'review' | 'info';

export interface DownstreamArtifactImpact {
    kind: DownstreamArtifactKind;
    severity: DownstreamImpactSeverity;
    /** Short calm headline. */
    title: string;
    /** One-sentence explanation. */
    description: string;
    /** What the user could do about it, when there's a clear next step. */
    recommendedAction?: string;
    /** Supporting detail (e.g. the blocking issue titles). */
    evidence?: string[];
}

export interface ScreenDownstreamImpact {
    screenId: string;
    screenTitle?: string;
    isP0: boolean;
    userStatus?: ScreenReviewStatus;
    reviewFreshness: ScreenReviewFreshnessStatus;
    impactedArtifacts: DownstreamArtifactImpact[];
    summary: {
        hasBlockingImpact: boolean;
        reviewCount: number;
        infoCount: number;
    };
}

/** Everything `buildScreenDownstreamImpact` needs, decoupled from the review
 * model so pure tests can pass explicit signals. */
export interface DownstreamScreenInput {
    screenId: string;
    title: string;
    isP0: boolean;
    /** User review status (accepted / implementation_ready = signed off). */
    userStatus?: ScreenReviewStatus;
    /** Re-review freshness vs. the sign-off signature (Phase 4A). */
    reviewFreshness: ScreenReviewFreshnessStatus;
    /** Blocking readiness issues on this screen. */
    blockingCount: number;
    /** Titles of the blocking readiness issues (for evidence / preflight). */
    blockingTitles: string[];
    /** A generated mockup variant reads stale / possibly-stale (Phase 3C). */
    mockupFreshnessStale: boolean;
    /** A generated mockup variant has no freshness metadata (legacy). */
    mockupFreshnessUnknown: boolean;
    /** The screen carries data requirements (outputData / handoff data deps),
     * so a change to it may ripple into the data model. */
    hasDataRequirements: boolean;
}

export interface ScreensDownstreamImpactRollup {
    totalImpactedScreens: number;
    impactedP0Screens: number;
    byArtifact: Record<DownstreamArtifactKind, { blocking: number; review: number; info: number }>;
    recommendedNextActions: string[];
    overallStatus: 'ready' | 'review_recommended' | 'not_ready';
}

export interface ScreensPreflightModel {
    status: 'ready' | 'review_recommended' | 'not_ready';
    headline: string;
    /** Must-fix items before this artifact is a safe build source. */
    blocking: string[];
    /** Review-recommended items — safe to proceed, worth a look. */
    review: string[];
    /** Informational notes (legacy metadata, unknown freshness). */
    info: string[];
    /** Short prioritized next steps (top 3–5). */
    recommendedNextActions: string[];
    /** Export / snapshot caveats (e.g. Phase 3D sync gap). */
    caveats: string[];
}

export interface ScreensDownstreamAnalysis {
    inputs: DownstreamScreenInput[];
    impactsByScreen: Map<string, ScreenDownstreamImpact>;
    rollup: ScreensDownstreamImpactRollup;
    preflight: ScreensPreflightModel;
}

/**
 * Extra preflight items contributed by a higher layer (Phase 5A implementation
 * handoff). Kept structural — screenDownstreamImpact never imports the handoff
 * module (that would cycle), so the caller passes this in. All fields optional.
 */
export interface PreflightContribution {
    blocking?: readonly string[];
    review?: readonly string[];
    info?: readonly string[];
    recommendedNextActions?: readonly string[];
}

// --- Helpers -----------------------------------------------------------------

const isSignedOff = (status: ScreenReviewStatus | undefined): boolean =>
    status === 'accepted' || status === 'implementation_ready';

const SEVERITY_RANK: Record<DownstreamImpactSeverity, number> = { info: 0, review: 1, blocking: 2 };

const ALL_ARTIFACT_KINDS: DownstreamArtifactKind[] = [
    'mockups', 'data_model', 'implementation_plan', 'prompt_pack', 'user_flows', 'design_system', 'export',
];

function screenHasDataRequirements(screen: ScreenItem): boolean {
    if ((screen.outputData?.length ?? 0) > 0) return true;
    const h = screen.handoff;
    return Boolean(
        (h?.dataDependencies?.length ?? 0) > 0
        || (h?.apiDependencies?.length ?? 0) > 0
        || (h?.stateVariables?.length ?? 0) > 0,
    );
}

const isP0Screen = (screen: ScreenItem): boolean =>
    screen.priority === 'P0' || screen.priority === 'core';

/** Derive the downstream-impact signals for one screen from its review model. */
export function screenDownstreamInputFromModel(
    item: ScreenExperienceItem,
    model: ScreenReviewModel,
): DownstreamScreenInput {
    const blockingTitles = model.issues.filter(i => i.severity === 'blocking').map(i => i.title);
    return {
        screenId: item.id,
        title: item.screen.name || item.id,
        isP0: isP0Screen(item.screen),
        userStatus: model.userStatus,
        reviewFreshness: model.freshness,
        blockingCount: model.blockingCount,
        blockingTitles,
        mockupFreshnessStale: model.issues.some(i => i.id === 'mockup_freshness_stale'),
        mockupFreshnessUnknown: model.issues.some(i => i.id === 'mockup_freshness_unknown'),
        hasDataRequirements: screenHasDataRequirements(item.screen),
    };
}

// --- Per-screen impact -------------------------------------------------------

/**
 * Derive the downstream artifacts a screen change (or its blockers) may have
 * invalidated. Conservative and explainable — only the accepted/implementation-
 * ready + changed, P0-blocker, and mockup-freshness rules fire. Unknown/legacy
 * metadata is always INFO. One entry per artifact kind (highest severity wins).
 */
export function buildScreenDownstreamImpact(input: DownstreamScreenInput): ScreenDownstreamImpact {
    const signedOff = isSignedOff(input.userStatus);
    const changedAfterSignOff = signedOff && input.reviewFreshness === 'outdated';

    const candidates: DownstreamArtifactImpact[] = [];

    // Rule 2 first so it wins the implementation_plan tie when P0 blockers exist
    // (a more accurate message than the generic "may be out of date").
    if (input.isP0 && input.blockingCount > 0) {
        candidates.push({
            kind: 'implementation_plan',
            severity: 'blocking',
            title: 'P0 screen has unresolved blockers',
            description: 'This P0 screen has unresolved readiness blockers, so it is not a safe build source yet.',
            recommendedAction: 'Resolve the blockers before using this screen as a build source.',
            evidence: input.blockingTitles.length > 0 ? input.blockingTitles : undefined,
        });
    }

    if (changedAfterSignOff) {
        // Implementation Plan — blocking when a P0 screen was already marked
        // implementation-ready (build tasks likely exist against the old spec).
        const implBlocking = input.isP0 && input.userStatus === 'implementation_ready';
        candidates.push({
            kind: 'implementation_plan',
            severity: implBlocking ? 'blocking' : 'review',
            title: 'Implementation tasks may be out of date',
            description: 'This screen changed after approval, so implementation tasks may reference the older accepted screen.',
            recommendedAction: 'Review implementation tasks for this screen before building.',
        });
        // Mockups.
        candidates.push({
            kind: 'mockups',
            severity: 'review',
            title: 'Mockups may not match this screen',
            description: 'This screen changed after approval. Existing mockups may no longer match the accepted screen spec.',
            recommendedAction: 'Review mockup variants and regenerate stale or mismatched variants.',
        });
        // Data Model — only when the screen actually carries data requirements.
        if (input.hasDataRequirements) {
            candidates.push({
                kind: 'data_model',
                severity: 'review',
                title: 'Screen data requirements may have changed',
                description: 'Inputs, outputs, or data assumptions for this screen may have changed since it was approved.',
                recommendedAction: 'Review related entities, fields, and API assumptions.',
            });
        }
        // Prompt Pack (legacy artifact) — informational.
        candidates.push({
            kind: 'prompt_pack',
            severity: 'info',
            title: 'Prompts may reference the old behavior',
            description: 'Prompts may still reference the previous screen behavior.',
            recommendedAction: 'Review the prompt pack if this screen affects generation or user-facing AI behavior.',
        });
    }

    // Rule 3 — stale mockup variants (independent of a review change).
    if (input.mockupFreshnessStale) {
        candidates.push({
            kind: 'mockups',
            severity: 'review',
            title: 'Mockup variants may be stale',
            description: 'One or more generated mockup variants predate a change to the screen spec, design system, or PRD.',
            recommendedAction: 'Review stale variants or regenerate the affected mockups.',
        });
    }

    // Rule 4 — unknown mockup freshness (legacy metadata) → INFO, never a blocker.
    if (input.mockupFreshnessUnknown) {
        candidates.push({
            kind: 'mockups',
            severity: 'info',
            title: 'Mockup freshness unknown',
            description: 'Some mockups were generated before Synapse tracked PRD versions. Review them visually if this screen is implementation-critical.',
        });
    }

    // Reduce to one entry per artifact kind, keeping the highest severity (ties
    // keep the first pushed — hence the ordering above).
    const byKind = new Map<DownstreamArtifactKind, DownstreamArtifactImpact>();
    for (const c of candidates) {
        const existing = byKind.get(c.kind);
        if (!existing || SEVERITY_RANK[c.severity] > SEVERITY_RANK[existing.severity]) {
            byKind.set(c.kind, c);
        }
    }
    const impactedArtifacts = [...byKind.values()];

    return {
        screenId: input.screenId,
        screenTitle: input.title,
        isP0: input.isP0,
        userStatus: input.userStatus,
        reviewFreshness: input.reviewFreshness,
        impactedArtifacts,
        summary: {
            hasBlockingImpact: impactedArtifacts.some(a => a.severity === 'blocking'),
            reviewCount: impactedArtifacts.filter(a => a.severity === 'review').length,
            infoCount: impactedArtifacts.filter(a => a.severity === 'info').length,
        },
    };
}

// --- Artifact-level rollup ---------------------------------------------------

function emptyByArtifact(): Record<DownstreamArtifactKind, { blocking: number; review: number; info: number }> {
    const out = {} as Record<DownstreamArtifactKind, { blocking: number; review: number; info: number }>;
    for (const k of ALL_ARTIFACT_KINDS) out[k] = { blocking: 0, review: 0, info: 0 };
    return out;
}

/**
 * Roll per-screen impacts up to an artifact-level downstream-readiness verdict.
 *   - not_ready: the Phase 4A gate is not ready, OR any P0 accepted/impl-ready
 *     screen is outdated, OR any P0 screen has a blocking downstream impact.
 *   - review_recommended: no P0 blocker, but there are review-level impacts
 *     (supporting screens outdated, stale/unknown mockups, impl-plan review).
 *   - ready: gate ready, no P0 outdated, no P0 blocking impact, no review impacts.
 * Advisory only — nothing here blocks rendering or generation.
 */
export function buildScreensDownstreamImpactRollup(
    inputs: readonly DownstreamScreenInput[],
    artifactReview?: ScreenArtifactReviewReadiness,
): ScreensDownstreamImpactRollup {
    const byArtifact = emptyByArtifact();
    let totalImpactedScreens = 0;
    let impactedP0Screens = 0;
    let p0Outdated = false;
    let p0BlockingImpact = false;
    let anyReviewImpact = false;

    for (const input of inputs) {
        const impact = buildScreenDownstreamImpact(input);
        if (impact.impactedArtifacts.length === 0) continue;
        totalImpactedScreens += 1;
        if (input.isP0) impactedP0Screens += 1;
        for (const a of impact.impactedArtifacts) byArtifact[a.kind][a.severity] += 1;
        if (impact.summary.reviewCount > 0) anyReviewImpact = true;
        if (input.isP0 && impact.summary.hasBlockingImpact) p0BlockingImpact = true;
        if (input.isP0 && isSignedOff(input.userStatus) && input.reviewFreshness === 'outdated') {
            p0Outdated = true;
        }
    }

    const gateReady = artifactReview?.ready ?? false;
    let overallStatus: ScreensDownstreamImpactRollup['overallStatus'];
    if (!gateReady || p0Outdated || p0BlockingImpact) overallStatus = 'not_ready';
    else if (anyReviewImpact) overallStatus = 'review_recommended';
    else overallStatus = 'ready';

    return {
        totalImpactedScreens,
        impactedP0Screens,
        byArtifact,
        recommendedNextActions: buildRecommendedNextActions(inputs),
        overallStatus,
    };
}

// --- Recommended next actions ------------------------------------------------

/**
 * Turn the review/impact findings into a short prioritized action list.
 * Priority order: P0 blockers → re-review outdated accepted P0 → accept
 * remaining P0 → stale P0 mockups → implementation plan → supporting screens →
 * unknown legacy mockups. Capped to the top 5.
 */
export function buildRecommendedNextActions(inputs: readonly DownstreamScreenInput[]): string[] {
    const actions: string[] = [];
    const push = (a: string) => { if (!actions.includes(a)) actions.push(a); };

    // 1. Fix P0 blockers.
    for (const i of inputs) {
        if (i.isP0 && i.blockingCount > 0) push(`Resolve blockers on ${i.title} before using it as a build source.`);
    }
    // 2. Re-review outdated accepted P0 screens.
    for (const i of inputs) {
        if (i.isP0 && isSignedOff(i.userStatus) && i.reviewFreshness === 'outdated') {
            push(`Review and re-accept ${i.title} because its spec changed after sign-off.`);
        }
    }
    // 3. Accept remaining P0 screens.
    for (const i of inputs) {
        if (i.isP0 && !isSignedOff(i.userStatus)) push(`Accept ${i.title} to sign off this P0 screen.`);
    }
    // 4. Regenerate / review stale P0 mockups.
    for (const i of inputs) {
        if (i.isP0 && i.mockupFreshnessStale) push(`Regenerate stale mockups for ${i.title}.`);
    }
    // 5. Review implementation plan assumptions (once) when any P0 screen changed
    //    after sign-off or carries blockers.
    if (inputs.some(i => i.isP0 && (i.blockingCount > 0
        || (isSignedOff(i.userStatus) && i.reviewFreshness === 'outdated')))) {
        push('Re-run or review the implementation plan after the P0 screens are current.');
    }
    // 6. Review supporting screens changed after sign-off.
    for (const i of inputs) {
        if (!i.isP0 && isSignedOff(i.userStatus) && i.reviewFreshness === 'outdated') {
            push(`Review ${i.title} because it changed after sign-off.`);
        }
    }
    // 7. One deduplicated nudge for pre-version-tracking mockups on P0 screens
    //    (a per-screen sentence here used to repeat itself four times in a row —
    //    audit H3).
    const unknownP0 = inputs.filter(i => i.isP0 && i.mockupFreshnessUnknown).map(i => i.title);
    if (unknownP0.length > 0) {
        const names = unknownP0.length <= 3
            ? unknownP0.join(', ')
            : `${unknownP0.slice(0, 3).join(', ')} and ${unknownP0.length - 3} more`;
        push(`Visually confirm the older mockups on ${names} — they predate PRD version tracking.`);
    }

    return actions.slice(0, 5);
}

// --- Preflight ---------------------------------------------------------------

const PREFLIGHT_HEADLINES: Record<ScreensPreflightModel['status'], string> = {
    ready: 'Ready for implementation planning',
    review_recommended: 'Review recommended before implementation',
    not_ready: 'Not ready for implementation planning',
};

const plural = (n: number, one: string, many = `${one}s`): string => (n === 1 ? one : many);

/**
 * Assemble the Screens implementation/export preflight: blockers, review items,
 * info notes, prioritized next steps, and export/snapshot caveats. Derived live
 * — never persisted. A decision surface, never a hard gate.
 */
export function buildScreensPreflight(
    inputs: readonly DownstreamScreenInput[],
    artifactReview?: ScreenArtifactReviewReadiness,
    handoff?: PreflightContribution,
): ScreensPreflightModel {
    const rollup = buildScreensDownstreamImpactRollup(inputs, artifactReview);
    const blocking: string[] = [];
    const review: string[] = [];
    const info: string[] = [];

    // Blocking — the Phase 4A P0 sign-off gate + P0 readiness blockers.
    if (artifactReview) {
        for (const s of artifactReview.p0.notSignedOff) {
            blocking.push(`${s.name} (P0) is not accepted yet.`);
        }
    }
    for (const i of inputs) {
        if (!i.isP0) continue;
        for (const title of i.blockingTitles) {
            blocking.push(`${i.title}: ${title.toLowerCase()}.`);
        }
        if (isSignedOff(i.userStatus) && i.userStatus === 'implementation_ready' && i.reviewFreshness === 'outdated') {
            blocking.push(`${i.title} was marked ready to build but changed afterwards.`);
        }
    }

    // Review — outdated accepted screens + stale mockups + impl-plan review.
    const outdatedSignedOff = inputs.filter(i => isSignedOff(i.userStatus) && i.reviewFreshness === 'outdated'
        && !(i.isP0 && i.userStatus === 'implementation_ready'));
    if (outdatedSignedOff.length > 0) {
        review.push(`${outdatedSignedOff.length} accepted ${plural(outdatedSignedOff.length, 'screen')} changed after sign-off.`);
    }
    const staleMockups = inputs.filter(i => i.mockupFreshnessStale).length;
    if (staleMockups > 0) {
        review.push(`${staleMockups} ${plural(staleMockups, 'screen')} may have stale mockup variants.`);
    }
    if (rollup.byArtifact.implementation_plan.review > 0 || rollup.byArtifact.implementation_plan.blocking > 0) {
        review.push('Implementation Plan review recommended once the P0 screens are current.');
    }

    // Info — mockups that predate version tracking (plain provenance, not
    // "freshness metadata" jargon).
    const unknownMockups = inputs.filter(i => i.mockupFreshnessUnknown).length;
    if (unknownMockups > 0) {
        info.push(`${unknownMockups} ${plural(unknownMockups, 'screen')} have mockups generated before Synapse tracked PRD versions — their sync state can't be confirmed automatically.`);
    }

    // Export / snapshot caveats — Phase 3D: variant images travel in snapshots
    // but do not yet sync across devices.
    const caveats: string[] = [];
    if (staleMockups > 0 || unknownMockups > 0) {
        caveats.push('Generated mockup variant images are saved on this device and in project snapshots, but do not yet sync across devices.');
    }

    // Phase 5A: fold in implementation-handoff contributions (deduped). A
    // handoff blocker pushes the status to not_ready; a handoff review item
    // downgrades a ready status to review_recommended.
    const dedupePush = (target: string[], items?: readonly string[]) => {
        for (const it of items ?? []) if (it && !target.includes(it)) target.push(it);
    };
    dedupePush(blocking, handoff?.blocking);
    dedupePush(review, handoff?.review);
    dedupePush(info, handoff?.info);
    const recommendedNextActions = [...rollup.recommendedNextActions];
    dedupePush(recommendedNextActions, handoff?.recommendedNextActions);

    let status = rollup.overallStatus;
    if ((handoff?.blocking?.length ?? 0) > 0) status = 'not_ready';
    else if (status === 'ready' && (handoff?.review?.length ?? 0) > 0) status = 'review_recommended';

    return {
        status,
        headline: PREFLIGHT_HEADLINES[status],
        blocking,
        review,
        info,
        recommendedNextActions: recommendedNextActions.slice(0, 6),
        caveats,
    };
}

// --- Convenience: whole-index analysis ---------------------------------------

/** Build the full downstream analysis for a Screens index + its review models.
 * The single entry point the workspace calls. */
export function analyzeScreensDownstream(
    index: ScreenExperienceIndex,
    reviewModels: ReadonlyMap<string, ScreenReviewModel>,
    artifactReview?: ScreenArtifactReviewReadiness,
    handoffPreflight?: PreflightContribution,
): ScreensDownstreamAnalysis {
    const inputs: DownstreamScreenInput[] = [];
    const impactsByScreen = new Map<string, ScreenDownstreamImpact>();
    for (const item of index.items) {
        const model = reviewModels.get(item.id);
        if (!model) continue;
        const input = screenDownstreamInputFromModel(item, model);
        inputs.push(input);
        impactsByScreen.set(item.id, buildScreenDownstreamImpact(input));
    }
    return {
        inputs,
        impactsByScreen,
        rollup: buildScreensDownstreamImpactRollup(inputs, artifactReview),
        preflight: buildScreensPreflight(inputs, artifactReview, handoffPreflight),
    };
}
