// Pure, code-level guardrail deciding whether a spine may drive downstream
// artifact/mockup generation. This is defense-in-depth alongside the UI: a
// spine that is safety-blocked, has no structured PRD, or is *incomplete*
// (one or more required PRD sections failed) must not silently generate
// downstream artifacts. Incomplete generation is allowed only when the user
// has explicitly acknowledged the degraded state — surfaced durably by the
// spine being marked final (finalize requires an explicit acknowledgement
// step for a partial PRD) or transiently by an `acknowledgeIncomplete` flag
// passed at the finalize call site.
//
// Kept framework-free and store-free so it is trivially unit-testable.

export type GenerationGateReason = 'blocked' | 'no_prd' | 'incomplete_unacknowledged';

export interface GenerationGateResult {
    allowed: boolean;
    /** True when generation would proceed from an incomplete (partial) PRD. */
    degraded: boolean;
    /** PRD section ids that failed to generate (empty when the PRD is complete). */
    incompleteSections: string[];
    /** Present only when `allowed` is false. */
    reason?: GenerationGateReason;
}

export interface GenerationGateOptions {
    /** Explicit, one-shot user acknowledgement that degraded generation is OK. */
    acknowledgeIncomplete?: boolean;
}

// Minimal structural shape so the gate is testable without a full SpineVersion.
export interface SpineGateInput {
    isFinal?: boolean;
    structuredPRD?: unknown;
    safetyReview?: { status?: string } | null;
    generationMeta?: { failedSections?: string[] } | null;
}

export function evaluateSpineGenerationGate(
    spine: SpineGateInput | undefined,
    options: GenerationGateOptions = {},
): GenerationGateResult {
    const incompleteSections = spine?.generationMeta?.failedSections ?? [];

    if (!spine || spine.safetyReview?.status === 'blocked') {
        return { allowed: false, degraded: false, incompleteSections, reason: 'blocked' };
    }
    if (!spine.structuredPRD) {
        return { allowed: false, degraded: false, incompleteSections, reason: 'no_prd' };
    }

    const incomplete = incompleteSections.length > 0;
    // An incomplete PRD may only generate downstream work when the user has
    // acknowledged it. `isFinal` is the durable record of that acknowledgement
    // (a partial PRD only reaches `isFinal` through the explicit finalize
    // confirmation), so resume/retry after a reload still work.
    if (incomplete && !options.acknowledgeIncomplete && !spine.isFinal) {
        return { allowed: false, degraded: true, incompleteSections, reason: 'incomplete_unacknowledged' };
    }

    return { allowed: true, degraded: incomplete, incompleteSections };
}
