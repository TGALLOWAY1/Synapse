// Pure, code-level guardrail deciding whether a spine may drive downstream
// artifact/mockup generation. This is defense-in-depth alongside the UI: a
// spine that is safety-blocked, is not the project's latest version, has no
// structured PRD, or is *incomplete* (one or more required PRD sections
// failed) must not silently generate downstream artifacts. Incomplete
// generation is allowed only when the user has explicitly acknowledged the
// degraded state: per run, by the `acknowledgeIncomplete` flag the "Generate
// anyway" confirmation passes; durably, by the `incompleteAcknowledgedAt` that
// same confirmation records on the spine version; or (legacy) by a spine that
// was marked final through the removed Finalize flow.
//
// Kept framework-free and store-free so it is trivially unit-testable.

export type GenerationGateReason = 'blocked' | 'not_latest' | 'no_prd' | 'incomplete_unacknowledged';

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
    /** `SpineVersion.isLatest`. Only an explicit `false` refuses — every real
     * spine carries the flag; a structural test input may omit it. */
    isLatest?: boolean;
    isFinal?: boolean;
    /** The durable "Generate anyway" acknowledgement for this version. */
    incompleteAcknowledgedAt?: number;
    structuredPRD?: unknown;
    safetyReview?: { status?: string } | null;
    generationMeta?: { failedSections?: string[] } | null;
}

/** The spine version carries a durable incomplete-PRD acknowledgement: the
 * "Generate anyway" record, or (legacy) a Finalize commitment. */
export function isIncompleteAcknowledged(
    spine: Pick<SpineGateInput, 'isFinal' | 'incompleteAcknowledgedAt'> | undefined,
): boolean {
    return Boolean(spine?.isFinal || spine?.incompleteAcknowledgedAt);
}

/** True for a spine that is explicitly not the project's latest version. */
export function isHistoricalSpine(spine: Pick<SpineGateInput, 'isLatest'> | undefined): boolean {
    return spine?.isLatest === false;
}

export function evaluateSpineGenerationGate(
    spine: SpineGateInput | undefined,
    options: GenerationGateOptions = {},
): GenerationGateResult {
    const incompleteSections = spine?.generationMeta?.failedSections ?? [];

    if (!spine || spine.safetyReview?.status === 'blocked') {
        return { allowed: false, degraded: false, incompleteSections, reason: 'blocked' };
    }
    // Only the latest PRD may drive generation. A historical spine (one the
    // user selected in History Mode) would otherwise produce outputs that
    // become the project's preferred, "current" versions from an old plan.
    if (isHistoricalSpine(spine)) {
        return { allowed: false, degraded: false, incompleteSections, reason: 'not_latest' };
    }
    if (!spine.structuredPRD) {
        return { allowed: false, degraded: false, incompleteSections, reason: 'no_prd' };
    }

    const incomplete = incompleteSections.length > 0;
    // An incomplete PRD may only generate downstream work when the user has
    // acknowledged it. The explicit "Generate anyway" confirmation passes
    // `acknowledgeIncomplete` for that run AND records
    // `incompleteAcknowledgedAt` on the spine version, so resume, Sync outputs
    // and dependency-graph regeneration keep working for that exact version.
    // `isFinal` is the LEGACY durable record of the same acknowledgement (a
    // partial PRD only reached `isFinal` through the removed Finalize
    // confirmation); nothing sets it any more.
    if (incomplete && !options.acknowledgeIncomplete && !isIncompleteAcknowledged(spine)) {
        return { allowed: false, degraded: true, incompleteSections, reason: 'incomplete_unacknowledged' };
    }

    return { allowed: true, degraded: incomplete, incompleteSections };
}
