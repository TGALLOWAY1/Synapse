// Shared status/confidence vocabularies for the Screens stack (readiness →
// review → downstream impact → handoff → trace bridge → export).
//
// This is a LEAF module: it imports NOTHING from the other screen modules, so
// any of them can import from here without an import cycle. It consolidates
// type/label/rank vocabulary ONLY — no string VALUE changes (these values ride
// in exported markdown/JSON and tests).
//
// Related but DELIBERATELY SEPARATE vocabularies that stay in their own
// modules: SystemReadinessStatus (screenReviewWorkflow) is tied to the
// persisted reviewStatus and must not be merged behaviorally with these.

// --- Trace confidence (5-state) ----------------------------------------------

/**
 * Confidence of a derived/correlated trace, strongest → weakest. Shared by the
 * trace bridge, the implementation handoff, and the export layer. The 3-state
 * `TraceabilityConfidence` (screenReadiness) is an `Extract` of this — a
 * type-level narrowing, NOT a behavioral merge of the two systems.
 */
export type TraceConfidence = 'explicit' | 'strong' | 'weak' | 'estimated' | 'missing';

/** Numeric rank for comparing/rolling up trace confidences (higher = stronger). */
export const TRACE_CONFIDENCE_RANK: Record<TraceConfidence, number> = {
    missing: 0, estimated: 1, weak: 2, strong: 3, explicit: 4,
};

/** Human-readable labels for a trace confidence. */
export const TRACE_CONFIDENCE_LABELS: Record<TraceConfidence, string> = {
    explicit: 'Explicit trace',
    strong: 'Strong match',
    weak: 'Weak match',
    estimated: 'Estimated',
    missing: 'Missing',
};

// --- Handoff readiness (ready / review_recommended / blocked) -----------------

/**
 * Three-state readiness of a per-screen implementation handoff / rollup.
 * Aliased as `ScreenImplementationReadiness` where that name reads better.
 */
export type ScreenHandoffStatus = 'ready' | 'review_recommended' | 'blocked';

// --- Export / preflight status (ready / review_recommended / not_ready) -------

/**
 * Three-state status of the Screens preflight, downstream rollup, and handoff
 * export. Aliased as `ScreensHandoffExportStatus` at the export call sites.
 */
export type ScreensExportStatus = 'ready' | 'review_recommended' | 'not_ready';

/**
 * Map a handoff-readiness status onto the export/preflight vocabulary
 * (`blocked` → `not_ready`; the other two are shared verbatim). Preserves the
 * semantics of the former inline mapping in `deriveScreensExportStatus`.
 */
export function toExportStatus(status: ScreenHandoffStatus): ScreensExportStatus {
    return status === 'blocked' ? 'not_ready' : status;
}
