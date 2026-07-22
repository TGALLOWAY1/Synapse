// Automatic final consistency-review pass for the parallel PRD pipeline.
//
// Because sections are generated concurrently (and some without seeing each
// other's output), the merged document can carry small inconsistencies:
// drifting product/feature names, contradictory scope statements, duplicated
// points, or uneven terminology. This pass runs ONE fast-model call over the
// fully-merged PRD and asks the model to reconcile those issues WITHOUT
// removing substantive detail.
//
// It runs by DEFAULT in the pipeline and silently — the user is never asked to
// approve ordinary repairs. Several conservative acceptance guards make the
// reviewed PRD safe to substitute for the merged one, and a failed/unsafe
// review is discarded (the merged PRD is kept):
//   1. It MERGES the revision over the original, so any field the model omits
//      is preserved (never dropped).
//   2. A detail-loss guard discards the entire revision if it would shrink or
//      empty any key content array — a defensive backstop against a model that
//      "summarizes" instead of reconciling.
//   3. Required top-level fields must survive, feature IDs must stay stable
//      (downstream artifacts reference them), and product identity must be
//      preserved — any violation discards the revision.

import { callGemini, getFastModel } from '../geminiClient';
import type { LlmTraceMeta } from '../trace/traceTypes';
import type { StructuredPRD, ConsistencyReviewDiff, ConsistencyReviewMeta } from '../../types';
import { repairTruncatedJson } from '../jsonRepair';
import { structuredPRDSchema } from '../schemas/prdSchemas';

// Wrapper schema: the model returns the corrected PRD plus a one-line change
// note. Fields absent from structuredPRDSchema (e.g. implementationPlan) are
// simply not revised — they are preserved via the merge-over-original below.
const reviewResponseSchema = {
    type: 'OBJECT',
    properties: {
        prd: structuredPRDSchema,
        changeLog: { type: 'STRING' },
    },
    required: ['prd'],
};

export type ConsistencyReviewTransport = (input: {
    prompt: string;
    model: string;
    traceMeta?: LlmTraceMeta;
    /** Finish-reason sink — lets the review detect a MAX_TOKENS truncation. */
    onFinish?: (info: { finishReason?: string }) => void;
}) => Promise<string>;

export interface ReviewOptions {
    /** Injectable transport for tests; defaults to a fast-model JSON call. */
    transport?: ConsistencyReviewTransport;
    signal?: AbortSignal;
    /** Developer-only trace enrichment forwarded to the transport. */
    traceMeta?: LlmTraceMeta;
}

/**
 * Why a review revision was discarded (merged PRD kept). Recorded in
 * generation metadata for diagnostics; never surfaced to the user.
 */
export type ReviewRejectionReason =
    | 'no-prd'                // model response carried no `prd` object
    | 'unparseable'           // model response was not valid JSON
    | 'truncated'             // response hit MAX_TOKENS — the echoed PRD is incomplete
    | 'skipped-too-large'     // PRD too large to echo back under the output cap; call skipped (zero spend)
    | 'detail-loss'           // a key content array materially shrank
    | 'missing-required'      // a required top-level field was emptied/dropped
    | 'feature-ids-changed'   // one or more original feature IDs disappeared
    | 'product-identity-lost' // productName was present originally, now empty
    // --- Semantic preservation guards (Phase 3) — reject revisions that would
    // silently change facts downstream artifacts depend on. ---
    | 'feature-acceptance-criteria-lost' // a feature's acceptance/success criteria shrank
    | 'feature-dependencies-lost'        // a feature's dependency id references were dropped
    | 'safety-restriction-lost'          // a safety directive (constraint) was dropped/weakened
    | 'entity-detail-lost';              // entity fields, relationships, or example values dropped

export interface ReviewResult {
    /** The PRD to use downstream (revised when `applied`, else the original). */
    prd: StructuredPRD;
    /** Whether the revision passed the guards and was merged in. */
    applied: boolean;
    /**
     * True when NO model call was made (e.g. the PRD is too large to echo back
     * under the output cap). Distinct from a rejection: nothing was spent and
     * nothing was evaluated. Callers should record the pass as skipped.
     */
    skipped?: boolean;
    /** Short human-readable note about what changed (model-provided, optional). */
    changeLog?: string;
    /** Present only when `applied` is false: why the revision was discarded. */
    rejectionReason?: ReviewRejectionReason;
    /**
     * Compact structured diff of what the review changed (accepted) or attempted
     * to change (rejected). For transparency/debugging — never affects generation.
     */
    diff?: ConsistencyReviewDiff;
}

const SYSTEM = `You are a meticulous product editor performing a final consistency pass on a Product Requirements Document. The PRD was assembled from independently-generated sections, so it may contain inconsistencies.

Reconcile ONLY the following, and change nothing else:
- terminology and phrasing used inconsistently across sections,
- the product name and feature names (make every reference identical),
- contradictory or overlapping scope / assumption statements,
- duplicated points expressed in different sections,
- obvious factual contradictions between sections.

HARD RULES:
- Do NOT remove or summarize substantive detail. Preserve every feature, entity, user loop, page, risk, metric, and plan item. Array lengths must not shrink.
- Do NOT invent new features, entities, or scope.
- Preserve EVERY feature's acceptanceCriteria and successCriteria (do not shorten or drop any).
- Preserve EVERY feature's "dependencies" list verbatim — these are feature-id references other artifacts rely on.
- Preserve EVERY "constraints" entry verbatim — these are safety/privacy/compliance restrictions and must never be dropped or softened.
- Preserve every entity's fields, relationships, and example values.
- Do NOT change any feature "id".
- Preserve the exact JSON shape and all field names of the input.
- Return ONLY a JSON object with two keys: "prd" (the full corrected PRD, same shape as the input) and "changeLog" (a one-sentence summary of what you reconciled, or "No changes needed").`;

const buildPrompt = (prd: StructuredPRD): string =>
    `${SYSTEM}\n\nHere is the PRD JSON to review:\n\n${JSON.stringify(prd)}`;

/**
 * Output cap for the review call. The model must echo the ENTIRE corrected PRD
 * back, so the cap must exceed the serialized PRD size — the old 8192 cap was
 * routinely smaller than the merged PRD it had to return (sections are
 * generated with an 8192 cap EACH), making the pass a structurally guaranteed
 * wasted call on any rich PRD: the reply truncated, then failed its own
 * detail-loss guard.
 */
export const REVIEW_MAX_OUTPUT_TOKENS = 16384;

/**
 * Skip threshold: when the serialized PRD is close to what the output cap can
 * echo back, don't make the call at all — a truncated review is always
 * discarded, so the call would be pure spend. ~4 chars/token for JSON-heavy
 * text, with headroom for the changeLog wrapper and reconciliation edits.
 */
const REVIEW_MAX_PRD_CHARS = Math.floor(REVIEW_MAX_OUTPUT_TOKENS * 4 * 0.85);

const defaultTransport: ConsistencyReviewTransport = ({ prompt, model, traceMeta, onFinish }) =>
    callGemini('', prompt, {
        responseMimeType: 'application/json',
        responseSchema: reviewResponseSchema,
        model,
        maxOutputTokens: REVIEW_MAX_OUTPUT_TOKENS,
        temperature: 0.2,
        topP: 0.9,
        onFinish,
        traceMeta,
    });

const len = (v: unknown): number => (Array.isArray(v) ? v.length : 0);

/**
 * Detail-loss guard. Returns true when `revised` would lose substantive content
 * relative to `original` — any non-empty key array dropping below 70% of its
 * original length (or emptied entirely). Such a revision is discarded.
 */
const losesDetail = (original: StructuredPRD, revised: StructuredPRD): boolean => {
    const arrays: Array<keyof StructuredPRD> = [
        'features', 'targetUsers', 'risks', 'userLoops', 'uxPages',
        'successMetrics', 'assumptions', 'domainEntities', 'risksDetailed',
        'nonFunctionalRequirements', 'constraints',
    ];
    for (const key of arrays) {
        const before = len(original[key]);
        if (before === 0) continue;
        const after = len(revised[key]);
        if (after === 0 || after < Math.ceil(before * 0.7)) return true;
    }
    // Nested entity list inside the rich data model.
    const beforeEntities = original.richDataModel?.entities?.length ?? 0;
    if (beforeEntities > 0) {
        const afterEntities = revised.richDataModel?.entities?.length ?? 0;
        if (afterEntities === 0 || afterEntities < Math.ceil(beforeEntities * 0.7)) return true;
    }
    return false;
};

/**
 * Required top-level fields the reviewed PRD must still carry. Emptying any of
 * these (string blanked, array emptied) makes the PRD unusable, so the revision
 * is discarded. Only enforced when the original actually had the field.
 */
const dropsRequiredField = (original: StructuredPRD, revised: StructuredPRD): boolean => {
    const strings: Array<keyof StructuredPRD> = ['vision', 'coreProblem', 'architecture'];
    for (const key of strings) {
        const before = original[key];
        if (typeof before === 'string' && before.trim().length > 0) {
            const after = revised[key];
            if (typeof after !== 'string' || after.trim().length === 0) return true;
        }
    }
    const arrays: Array<keyof StructuredPRD> = ['targetUsers', 'features', 'risks'];
    for (const key of arrays) {
        if (len(original[key]) > 0 && len(revised[key]) === 0) return true;
    }
    return false;
};

/**
 * Feature IDs must stay stable: downstream artifacts, tasks, and cross-feature
 * dependency references key off `Feature.id`. A revision that renames or drops
 * any original id (even while keeping the count high enough to pass the
 * detail-loss guard) would silently break those references, so it is discarded.
 */
const changesFeatureIds = (original: StructuredPRD, revised: StructuredPRD): boolean => {
    const originalIds = (original.features ?? []).map(f => f.id).filter(Boolean);
    if (originalIds.length === 0) return false;
    const revisedIds = new Set((revised.features ?? []).map(f => f.id).filter(Boolean));
    return originalIds.some(id => !revisedIds.has(id));
};

/**
 * Product identity guard: if the merged PRD named the product, the reviewed one
 * must still name it. The review may canonicalize the name (that is its job),
 * but it must never blank it out.
 */
const losesProductIdentity = (original: StructuredPRD, revised: StructuredPRD): boolean => {
    const before = original.productName;
    if (typeof before !== 'string' || before.trim().length === 0) return false;
    const after = revised.productName;
    return typeof after !== 'string' || after.trim().length === 0;
};

// --- Semantic preservation guards (Phase 3) -----------------------------------
//
// These protect facts that downstream artifacts (screens, data model,
// implementation plan, tasks) consume directly. The consistency review may
// normalize wording, but it must never silently drop or weaken these — so any
// violation discards the whole revision and keeps the deterministically-merged
// PRD. Features and entities are matched by their stable key (feature id /
// entity name); a key that disappears entirely is caught by the earlier
// feature-id / detail-loss guards, so these only inspect surviving items.

/**
 * A feature's acceptance-type checks (acceptanceCriteria, successCriteria) must
 * not shrink. Downstream tasks and validation trace to these, so losing one
 * silently weakens the build contract.
 */
const dropsFeatureAcceptanceCriteria = (original: StructuredPRD, revised: StructuredPRD): boolean => {
    const revisedById = new Map((revised.features ?? []).map(f => [f.id, f]));
    for (const orig of original.features ?? []) {
        const rev = revisedById.get(orig.id);
        if (!rev) continue; // id-drop handled by changesFeatureIds
        if (len(orig.acceptanceCriteria) > 0 && len(rev.acceptanceCriteria) < len(orig.acceptanceCriteria)) return true;
        if (len(orig.successCriteria) > 0 && len(rev.successCriteria) < len(orig.successCriteria)) return true;
    }
    return false;
};

/**
 * A feature's `dependencies` (feature-id references) must be preserved as a
 * superset. These ids drive cross-feature ordering in the implementation plan;
 * dropping one silently breaks the dependency graph.
 */
const dropsFeatureDependencies = (original: StructuredPRD, revised: StructuredPRD): boolean => {
    const revisedById = new Map((revised.features ?? []).map(f => [f.id, f]));
    for (const orig of original.features ?? []) {
        const rev = revisedById.get(orig.id);
        if (!rev) continue;
        const origDeps = (orig.dependencies ?? []).filter(Boolean);
        if (origDeps.length === 0) continue;
        const revDeps = new Set((rev.dependencies ?? []).filter(Boolean));
        if (origDeps.some(d => !revDeps.has(d))) return true;
    }
    return false;
};

/**
 * Safety/privacy/compliance restrictions live in `constraints` (the safety gate
 * injects `allowed_with_restrictions` directives here, and they propagate to
 * every downstream artifact). Every original constraint must survive verbatim —
 * a reworded or dropped restriction is treated as weakening and rejected. When
 * the model omits the field entirely the merge-over-original preserves it, so
 * this only fires when the revision actively replaced constraints with a
 * lossier list.
 */
const weakensSafetyRestrictions = (original: StructuredPRD, revised: StructuredPRD): boolean => {
    const origConstraints = (original.constraints ?? []).filter(Boolean);
    if (origConstraints.length === 0) return false;
    const revConstraints = new Set((revised.constraints ?? []).filter(Boolean));
    return origConstraints.some(c => !revConstraints.has(c));
};

/**
 * Entity structure (rich data-model fields + relationships, and lightweight
 * domain-entity example values) must not be dropped. The data-model artifact
 * and mockup grounding read these; losing a field or relationship silently
 * changes the schema downstream artifacts generate against.
 *
 * Comparisons are by IDENTITY, not count: every original entity (by name) must
 * survive, and every original field (by name) within it must survive. A
 * count-only check would miss (a) dropping one entity out of several while
 * staying above the detail-loss 70% floor, and (b) swapping a field for a
 * different one while keeping the array length. Both silently lose schema facts,
 * so we reject them. This mirrors the feature-id stability guard: entity/field
 * names are the downstream join keys and must stay canonical.
 */
const dropsEntityDetail = (original: StructuredPRD, revised: StructuredPRD): boolean => {
    const origEntities = original.richDataModel?.entities ?? [];
    if (origEntities.length > 0) {
        const revById = new Map((revised.richDataModel?.entities ?? []).map(e => [e.name, e]));
        for (const orig of origEntities) {
            const rev = revById.get(orig.name);
            if (!rev) return true; // an original entity was dropped or renamed
            // Field identity: every original field name must still be present.
            const revFieldNames = new Set((rev.fields ?? []).map(f => f.name).filter(Boolean));
            const origFieldNames = (orig.fields ?? []).map(f => f.name).filter(Boolean);
            if (origFieldNames.some(n => !revFieldNames.has(n))) return true;
            // Relationships preserved as a superset.
            const origRel = (orig.relationships ?? []).filter(Boolean);
            if (origRel.length > 0) {
                const revRel = new Set((rev.relationships ?? []).filter(Boolean));
                if (origRel.some(r => !revRel.has(r))) return true;
            }
        }
    }
    const origDomain = original.domainEntities ?? [];
    if (origDomain.length > 0) {
        const revById = new Map((revised.domainEntities ?? []).map(e => [e.name, e]));
        for (const orig of origDomain) {
            const rev = revById.get(orig.name);
            if (!rev) return true; // an original domain entity was dropped or renamed
            if (len(orig.exampleValues) > 0 && len(rev.exampleValues) < len(orig.exampleValues)) return true;
        }
    }
    return false;
};

/**
 * Run every acceptance guard against the merged-over revision, returning the
 * first violation (or null when the revision is safe to apply). Order is
 * deliberate: cheapest/most-fundamental facts first.
 */
const evaluateGuards = (original: StructuredPRD, revised: StructuredPRD): ReviewRejectionReason | null => {
    if (losesDetail(original, revised)) return 'detail-loss';
    if (dropsRequiredField(original, revised)) return 'missing-required';
    if (changesFeatureIds(original, revised)) return 'feature-ids-changed';
    if (losesProductIdentity(original, revised)) return 'product-identity-lost';
    if (dropsFeatureAcceptanceCriteria(original, revised)) return 'feature-acceptance-criteria-lost';
    if (dropsFeatureDependencies(original, revised)) return 'feature-dependencies-lost';
    if (weakensSafetyRestrictions(original, revised)) return 'safety-restriction-lost';
    if (dropsEntityDetail(original, revised)) return 'entity-detail-lost';
    return null;
};

// --- Structured review diff (Phase 3) -----------------------------------------
//
// A compact, content-free summary of what the review did (or attempted). Used
// for transparency in the version-history UI and for debugging — it never
// affects generation.

// Top-level StructuredPRD keys whose change is worth surfacing in the diff.
const stableStringify = (v: unknown): string => {
    if (v === undefined) return 'undefined';
    return JSON.stringify(v);
};

const computeSectionsChanged = (original: StructuredPRD, revised: StructuredPRD): string[] => {
    const keys = new Set<string>([...Object.keys(original), ...Object.keys(revised)]);
    const changed: string[] = [];
    for (const key of keys) {
        const before = (original as Record<string, unknown>)[key];
        const after = (revised as Record<string, unknown>)[key];
        if (stableStringify(before) !== stableStringify(after)) changed.push(key);
    }
    return changed.sort();
};

const computeFeaturesReworded = (
    original: StructuredPRD,
    revised: StructuredPRD,
): Array<{ id: string; before: string; after: string }> => {
    const revisedById = new Map((revised.features ?? []).map(f => [f.id, f]));
    const out: Array<{ id: string; before: string; after: string }> = [];
    for (const orig of original.features ?? []) {
        const rev = revisedById.get(orig.id);
        if (!rev) continue;
        if (orig.name !== rev.name) out.push({ id: orig.id, before: orig.name, after: rev.name });
    }
    return out;
};

/**
 * Build the structured diff between the original merged PRD and the model's
 * revision. `guards` carries any guard reasons that fired; `outcome` records how
 * the revision was ultimately handled.
 */
const buildReviewDiff = (
    original: StructuredPRD,
    revised: StructuredPRD,
    guards: string[],
    outcome: ConsistencyReviewDiff['outcome'],
): ConsistencyReviewDiff => {
    const diff: ConsistencyReviewDiff = {
        sectionsChanged: computeSectionsChanged(original, revised),
        featuresReworded: computeFeaturesReworded(original, revised),
        guardsTriggered: guards,
        outcome,
    };
    const beforeName = original.productName;
    const afterName = revised.productName;
    if (
        typeof beforeName === 'string' && beforeName.trim().length > 0 &&
        typeof afterName === 'string' && afterName.trim().length > 0 &&
        beforeName !== afterName
    ) {
        diff.productNameChange = { before: beforeName, after: afterName };
    }
    return diff;
};

const parse = (raw: string): { prd?: Partial<StructuredPRD>; changeLog?: string } | null => {
    const tryParse = (s: string) => {
        try {
            return JSON.parse(s) as { prd?: Partial<StructuredPRD>; changeLog?: string };
        } catch {
            return null;
        }
    };
    return tryParse(raw) ?? tryParse(repairTruncatedJson(raw).text);
};

/**
 * Run the consistency-review pass. On any failure, ambiguity, or detail-loss
 * the original PRD is returned with `applied: false` — this is a best-effort
 * polish, never a gate.
 */
export const reviewPrdConsistency = async (
    prd: StructuredPRD,
    options: ReviewOptions = {},
): Promise<ReviewResult> => {
    // Size gate: the review must return the whole corrected PRD, so a PRD that
    // cannot fit under the output cap makes the call a guaranteed waste (the
    // truncated reply is always discarded). Skip it — zero spend.
    const serialized = JSON.stringify(prd);
    if (serialized.length > REVIEW_MAX_PRD_CHARS) {
        return {
            prd,
            applied: false,
            skipped: true,
            rejectionReason: 'skipped-too-large',
        };
    }

    const transport = options.transport ?? defaultTransport;
    let finishReason: string | undefined;
    const raw = await transport({
        prompt: buildPrompt(prd),
        model: getFastModel(),
        traceMeta: options.traceMeta,
        onFinish: (info) => { finishReason = info.finishReason; },
    });

    // A MAX_TOKENS finish means the echoed PRD is incomplete. Reject outright
    // instead of repairing and evaluating a payload that is guaranteed to be
    // missing content (it would only burn the guard pass to reach the same
    // conclusion, or worse, sneak a shrunken PRD past the 70% threshold).
    if (finishReason === 'MAX_TOKENS') {
        return {
            prd,
            applied: false,
            rejectionReason: 'truncated',
            diff: buildReviewDiff(prd, prd, ['truncated'], 'rejected'),
        };
    }

    const parsed = parse(raw);
    if (parsed === null) {
        return {
            prd,
            applied: false,
            rejectionReason: 'unparseable',
            diff: buildReviewDiff(prd, prd, ['unparseable'], 'rejected'),
        };
    }
    if (!parsed.prd) {
        return {
            prd,
            applied: false,
            rejectionReason: 'no-prd',
            diff: buildReviewDiff(prd, prd, ['no-prd'], 'rejected'),
        };
    }

    // Merge over the original so any omitted field is preserved.
    const revised: StructuredPRD = { ...prd, ...parsed.prd };

    // Conservative acceptance guards — any violation discards the whole
    // revision and keeps the deterministically-merged PRD. The diff still
    // records what the model *tried* to change (original vs revised) so the
    // rejection is inspectable.
    const violation = evaluateGuards(prd, revised);
    if (violation) {
        return {
            prd,
            applied: false,
            rejectionReason: violation,
            diff: buildReviewDiff(prd, revised, [violation], 'rejected'),
        };
    }

    return {
        prd: revised,
        applied: true,
        changeLog: parsed.changeLog,
        diff: buildReviewDiff(prd, revised, [], 'accepted'),
    };
};

/**
 * Human-readable one-line summary of a consistency-review outcome for the
 * version-history UI. Pure; returns null when there is nothing worth showing
 * (the pass was skipped, or a legacy meta lacks the record). Transparency only.
 */
export const summarizeConsistencyReview = (meta?: ConsistencyReviewMeta): string | null => {
    if (!meta || !meta.ran) return null;
    const diff = meta.diff;
    if (meta.status === 'applied') {
        const parts: string[] = [];
        const changedCount = diff?.sectionsChanged.length ?? 0;
        if (changedCount > 0) parts.push(`reconciled ${changedCount} section${changedCount === 1 ? '' : 's'}`);
        if (diff?.productNameChange) parts.push(`product name → “${diff.productNameChange.after}”`);
        const reworded = diff?.featuresReworded.length ?? 0;
        if (reworded > 0) parts.push(`renamed ${reworded} feature label${reworded === 1 ? '' : 's'}`);
        return parts.length > 0 ? `Applied (${parts.join('; ')}).` : 'Applied (no material changes).';
    }
    if (meta.status === 'rejected') {
        const reason = meta.rejectionReason ?? diff?.guardsTriggered[0];
        return reason
            ? `Discarded — kept the merged PRD (guard: ${reason}).`
            : 'Discarded — kept the merged PRD.';
    }
    if (meta.status === 'error') return 'Review call failed — kept the merged PRD.';
    return null;
};
