import type { PlanningDecisionOption, PlanningRecommendation, StructuredPRD } from '../../types';
import { callGemini, getStrongModel } from '../geminiClient';
import { isAbortError } from '../concurrency';
import { planningContentHash } from './decisionImpact';

/** Bounded model authoring of 2-3 alternative approaches for one open
 * decision. Output is advisory only: the caller stores it as machine-authored
 * suggestion data and the user remains the sole verdict authority. */

export type DecisionOptionsGenerationRecordInput = {
    id: string;
    type: 'decision' | 'open_question';
    title: string;
    statement: string;
    whyItMatters?: string;
    /** Flat reviewer recommendation carried from the originating finding. */
    recommendation?: string;
    evidence: Array<{ label?: string; excerpt: string }>;
};

export type DecisionOptionsGenerationInput = {
    baselineSpineVersionId: string;
    record: DecisionOptionsGenerationRecordInput;
    structuredPRD: StructuredPRD;
};

export type DecisionOptionsGenerationSuccess = {
    ok: true;
    status: 'complete';
    options: PlanningDecisionOption[];
    recommendation: PlanningRecommendation;
    baselineSpineVersionId: string;
    model: string;
    attempts: number;
};

export type DecisionOptionsGenerationFailureReason =
    | 'invalid_context'
    | 'invalid_response'
    | 'transport_error'
    | 'aborted';

export type DecisionOptionsGenerationFailure = {
    ok: false;
    status: 'failed';
    reason: DecisionOptionsGenerationFailureReason;
    errors: string[];
    attempts: number;
    model: string;
};

export type DecisionOptionsGenerationResult = DecisionOptionsGenerationSuccess | DecisionOptionsGenerationFailure;

export type DecisionOptionsTransportInput = {
    system: string;
    prompt: string;
    schema: object;
    model: string;
    signal?: AbortSignal;
    attempt: number;
    repair?: { previousResponse: string; validationErrors: string[] };
};

export type DecisionOptionsTransport = (input: DecisionOptionsTransportInput) => Promise<string>;

export type DecisionOptionsGenerationOptions = {
    transport?: DecisionOptionsTransport;
    model?: string;
    signal?: AbortSignal;
    /** One repair is the production default; callers may set zero for strict/offline evaluation. */
    maxStructuredRepairAttempts?: number;
};

const TRADEOFF_KINDS = ['benefit', 'cost', 'risk', 'constraint'] as const;
const CONFIDENCES = ['high', 'medium', 'low'] as const;
const MIN_OPTIONS = 2;
const MAX_OPTIONS = 3;

export const decisionOptionsSchema = {
    type: 'OBJECT',
    properties: {
        options: {
            type: 'ARRAY',
            minItems: MIN_OPTIONS,
            maxItems: MAX_OPTIONS,
            items: {
                type: 'OBJECT',
                properties: {
                    label: { type: 'STRING' },
                    description: { type: 'STRING' },
                    tradeoffs: {
                        type: 'ARRAY',
                        maxItems: 4,
                        items: {
                            type: 'OBJECT',
                            properties: {
                                kind: { type: 'STRING', enum: [...TRADEOFF_KINDS] },
                                summary: { type: 'STRING' },
                            },
                            required: ['kind', 'summary'],
                        },
                    },
                },
                required: ['label', 'description', 'tradeoffs'],
            },
        },
        recommendedIndex: { type: 'INTEGER' },
        recommendationSummary: { type: 'STRING' },
        recommendationRationale: { type: 'STRING' },
        recommendationConfidence: { type: 'STRING', enum: [...CONFIDENCES] },
    },
    required: ['options', 'recommendedIndex', 'recommendationSummary', 'recommendationRationale', 'recommendationConfidence'],
};

class DecisionOptionsValidationError extends Error {
    readonly errors: string[];

    constructor(errors: string[]) {
        super(errors.join('; '));
        this.name = 'DecisionOptionsValidationError';
        this.errors = errors;
    }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
    !!value && typeof value === 'object' && !Array.isArray(value);

const nonEmpty = (value: unknown): value is string => typeof value === 'string' && !!value.trim();

function validateInput(input: DecisionOptionsGenerationInput): string[] {
    const errors: string[] = [];
    if (!input.baselineSpineVersionId.trim()) errors.push('baselineSpineVersionId is required.');
    if (!input.record.id.trim()) errors.push('Record id is required.');
    if (!['decision', 'open_question'].includes(input.record.type)) {
        errors.push('Only decision and open-question records support suggested alternatives.');
    }
    if (!input.record.title.trim() && !input.record.statement.trim()) {
        errors.push('The record needs a title or statement to reason about.');
    }
    return errors;
}

/** Compact, deterministic product context. The full PRD never travels: the
 * model only needs enough grounding to keep options inside the product's
 * actual problem, users, and scope. */
function productContext(prd: StructuredPRD): Record<string, unknown> {
    return {
        coreProblem: prd.coreProblem,
        summary: prd.executiveSummary ?? prd.vision,
        targetUsers: (prd.targetUsers ?? []).slice(0, 4),
        constraints: (prd.constraints ?? []).slice(0, 6),
        features: (prd.features ?? []).slice(0, 16).map(feature => ({
            name: feature.name,
            tier: feature.tier,
        })),
    };
}

const SYSTEM = `You are Synapse's bounded decision-alternatives author. For one open product decision, propose the 2-3 strongest distinct approaches so the user can choose deliberately.

Authority and safety rules:
- The user is the decision authority. Your options and recommendation are suggestions and are never treated as the user's answer.
- Ground every option in the supplied decision context and product context. Do not invent project facts, users, constraints, or scope.
- Options must be mutually exclusive answers to this exact decision, not a roadmap of sequential steps and not restatements of each other.
- Each option needs a short distinct label, a concrete description of what the product would do, and honest tradeoffs including at least one cost or risk.
- Recommend exactly one option and explain why in terms of the supplied context. State the recommendation confidence honestly.
- If a reviewer recommendation is supplied, weigh it as context; you may disagree with reasons.
- Do not resolve ambiguity by guessing hidden user intent, and do not broaden the product's scope.
- Return only the schema-conforming JSON object.`;

function buildPrompt(input: DecisionOptionsGenerationInput): string {
    return [
        'Open decision:',
        JSON.stringify({
            title: input.record.title,
            statement: input.record.statement,
            whyItMatters: input.record.whyItMatters,
            reviewerRecommendation: input.record.recommendation,
        }),
        '',
        'Decision evidence from the project:',
        JSON.stringify(input.record.evidence.slice(0, 8)),
        '',
        'Product context:',
        JSON.stringify(productContext(input.structuredPRD)),
        '',
        `Return between ${MIN_OPTIONS} and ${MAX_OPTIONS} options. recommendedIndex is the zero-based index of the single recommended option.`,
        'Every option requires at least one tradeoff whose kind is cost or risk.',
    ].join('\n');
}

const defaultTransport: DecisionOptionsTransport = ({ system, prompt, schema, model, signal, repair }) => {
    const repairBlock = repair ? [
        '',
        'The prior response failed closed validation.',
        `Validation errors: ${repair.validationErrors.join('; ')}`,
        'Return a complete corrected response. Do not add prose or code fences.',
        `Prior response: ${repair.previousResponse}`,
    ].join('\n') : '';
    return callGemini(system, `${prompt}${repairBlock}`, {
        responseMimeType: 'application/json',
        responseSchema: schema,
        model,
        temperature: 0.35,
        topP: 0.9,
        maxOutputTokens: 4096,
        traceMeta: {
            stage: 'Decision Center',
            purpose: 'Suggest decision alternatives',
            artifact: 'decision_option_suggestions',
            inputs: ['Open decision record', 'Grounded decision evidence', 'Compact product context'],
        },
    }, signal);
};

function parseAndValidate(
    raw: string,
    input: DecisionOptionsGenerationInput,
): { options: PlanningDecisionOption[]; recommendation: PlanningRecommendation } {
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { throw new DecisionOptionsValidationError(['Response was not valid JSON.']); }
    if (!isRecord(parsed) || !Array.isArray(parsed.options)) {
        throw new DecisionOptionsValidationError(['Response must contain an options array.']);
    }
    const errors: string[] = [];
    if (parsed.options.length < MIN_OPTIONS || parsed.options.length > MAX_OPTIONS) {
        errors.push(`Between ${MIN_OPTIONS} and ${MAX_OPTIONS} options are required.`);
    }
    const seenLabels = new Set<string>();
    const options: PlanningDecisionOption[] = [];
    for (let index = 0; index < parsed.options.length; index += 1) {
        const rawOption = parsed.options[index];
        if (!isRecord(rawOption)) { errors.push(`options[${index}] must be an object.`); continue; }
        const label = nonEmpty(rawOption.label) ? rawOption.label.trim() : '';
        const description = nonEmpty(rawOption.description) ? rawOption.description.trim() : '';
        if (!label || label.length > 120) errors.push(`options[${index}] requires a short non-empty label.`);
        if (!description) errors.push(`options[${index}] requires a concrete description.`);
        const labelKey = label.toLowerCase();
        if (labelKey && seenLabels.has(labelKey)) errors.push(`options[${index}] duplicates another option label.`);
        seenLabels.add(labelKey);
        const rawTradeoffs = Array.isArray(rawOption.tradeoffs) ? rawOption.tradeoffs : [];
        const tradeoffs: NonNullable<PlanningDecisionOption['tradeoffs']> = [];
        for (const rawTradeoff of rawTradeoffs.slice(0, 4)) {
            if (!isRecord(rawTradeoff)) continue;
            const kind = rawTradeoff.kind;
            if (typeof kind !== 'string' || !TRADEOFF_KINDS.includes(kind as typeof TRADEOFF_KINDS[number])) {
                errors.push(`options[${index}] has a tradeoff with an invalid kind.`);
                continue;
            }
            if (!nonEmpty(rawTradeoff.summary)) {
                errors.push(`options[${index}] has a tradeoff without a summary.`);
                continue;
            }
            tradeoffs.push({ kind: kind as typeof TRADEOFF_KINDS[number], summary: rawTradeoff.summary.trim() });
        }
        if (!tradeoffs.some(item => item.kind === 'cost' || item.kind === 'risk')) {
            errors.push(`options[${index}] must acknowledge at least one cost or risk.`);
        }
        options.push({
            id: `option-${planningContentHash(`${input.record.id}:${labelKey}`)}`,
            label,
            description,
            tradeoffs,
        });
    }
    const recommendedIndex = parsed.recommendedIndex;
    if (typeof recommendedIndex !== 'number' || !Number.isInteger(recommendedIndex)
        || recommendedIndex < 0 || recommendedIndex >= options.length) {
        errors.push('recommendedIndex must reference one of the returned options.');
    }
    if (!nonEmpty(parsed.recommendationSummary)) errors.push('A recommendation summary is required.');
    if (!nonEmpty(parsed.recommendationRationale)) errors.push('A recommendation rationale is required.');
    const confidence = parsed.recommendationConfidence;
    if (typeof confidence !== 'string' || !CONFIDENCES.includes(confidence as typeof CONFIDENCES[number])) {
        errors.push('recommendationConfidence must be high, medium, or low.');
    }
    if (errors.length) throw new DecisionOptionsValidationError(errors);
    return {
        options,
        recommendation: {
            optionId: options[recommendedIndex as number].id,
            summary: (parsed.recommendationSummary as string).trim(),
            rationale: (parsed.recommendationRationale as string).trim(),
            confidence: confidence as typeof CONFIDENCES[number],
        },
    };
}

/**
 * Read-only model reasoning. This function never imports the project store and
 * never writes a verdict; the caller stores the result as advisory suggestion
 * data through the guarded store action.
 */
export async function generateDecisionOptions(
    input: DecisionOptionsGenerationInput,
    options: DecisionOptionsGenerationOptions = {},
): Promise<DecisionOptionsGenerationResult> {
    const model = options.model ?? getStrongModel();
    const contextErrors = validateInput(input);
    if (contextErrors.length) {
        return { ok: false, status: 'failed', reason: 'invalid_context', errors: contextErrors, attempts: 0, model };
    }
    const prompt = buildPrompt(input);
    const transport = options.transport ?? defaultTransport;
    const maxRepairs = Math.max(0, Math.min(1, options.maxStructuredRepairAttempts ?? 1));
    let previousResponse = '';
    let validationErrors: string[] = [];
    for (let attempt = 1; attempt <= maxRepairs + 1; attempt += 1) {
        if (options.signal?.aborted) {
            return { ok: false, status: 'failed', reason: 'aborted', errors: ['Suggestion was cancelled.'], attempts: attempt - 1, model };
        }
        try {
            const raw = await transport({
                system: SYSTEM,
                prompt,
                schema: decisionOptionsSchema,
                model,
                signal: options.signal,
                attempt,
                repair: attempt > 1 ? { previousResponse, validationErrors } : undefined,
            });
            previousResponse = raw;
            try {
                const parsed = parseAndValidate(raw, input);
                return {
                    ok: true,
                    status: 'complete',
                    options: parsed.options,
                    recommendation: parsed.recommendation,
                    baselineSpineVersionId: input.baselineSpineVersionId,
                    model,
                    attempts: attempt,
                };
            } catch (error) {
                if (!(error instanceof DecisionOptionsValidationError)) throw error;
                validationErrors = error.errors;
                if (attempt <= maxRepairs) continue;
                return { ok: false, status: 'failed', reason: 'invalid_response', errors: validationErrors, attempts: attempt, model };
            }
        } catch (error) {
            if (options.signal?.aborted || isAbortError(error)) {
                return { ok: false, status: 'failed', reason: 'aborted', errors: ['Suggestion was cancelled.'], attempts: attempt, model };
            }
            return {
                ok: false,
                status: 'failed',
                reason: 'transport_error',
                errors: [error instanceof Error ? error.message : String(error)],
                attempts: attempt,
                model,
            };
        }
    }
    return { ok: false, status: 'failed', reason: 'invalid_response', errors: validationErrors, attempts: maxRepairs + 1, model };
}
