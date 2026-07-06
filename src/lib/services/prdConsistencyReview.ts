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
//   4. Semantic-preservation guards protect facts downstream artifacts rely on:
//      per-feature acceptance criteria and dependency references, safety/privacy
//      restrictions, and entity fields/relationships must not be dropped — any
//      violation discards the revision.
//
// Whenever the model returns a parseable PRD, a deterministic structured diff of
// the attempted change is recorded (even on rejection) for transparency.

import { callGemini, getFastModel } from '../geminiClient';
import type { LlmTraceMeta } from '../trace/traceTypes';
import type { ConsistencyReviewDiff, Feature, StructuredPRD } from '../../types';
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
    | 'detail-loss'           // a key content array materially shrank
    | 'missing-required'      // a required top-level field was emptied/dropped
    | 'feature-ids-changed'   // one or more original feature IDs disappeared
    | 'product-identity-lost' // productName was present originally, now empty
    | 'acceptance-criteria-dropped'  // a feature lost acceptance criteria
    | 'feature-dependencies-dropped' // a feature lost a dependency reference
    | 'safety-weakened'       // a safety/privacy restriction was removed
    | 'entity-detail-dropped'; // an entity lost fields/relationships (or vanished)

export interface ReviewResult {
    /** The PRD to use downstream (revised when `applied`, else the original). */
    prd: StructuredPRD;
    /** Whether the revision passed the guards and was merged in. */
    applied: boolean;
    /** Short human-readable note about what changed (model-provided, optional). */
    changeLog?: string;
    /** Present only when `applied` is false: why the revision was discarded. */
    rejectionReason?: ReviewRejectionReason;
    /**
     * Deterministic diff of what the review attempted (merged PRD → reviewed
     * PRD). Present whenever a parseable PRD came back, even on rejection, so the
     * change is inspectable for transparency/debugging.
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
- Do NOT change any feature "id". Ids are referenced by downstream artifacts; you may reword a feature "name" for consistency but its "id" must stay identical.
- Do NOT drop or shorten any feature's "acceptanceCriteria" or "dependencies". These encode facts downstream artifacts rely on.
- Do NOT remove or weaken any safety, privacy, security, or compliance constraint (in "constraints" or "nonFunctionalRequirements").
- Do NOT drop entity fields, entity relationships, or rename entities in "domainEntities" / "richDataModel".
- Preserve the exact JSON shape and all field names of the input.
- Return ONLY a JSON object with two keys: "prd" (the full corrected PRD, same shape as the input) and "changeLog" (a one-sentence summary of what you reconciled, or "No changes needed").`;

const buildPrompt = (prd: StructuredPRD): string =>
    `${SYSTEM}\n\nHere is the PRD JSON to review:\n\n${JSON.stringify(prd)}`;

const defaultTransport: ConsistencyReviewTransport = ({ prompt, model, traceMeta }) =>
    callGemini('', prompt, {
        responseMimeType: 'application/json',
        responseSchema: reviewResponseSchema,
        model,
        maxOutputTokens: 8192,
        temperature: 0.2,
        topP: 0.9,
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

const normalizeText = (s: string): string => s.toLowerCase().replace(/\s+/g, ' ').trim();

const featureById = (prd: StructuredPRD): Map<string, Feature> =>
    new Map((prd.features ?? []).map(f => [f.id, f]));

/**
 * Per-feature acceptance criteria must not shrink. Downstream artifacts (screen
 * inventory, user flows, tasks) derive testable behavior from these, so a
 * "reconciliation" that quietly drops or merges them is a fact change, not a
 * wording fix. Only features that survive by id are checked (a dropped/renamed
 * id is already caught by `changesFeatureIds`).
 */
const dropsAcceptanceCriteria = (original: StructuredPRD, revised: StructuredPRD): boolean => {
    const revisedMap = featureById(revised);
    for (const f of original.features ?? []) {
        const before = f.acceptanceCriteria?.length ?? 0;
        if (before === 0) continue;
        const rev = revisedMap.get(f.id);
        if (!rev) continue;
        if ((rev.acceptanceCriteria?.length ?? 0) < before) return true;
    }
    return false;
};

/**
 * Explicit feature dependency references must survive. `Feature.dependencies`
 * holds feature ids; dropping one silently breaks the dependency graph used by
 * the implementation plan and traceability checks.
 */
const dropsFeatureDependencies = (original: StructuredPRD, revised: StructuredPRD): boolean => {
    const revisedMap = featureById(revised);
    for (const f of original.features ?? []) {
        const before = f.dependencies ?? [];
        if (before.length === 0) continue;
        const rev = revisedMap.get(f.id);
        if (!rev) continue;
        const after = new Set(rev.dependencies ?? []);
        if (before.some(dep => !after.has(dep))) return true;
    }
    return false;
};

const SAFETY_RE =
    /privacy|security|compliance|gdpr|hipaa|ccpa|pii|encrypt|consent|audit|retention|data protection|soc\s?2|safety|restrict|prohibit|forbid|must not|do not (collect|store|share|retain)|sensitive|medical/i;

const safetyItems = (prd: StructuredPRD): string[] =>
    [...(prd.constraints ?? []), ...(prd.nonFunctionalRequirements ?? [])]
        .filter((x): x is string => typeof x === 'string' && SAFETY_RE.test(x));

/**
 * Safety / privacy / security / compliance restrictions must not be removed or
 * weakened. The merge-over-original preserves an OMITTED constraints array, so
 * this only fires when the model explicitly returns a constraints/NFR list that
 * no longer carries an original safety item (verbatim modulo case/whitespace).
 * Rewording a safety rule is treated as removal (fail-closed → keep merged PRD).
 */
const weakensSafetyRestrictions = (original: StructuredPRD, revised: StructuredPRD): boolean => {
    const before = safetyItems(original);
    if (before.length === 0) return false;
    const corpus = [...(revised.constraints ?? []), ...(revised.nonFunctionalRequirements ?? [])]
        .filter((x): x is string => typeof x === 'string')
        .map(normalizeText)
        .join('  ');
    return before.some(item => !corpus.includes(normalizeText(item)));
};

/**
 * Entity structure must survive. For each `richDataModel` entity the reviewed
 * PRD must keep the entity (by name), keep at least as many fields, and keep
 * every relationship. A dropped entity, field, or relationship silently strips
 * detail the data-model and downstream artifacts depend on. Only enforced when
 * the model actually returned a richDataModel (an omitted one is preserved by
 * the merge).
 */
const dropsEntityDetail = (original: StructuredPRD, revised: StructuredPRD): boolean => {
    const before = original.richDataModel?.entities ?? [];
    if (before.length === 0) return false;
    // Omitted by the model → merge kept the original reference → nothing to check.
    if (revised.richDataModel === original.richDataModel) return false;
    const after = new Map(
        (revised.richDataModel?.entities ?? []).map(e => [normalizeText(e.name), e]),
    );
    for (const e of before) {
        const rev = after.get(normalizeText(e.name));
        if (!rev) return true; // entity dropped or renamed → reference lost
        if ((rev.fields?.length ?? 0) < (e.fields?.length ?? 0)) return true;
        const relBefore = e.relationships ?? [];
        if (relBefore.length > 0) {
            const relAfter = new Set((rev.relationships ?? []).map(normalizeText));
            if (relBefore.some(r => !relAfter.has(normalizeText(r)))) return true;
        }
    }
    return false;
};

/**
 * Deterministic diff of the review's attempted change (merged PRD → reviewed
 * PRD). Never model-authored — safe to surface for transparency. Computed even
 * when the revision is later rejected, so the discarded change is inspectable.
 */
const computeReviewDiff = (
    original: StructuredPRD,
    revised: StructuredPRD,
): ConsistencyReviewDiff => {
    const TOP_LEVEL_FIELDS: Array<keyof StructuredPRD> = [
        'vision', 'coreProblem', 'architecture', 'productName', 'targetUsers',
        'features', 'risks', 'nonFunctionalRequirements', 'constraints',
        'domainEntities', 'userLoops', 'uxPages', 'successMetrics', 'assumptions',
        'risksDetailed', 'roles', 'richDataModel', 'stateMachines',
    ];
    const changedSections: string[] = [];
    for (const key of TOP_LEVEL_FIELDS) {
        if (JSON.stringify(original[key]) !== JSON.stringify(revised[key])) {
            changedSections.push(String(key));
        }
    }

    const revisedMap = featureById(revised);
    const featureRenames: ConsistencyReviewDiff['featureRenames'] = [];
    for (const f of original.features ?? []) {
        const rev = revisedMap.get(f.id);
        if (rev && rev.name !== f.name) {
            featureRenames.push({ id: f.id, from: f.name, to: rev.name });
        }
    }

    const diff: ConsistencyReviewDiff = { changedSections, featureRenames };
    const beforeName = (original.productName ?? '').trim();
    const afterName = (revised.productName ?? '').trim();
    if (beforeName && afterName && beforeName !== afterName) {
        diff.productNameChange = { from: original.productName!, to: revised.productName! };
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
    const transport = options.transport ?? defaultTransport;
    const raw = await transport({ prompt: buildPrompt(prd), model: getFastModel(), traceMeta: options.traceMeta });

    const parsed = parse(raw);
    if (parsed === null) {
        return { prd, applied: false, rejectionReason: 'unparseable' };
    }
    if (!parsed.prd) {
        return { prd, applied: false, rejectionReason: 'no-prd' };
    }

    // Merge over the original so any omitted field is preserved.
    const revised: StructuredPRD = { ...prd, ...parsed.prd };

    // Structured diff of the attempted change — computed up front so it is
    // recorded even when a guard later discards the revision.
    const diff = computeReviewDiff(prd, revised);

    // Conservative acceptance guards — any violation discards the whole
    // revision and keeps the deterministically-merged PRD. Ordered
    // cheapest/broadest first; the first hit is the reported reason.
    const guards: Array<[ReviewRejectionReason, boolean]> = [
        ['detail-loss', losesDetail(prd, revised)],
        ['missing-required', dropsRequiredField(prd, revised)],
        ['feature-ids-changed', changesFeatureIds(prd, revised)],
        ['product-identity-lost', losesProductIdentity(prd, revised)],
        ['acceptance-criteria-dropped', dropsAcceptanceCriteria(prd, revised)],
        ['feature-dependencies-dropped', dropsFeatureDependencies(prd, revised)],
        ['safety-weakened', weakensSafetyRestrictions(prd, revised)],
        ['entity-detail-dropped', dropsEntityDetail(prd, revised)],
    ];
    const failed = guards.find(([, tripped]) => tripped);
    if (failed) {
        const rejectionReason = failed[0];
        return {
            prd,
            applied: false,
            rejectionReason,
            diff: { ...diff, guardsTriggered: [rejectionReason] },
        };
    }

    return { prd: revised, applied: true, changeLog: parsed.changeLog, diff };
};
