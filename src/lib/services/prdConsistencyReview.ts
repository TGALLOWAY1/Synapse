// Optional final consistency-review pass for the parallel PRD pipeline.
//
// Because sections are generated concurrently (and some without seeing each
// other's output), the merged document can carry small inconsistencies:
// drifting product/feature names, contradictory scope statements, duplicated
// points, or uneven terminology. This pass runs ONE fast-model call over the
// fully-merged PRD and asks the model to reconcile those issues WITHOUT
// removing substantive detail.
//
// It is OFF by default in the pipeline (it adds a model call). Two safety
// properties make it safe to enable:
//   1. It MERGES the revision over the original, so any field the model omits
//      is preserved (never dropped).
//   2. A detail-loss guard discards the entire revision if it would shrink or
//      empty any key content array — a defensive backstop against a model that
//      "summarizes" instead of reconciling.

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

export interface ReviewResult {
    /** The PRD to use downstream (revised when `applied`, else the original). */
    prd: StructuredPRD;
    /** Whether the revision passed the guards and was merged in. */
    applied: boolean;
    /** Short human-readable note about what changed (model-provided, optional). */
    changeLog?: string;
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
    if (!parsed?.prd) {
        return { prd, applied: false };
    }

    // Merge over the original so any omitted field is preserved.
    const revised: StructuredPRD = { ...prd, ...parsed.prd };

    if (losesDetail(prd, revised)) {
        return { prd, applied: false, changeLog: 'discarded: detail-loss guard tripped' };
    }

    return { prd: revised, applied: true, changeLog: parsed.changeLog };
};
