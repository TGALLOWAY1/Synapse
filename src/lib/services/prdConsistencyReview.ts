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
import type { StructuredPRD } from '../../types';
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
}) => Promise<string>;

export interface ReviewOptions {
    /** Injectable transport for tests; defaults to a fast-model JSON call. */
    transport?: ConsistencyReviewTransport;
    signal?: AbortSignal;
}

/**
 * Why a review revision was discarded (merged PRD kept). Recorded in
 * generation metadata for diagnostics; never surfaced to the user.
 */
export type ReviewRejectionReason =
    | 'no-prd'                // model response carried no `prd` object
    | 'unparseable'           // model response was not valid JSON
    | 'detail-loss'           // a key content array materially shrank
    | 'missing-required'      // a required top-level field was emptied/dropped
    | 'feature-ids-changed'   // one or more original feature IDs disappeared
    | 'product-identity-lost'; // productName was present originally, now empty

export interface ReviewResult {
    /** The PRD to use downstream (revised when `applied`, else the original). */
    prd: StructuredPRD;
    /** Whether the revision passed the guards and was merged in. */
    applied: boolean;
    /** Short human-readable note about what changed (model-provided, optional). */
    changeLog?: string;
    /** Present only when `applied` is false: why the revision was discarded. */
    rejectionReason?: ReviewRejectionReason;
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
- Preserve the exact JSON shape and all field names of the input.
- Return ONLY a JSON object with two keys: "prd" (the full corrected PRD, same shape as the input) and "changeLog" (a one-sentence summary of what you reconciled, or "No changes needed").`;

const buildPrompt = (prd: StructuredPRD): string =>
    `${SYSTEM}\n\nHere is the PRD JSON to review:\n\n${JSON.stringify(prd)}`;

const defaultTransport: ConsistencyReviewTransport = ({ prompt, model }) =>
    callGemini('', prompt, {
        responseMimeType: 'application/json',
        responseSchema: reviewResponseSchema,
        model,
        maxOutputTokens: 8192,
        temperature: 0.2,
        topP: 0.9,
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
    const transport = options.transport ?? defaultTransport;
    const raw = await transport({ prompt: buildPrompt(prd), model: getFastModel() });

    const parsed = parse(raw);
    if (parsed === null) {
        return { prd, applied: false, rejectionReason: 'unparseable' };
    }
    if (!parsed.prd) {
        return { prd, applied: false, rejectionReason: 'no-prd' };
    }

    // Merge over the original so any omitted field is preserved.
    const revised: StructuredPRD = { ...prd, ...parsed.prd };

    // Conservative acceptance guards — any violation discards the whole
    // revision and keeps the deterministically-merged PRD.
    if (losesDetail(prd, revised)) {
        return { prd, applied: false, rejectionReason: 'detail-loss' };
    }
    if (dropsRequiredField(prd, revised)) {
        return { prd, applied: false, rejectionReason: 'missing-required' };
    }
    if (changesFeatureIds(prd, revised)) {
        return { prd, applied: false, rejectionReason: 'feature-ids-changed' };
    }
    if (losesProductIdentity(prd, revised)) {
        return { prd, applied: false, rejectionReason: 'product-identity-lost' };
    }

    return { prd: revised, applied: true, changeLog: parsed.changeLog };
};
