import type {
    AlignmentProposal,
    AlignmentProposalContract,
    DecisionImpactPreview,
    PlanningAlignmentHint,
    PlanningLocation,
    PlanningRecord,
    StructuredPRD,
} from '../../types';
import { callGemini, getStrongModel } from '../geminiClient';
import { isAbortError } from '../concurrency';
import {
    applyPlanningTargetValue,
    planningContentHash,
    readPlanningTargetValue,
    stablePlanningStringify,
    validateAlignmentProposalContract,
} from './decisionImpact';
import { projectDecision } from './decisionProjection';
import { alignmentContextContentHash, alignmentProposalContentHash } from './proposalIntegrity';

export const COMPLEX_TARGET_KINDS = [
    'requirement',
    'flow_step',
    'behavior',
    'constraint',
    'data_expectation',
    'api_expectation',
    'claim',
] as const;

export type ComplexTargetKind = typeof COMPLEX_TARGET_KINDS[number];
export type ComplexReasoningApplicability = 'applicable' | 'already_aligned' | 'needs_input' | 'not_applicable';
export type ComplexReasoningConfidence = 'high' | 'medium' | 'low';
export type ComplexReasoningEvidenceCharacter = 'direct' | 'supported_inference' | 'plausible_inference';

export type ComplexReasoningCause = {
    id: string;
    kind: 'decision' | 'direct_edit';
    summary: string;
    answer?: string;
    planningRecordId?: string;
    decisionEventId?: string;
    sourceSpineVersionId: string;
};

export type ComplexReasoningEvidence = {
    id: string;
    label?: string;
    sourceType: 'prd' | 'planning_record' | 'decision_event' | 'review';
    sourceId: string;
    sourceVersionId?: string;
    excerpt: string;
    location?: PlanningLocation;
};

export type ComplexReasoningTargetInput = {
    id: string;
    location: PlanningLocation;
};

export type ResolvedComplexReasoningTarget = ComplexReasoningTargetInput & {
    location: PlanningLocation & { kind: ComplexTargetKind; jsonPath: string };
    currentValue: unknown;
    currentValueHash: string;
    evidenceRefId: string;
    leaves: ResolvedComplexReasoningLeaf[];
};

export type ResolvedComplexReasoningLeaf = {
    id: string;
    parentTargetId: string;
    location: PlanningLocation & { kind: ComplexTargetKind; jsonPath: string };
    currentValue: string | number | boolean | null;
    currentValueHash: string;
    evidenceRefId: string;
};

export type ComplexPlanningTargetCandidate = {
    id: string;
    target: ResolvedComplexReasoningLeaf;
    currentValue: string | number | boolean | null;
    cause: ComplexReasoningCause;
    evidence: ComplexReasoningEvidence[];
    reasoning: string;
    confidence: ComplexReasoningConfidence;
    evidenceCharacter: ComplexReasoningEvidenceCharacter;
    applicability: ComplexReasoningApplicability;
    operation?: 'replace' | 'add' | 'remove';
    proposedValue?: unknown;
    proposedSummary?: string;
    ambiguity?: string;
    questions: string[];
};

export type ComplexTargetReasoningSuccess = {
    ok: true;
    status: 'complete';
    baselineSpineVersionId: string;
    baselinePrdHash: string;
    causeId: string;
    model: string;
    attempts: number;
    candidates: ComplexPlanningTargetCandidate[];
};

export type ComplexTargetReasoningFailureReason =
    | 'invalid_context'
    | 'invalid_response'
    | 'transport_error'
    | 'aborted';

export type ComplexTargetReasoningFailure = {
    ok: false;
    status: 'failed';
    reason: ComplexTargetReasoningFailureReason;
    errors: string[];
    attempts: number;
    model: string;
};

export type ComplexTargetReasoningResult = ComplexTargetReasoningSuccess | ComplexTargetReasoningFailure;

export type ComplexTargetReasoningTransportInput = {
    system: string;
    prompt: string;
    schema: object;
    model: string;
    signal?: AbortSignal;
    attempt: number;
    repair?: { previousResponse: string; validationErrors: string[] };
};

export type ComplexTargetReasoningTransport = (input: ComplexTargetReasoningTransportInput) => Promise<string>;

export type ComplexTargetReasoningInput = {
    baselineSpineVersionId: string;
    structuredPRD: StructuredPRD;
    cause: ComplexReasoningCause;
    targets: ComplexReasoningTargetInput[];
    evidence?: ComplexReasoningEvidence[];
    /** Evidence the user explicitly supplied for this interpretation. Every
     * returned candidate must cite it rather than silently ignoring it. */
    requiredEvidenceRefIds?: string[];
};

export type ComplexTargetReasoningOptions = {
    transport?: ComplexTargetReasoningTransport;
    model?: string;
    signal?: AbortSignal;
    /** One repair is the production default; callers may set zero for strict/offline evaluation. */
    maxStructuredRepairAttempts?: number;
};

const APPLICABILITIES: ComplexReasoningApplicability[] = ['applicable', 'already_aligned', 'needs_input', 'not_applicable'];
const CONFIDENCES: ComplexReasoningConfidence[] = ['high', 'medium', 'low'];
const EVIDENCE_CHARACTERS: ComplexReasoningEvidenceCharacter[] = ['direct', 'supported_inference', 'plausible_inference'];
const OPERATIONS = ['replace', 'add', 'remove', 'none'] as const;

/** Broad Phase 1 locations accepted as relevance scopes. The model never gets
 * patch authority over these values; each is expanded into canonical scalar
 * leaves before reasoning. */
export const COMPLEX_REASONING_TARGET_PATHS: Record<ComplexTargetKind, readonly string[]> = {
    requirement: ['$.nonFunctionalRequirements', '$.features.acceptanceCriteria', '$.features.successCriteria', '$.features.uiAcceptanceCriteria'],
    flow_step: ['$.primaryActions', '$.userLoops', '$.uxPages', '$.architectureFlows', '$.stateMachines', '$.jtbd'],
    behavior: ['$.primaryActions', '$.userLoops', '$.uxPages', '$.stateMachines', '$.features.uiAcceptanceCriteria'],
    constraint: ['$.constraints', '$.nonFunctionalRequirements', '$.features.edgeCases', '$.features.failureModes', '$.roles', '$.richDataModel'],
    data_expectation: ['$.domainEntities', '$.richDataModel', '$.roles'],
    api_expectation: ['$.architecture', '$.architectureFlows', '$.nonFunctionalRequirements', '$.constraints'],
    claim: ['$.architecture'],
};

export const complexTargetReasoningSchema = {
    type: 'OBJECT',
    properties: {
        candidates: {
            type: 'ARRAY',
            maxItems: 12,
            items: {
                type: 'OBJECT',
                properties: {
                    targetId: { type: 'STRING' },
                    leafRefId: { type: 'STRING' },
                    currentValueJson: { type: 'STRING' },
                    causeRefId: { type: 'STRING' },
                    evidenceRefIds: { type: 'ARRAY', items: { type: 'STRING' } },
                    applicability: { type: 'STRING', enum: APPLICABILITIES },
                    operation: { type: 'STRING', enum: OPERATIONS },
                    proposedValueJson: { type: 'STRING' },
                    proposedSummary: { type: 'STRING' },
                    reasoning: { type: 'STRING' },
                    confidence: { type: 'STRING', enum: CONFIDENCES },
                    evidenceCharacter: { type: 'STRING', enum: EVIDENCE_CHARACTERS },
                    ambiguity: { type: 'STRING' },
                    questions: { type: 'ARRAY', maxItems: 5, items: { type: 'STRING' } },
                },
                required: [
                    'targetId', 'leafRefId', 'currentValueJson', 'causeRefId', 'evidenceRefIds',
                    'applicability', 'operation', 'proposedValueJson', 'proposedSummary',
                    'reasoning', 'confidence', 'evidenceCharacter', 'ambiguity', 'questions',
                ],
            },
        },
    },
    required: ['candidates'],
};

class ComplexReasoningValidationError extends Error {
    readonly errors: string[];

    constructor(errors: string[]) {
        super(errors.join('; '));
        this.name = 'ComplexReasoningValidationError';
        this.errors = errors;
    }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
    !!value && typeof value === 'object' && !Array.isArray(value);

const nonEmpty = (value: unknown): value is string => typeof value === 'string' && !!value.trim();

const trimStrings = (value: unknown): string[] | undefined => {
    if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) return undefined;
    return [...new Set(value.map(item => item.trim()).filter(Boolean))];
};

const identityFor = (value: unknown): string | undefined => {
    if (!isRecord(value)) return undefined;
    for (const key of ['id', 'name', 'entity', 'role', 'segment']) {
        if (typeof value[key] === 'string' && value[key].trim()) return value[key].trim();
    }
    return undefined;
};

const FORBIDDEN_REASONING_KEYS = new Set([
    // Stable identities and cross-record references are never model-editable.
    'id', 'name', 'entity', 'role', 'segment', 'featureIds', 'dependencies', 'nextStates',
    // User authority and decision-history fields are structurally off limits.
    'confirmed', 'confirmedAt', 'decision', 'decisionNote', 'decidedAt',
    // Schema/provenance fields cannot be changed through product reasoning.
    'schema', 'schemaVersion', 'version', 'createdAt', 'updatedAt',
]);

const unsafePathKey = (key: string): boolean => ['__proto__', 'prototype', 'constructor'].includes(key);

const canonicalTokens = (path: string): Array<string | number> | undefined => {
    if (!path.startsWith('$.')) return undefined;
    const tokens: Array<string | number> = [];
    const source = path.slice(1);
    const pattern = /\.([A-Za-z][A-Za-z0-9]*)|\[(\d+)\]/g;
    let consumed = 0;
    for (const match of source.matchAll(pattern)) {
        if (match.index !== consumed) return undefined;
        if (match[1]) {
            if (unsafePathKey(match[1])) return undefined;
            tokens.push(match[1]);
        } else {
            tokens.push(Number(match[2]));
        }
        consumed = (match.index ?? 0) + match[0].length;
    }
    return consumed === source.length && tokens.length > 0 ? tokens : undefined;
};

const readCanonicalPath = (root: unknown, path: string): { ok: true; value: unknown } | { ok: false } => {
    const pathTokens = canonicalTokens(path);
    if (!pathTokens) return { ok: false };
    let value = root;
    for (const token of pathTokens) {
        if (typeof token === 'number') {
            if (!Array.isArray(value) || token < 0 || token >= value.length) return { ok: false };
            value = value[token];
        } else {
            if (!isRecord(value) || !(token in value)) return { ok: false };
            value = value[token];
        }
    }
    return { ok: true, value };
};

const isScalar = (value: unknown): value is string | number | boolean | null =>
    value === null || ['string', 'number', 'boolean'].includes(typeof value);

function enumerateScalarLeaves(
    value: unknown,
    basePath: string,
    target: ComplexReasoningTargetInput,
): ResolvedComplexReasoningLeaf[] {
    const leaves: ResolvedComplexReasoningLeaf[] = [];
    const walk = (current: unknown, path: string, entityId?: string, label?: string) => {
        if (leaves.length >= 80) return;
        if (isScalar(current)) {
            const id = `leaf-${planningContentHash(`${target.id}:${path}:${entityId ?? ''}`)}`;
            leaves.push({
                id,
                parentTargetId: target.id,
                location: {
                    ...target.location,
                    kind: target.location.kind as ComplexTargetKind,
                    jsonPath: path,
                    entityId: entityId ?? target.location.entityId,
                    label: label ?? target.location.label,
                    excerpt: stablePlanningStringify(current),
                } as ResolvedComplexReasoningLeaf['location'],
                currentValue: current,
                currentValueHash: planningContentHash(current),
                evidenceRefId: `target-leaf:${id}`,
            });
            return;
        }
        if (Array.isArray(current)) {
            current.forEach((item, index) => {
                const identity = identityFor(item);
                walk(item, `${path}[${index}]`, identity ?? entityId, identity ? `${target.location.label}: ${identity}` : `${target.location.label} item ${index + 1}`);
            });
            return;
        }
        if (!isRecord(current)) return;
        const identity = identityFor(current) ?? entityId;
        for (const key of Object.keys(current).sort()) {
            if (unsafePathKey(key) || FORBIDDEN_REASONING_KEYS.has(key)) continue;
            walk(current[key], `${path}.${key}`, identity, identity ? `${target.location.label}: ${identity} ${key}` : `${target.location.label}: ${key}`);
        }
    };
    walk(value, basePath, target.location.entityId, target.location.label);
    return leaves;
}

/** Resolve only explicit, simple JSON paths. No dynamic evaluation or fuzzy lookup. */
export function resolvePlanningLocationValue(
    structuredPRD: StructuredPRD,
    location: PlanningLocation,
): { ok: true; value: unknown; canonicalPath: string } | { ok: false; reason: string } {
    if (!location.jsonPath) return { ok: false, reason: 'Target requires an explicit jsonPath.' };
    if (location.jsonPath.includes('[')) {
        const direct = readCanonicalPath(structuredPRD, location.jsonPath);
        return direct.ok
            ? { ok: true, value: direct.value, canonicalPath: location.jsonPath }
            : { ok: false, reason: `Path ${location.jsonPath} does not resolve to stored plan content.` };
    }
    if (!location.jsonPath.match(/^\$\.[A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z][A-Za-z0-9]*)*$/)) {
        return { ok: false, reason: 'Target requires a safe explicit jsonPath.' };
    }
    const parts = location.jsonPath.slice(2).split('.');
    let value: unknown = structuredPRD;
    let canonicalPath = '$';
    for (let index = 0; index < parts.length; index += 1) {
        if (!isRecord(value)) return { ok: false, reason: `Path ${location.jsonPath} does not resolve to stored plan content.` };
        value = value[parts[index]];
        canonicalPath += `.${parts[index]}`;
        if (Array.isArray(value) && location.entityId) {
            const entityIndex = value.findIndex(item => identityFor(item) === location.entityId);
            if (entityIndex < 0) return { ok: false, reason: `Entity ${location.entityId} was not found at ${location.jsonPath}.` };
            value = value[entityIndex];
            canonicalPath += `[${entityIndex}]`;
        }
    }
    if (value === undefined) return { ok: false, reason: `Path ${location.jsonPath} is missing from the current plan.` };
    return { ok: true, value, canonicalPath };
}

function resolveTargets(input: ComplexTargetReasoningInput): {
    targets: ResolvedComplexReasoningTarget[];
    errors: string[];
} {
    const errors: string[] = [];
    if (input.targets.length === 0) errors.push('At least one target is required.');
    if (input.targets.length > 12) errors.push('At most 12 targets may be reasoned about in one bounded call.');
    const ids = new Set<string>();
    const targets: ResolvedComplexReasoningTarget[] = [];
    for (const target of input.targets) {
        if (!target.id.trim()) { errors.push('Every target requires an id.'); continue; }
        if (ids.has(target.id)) { errors.push(`Duplicate target id: ${target.id}.`); continue; }
        ids.add(target.id);
        if (!COMPLEX_TARGET_KINDS.includes(target.location.kind as ComplexTargetKind)) {
            errors.push(`Target ${target.id} uses unsupported kind ${target.location.kind}.`);
            continue;
        }
        const supportedPaths = COMPLEX_REASONING_TARGET_PATHS[target.location.kind as ComplexTargetKind];
        const broadPath = target.location.jsonPath ?? '';
        if (!supportedPaths.some(path => broadPath === path || broadPath.startsWith(`${path}[`) || broadPath.startsWith(`${path}.`))) {
            errors.push(`Target ${target.id} path ${broadPath || '(missing)'} is not supported for ${target.location.kind} reasoning.`);
            continue;
        }
        const resolved = resolvePlanningLocationValue(input.structuredPRD, target.location);
        if (!resolved.ok) { errors.push(`Target ${target.id}: ${resolved.reason}`); continue; }
        const leaves = enumerateScalarLeaves(resolved.value, resolved.canonicalPath, target);
        if (leaves.length === 0) { errors.push(`Target ${target.id} has no bounded scalar leaves.`); continue; }
        if (leaves.length >= 80) { errors.push(`Target ${target.id} is too broad for one bounded reasoning call.`); continue; }
        targets.push({
            ...target,
            location: target.location as ResolvedComplexReasoningTarget['location'],
            currentValue: resolved.value,
            currentValueHash: planningContentHash(resolved.value),
            evidenceRefId: `target:${target.id}`,
            leaves,
        });
    }
    return { targets, errors };
}

function validateInput(input: ComplexTargetReasoningInput, targets: ResolvedComplexReasoningTarget[]): string[] {
    const errors: string[] = [];
    if (!input.baselineSpineVersionId.trim()) errors.push('baselineSpineVersionId is required.');
    if (!input.cause.id.trim()) errors.push('Cause id is required.');
    if (!input.cause.summary.trim()) errors.push('Cause summary is required.');
    if (!input.cause.sourceSpineVersionId.trim()) errors.push('Cause source spine version is required.');
    if (input.cause.sourceSpineVersionId !== input.baselineSpineVersionId) {
        errors.push('Cause and target reasoning must use the same frozen spine version.');
    }
    const evidenceIds = new Set<string>();
    for (const evidence of input.evidence ?? []) {
        if (!evidence.id.trim() || !evidence.excerpt.trim()) errors.push('Evidence requires an id and excerpt.');
        if (evidenceIds.has(evidence.id)) errors.push(`Duplicate evidence id: ${evidence.id}.`);
        evidenceIds.add(evidence.id);
    }
    for (const requiredId of input.requiredEvidenceRefIds ?? []) {
        if (!evidenceIds.has(requiredId)) errors.push(`Required evidence ${requiredId} was not supplied.`);
    }
    if (targets.length !== input.targets.length) errors.push('Every requested target must resolve exactly.');
    return errors;
}

function contextEvidence(input: ComplexTargetReasoningInput, targets: ResolvedComplexReasoningTarget[]): ComplexReasoningEvidence[] {
    const causeEvidence: ComplexReasoningEvidence = {
        id: `cause:${input.cause.id}`,
        label: input.cause.kind === 'decision' ? 'Confirmed decision' : 'Direct plan edit',
        sourceType: input.cause.kind === 'decision' ? 'decision_event' : 'planning_record',
        sourceId: input.cause.decisionEventId ?? input.cause.planningRecordId ?? input.cause.id,
        excerpt: input.cause.answer ? `${input.cause.summary} Answer: ${input.cause.answer}` : input.cause.summary,
        sourceVersionId: input.cause.sourceSpineVersionId,
    };
    const targetEvidence = targets.flatMap(target => [
        {
            id: target.evidenceRefId,
            label: target.location.label,
            sourceType: 'prd' as const,
            sourceId: input.baselineSpineVersionId,
            excerpt: stablePlanningStringify(target.currentValue),
            location: target.location,
            sourceVersionId: input.baselineSpineVersionId,
        },
        ...target.leaves.map((leaf): ComplexReasoningEvidence => ({
            id: leaf.evidenceRefId,
            label: leaf.location.label,
            sourceType: 'prd',
            sourceId: input.baselineSpineVersionId,
            excerpt: stablePlanningStringify(leaf.currentValue),
            location: leaf.location,
            sourceVersionId: input.baselineSpineVersionId,
        })),
    ]);
    return [causeEvidence, ...targetEvidence, ...(input.evidence ?? [])];
}

const SYSTEM = `You are Synapse's bounded planning-alignment reasoner. Determine how one explicit decision or direct edit applies to the supplied, preselected plan targets.

Authority and safety rules:
- The user-authored cause is authoritative. Your interpretation is not.
- Use only the supplied target IDs, current values, and evidence reference IDs.
- Return exactly one candidate for every target and no other targets.
- Copy currentValueJson exactly from the target context. Do not paraphrase it.
- Cite both the cause evidence and that target's evidence, plus any other evidence you rely on.
- If the evidence does not justify a concrete change, return needs_input with focused questions or not_applicable.
- Use already_aligned when the current value already expresses the cause.
- Do not infer user intent, invent requirements, broaden scope, or resolve ambiguity by guessing.
- Do not claim a proposal is applicable merely because it sounds plausible.
- Classify evidence as direct, supported_inference, or plausible_inference. Plausible inference may identify a review target, but it can never be applicable.
- Return only the schema-conforming JSON object.`;

function buildPrompt(
    input: ComplexTargetReasoningInput,
    targets: ResolvedComplexReasoningTarget[],
    evidence: ComplexReasoningEvidence[],
): string {
    return [
        'Frozen cause:',
        JSON.stringify(input.cause),
        '',
        'Allowed targets:',
        JSON.stringify(targets.map(target => ({
            targetId: target.id,
            location: target.location,
            broadCurrentValueJson: stablePlanningStringify(target.currentValue),
            requiredEvidenceRefId: target.evidenceRefId,
            allowedScalarLeaves: target.leaves.map(leaf => ({
                leafRefId: leaf.id,
                location: leaf.location,
                currentValueJson: stablePlanningStringify(leaf.currentValue),
                requiredEvidenceRefId: leaf.evidenceRefId,
            })),
        }))),
        '',
        'Allowed evidence:',
        JSON.stringify(evidence),
        '',
        `Required causeRefId: cause:${input.cause.id}`,
        `Required user evidence refs: ${JSON.stringify(input.requiredEvidenceRefIds ?? [])}`,
        'Choose exactly one allowed scalar leaf per target. For applicability=applicable, operation must be replace and proposedValueJson must be a same-type scalar JSON value.',
        'Evidence character must be direct, supported_inference, or plausible_inference. plausible_inference cannot be applicability=applicable.',
        'For already_aligned, needs_input, or not_applicable, operation must be none and proposedValueJson must be an empty string.',
    ].join('\n');
}

const defaultTransport: ComplexTargetReasoningTransport = ({ system, prompt, schema, model, signal, repair }) => {
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
        temperature: 0.15,
        topP: 0.85,
        maxOutputTokens: 8192,
        traceMeta: {
            stage: 'Planning Alignment',
            purpose: 'Reason about complex planning targets',
            artifact: 'planning_target_reasoning',
            inputs: ['Frozen decision/edit cause', 'Version-pinned plan targets', 'Grounded evidence references'],
        },
    }, signal);
};

const sameShape = (currentValue: unknown, proposedValue: unknown): boolean => {
    if (Array.isArray(currentValue)) return Array.isArray(proposedValue);
    if (currentValue === null) return proposedValue === null || typeof proposedValue === 'object';
    if (typeof currentValue === 'object') return !!proposedValue && typeof proposedValue === 'object' && !Array.isArray(proposedValue);
    return typeof currentValue === typeof proposedValue;
};

function parseAndValidate(
    raw: string,
    input: ComplexTargetReasoningInput,
    targets: ResolvedComplexReasoningTarget[],
    evidence: ComplexReasoningEvidence[],
): ComplexPlanningTargetCandidate[] {
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { throw new ComplexReasoningValidationError(['Response was not valid JSON.']); }
    if (!isRecord(parsed) || !Array.isArray(parsed.candidates)) {
        throw new ComplexReasoningValidationError(['Response must contain a candidates array.']);
    }
    if (parsed.candidates.length !== targets.length) {
        throw new ComplexReasoningValidationError([`Expected exactly ${targets.length} candidates.`]);
    }
    const targetById = new Map(targets.map(target => [target.id, target]));
    const evidenceById = new Map(evidence.map(item => [item.id, item]));
    const seen = new Set<string>();
    const candidates: ComplexPlanningTargetCandidate[] = [];
    const errors: string[] = [];
    for (let index = 0; index < parsed.candidates.length; index += 1) {
        const rawCandidate = parsed.candidates[index];
        if (!isRecord(rawCandidate)) { errors.push(`candidates[${index}] must be an object.`); continue; }
        const targetId = nonEmpty(rawCandidate.targetId) ? rawCandidate.targetId.trim() : '';
        const target = targetById.get(targetId);
        if (!target) { errors.push(`candidates[${index}] cites an unsupported target.`); continue; }
        if (seen.has(targetId)) { errors.push(`Target ${targetId} was returned more than once.`); continue; }
        seen.add(targetId);
        const leafRefId = nonEmpty(rawCandidate.leafRefId) ? rawCandidate.leafRefId.trim() : '';
        const leaf = target.leaves.find(item => item.id === leafRefId);
        if (!leaf) { errors.push(`Candidate ${targetId} cites an unsupported scalar leaf.`); continue; }
        const contractCurrent = readPlanningTargetValue(input.structuredPRD, leaf.location);
        if (!contractCurrent.found || stablePlanningStringify(contractCurrent.value) !== stablePlanningStringify(leaf.currentValue)) {
            errors.push(`Candidate ${targetId} scalar leaf is not locally materializable.`);
        }
        if (rawCandidate.currentValueJson !== stablePlanningStringify(leaf.currentValue)) {
            errors.push(`Candidate ${targetId} did not cite the exact current target value.`);
        }
        const requiredCauseRef = `cause:${input.cause.id}`;
        if (rawCandidate.causeRefId !== requiredCauseRef) errors.push(`Candidate ${targetId} cites the wrong cause.`);
        const evidenceRefIds = trimStrings(rawCandidate.evidenceRefIds);
        if (!evidenceRefIds) {
            errors.push(`Candidate ${targetId} evidenceRefIds must be strings.`);
            continue;
        }
        if (!evidenceRefIds.includes(requiredCauseRef) || !evidenceRefIds.includes(leaf.evidenceRefId)) {
            errors.push(`Candidate ${targetId} must cite its cause and exact scalar-leaf evidence.`);
        }
        const omittedRequired = (input.requiredEvidenceRefIds ?? []).filter(id => !evidenceRefIds.includes(id));
        if (omittedRequired.length) errors.push(`Candidate ${targetId} omitted required user evidence: ${omittedRequired.join(', ')}.`);
        const unknownEvidence = evidenceRefIds.filter(id => !evidenceById.has(id));
        if (unknownEvidence.length) errors.push(`Candidate ${targetId} cites unsupported evidence: ${unknownEvidence.join(', ')}.`);
        const applicability = rawCandidate.applicability as ComplexReasoningApplicability;
        const confidence = rawCandidate.confidence as ComplexReasoningConfidence;
        const evidenceCharacter = rawCandidate.evidenceCharacter as ComplexReasoningEvidenceCharacter;
        const operation = rawCandidate.operation as typeof OPERATIONS[number];
        const questions = trimStrings(rawCandidate.questions);
        if (!APPLICABILITIES.includes(applicability)) errors.push(`Candidate ${targetId} has invalid applicability.`);
        if (!CONFIDENCES.includes(confidence)) errors.push(`Candidate ${targetId} has invalid confidence.`);
        if (!EVIDENCE_CHARACTERS.includes(evidenceCharacter)) errors.push(`Candidate ${targetId} has invalid evidence character.`);
        if (applicability === 'applicable' && evidenceCharacter === 'plausible_inference') {
            errors.push(`Applicable candidate ${targetId} cannot rely on plausible inference.`);
        }
        if (!OPERATIONS.includes(operation)) errors.push(`Candidate ${targetId} has invalid operation.`);
        if (!questions || questions.length > 5) errors.push(`Candidate ${targetId} has invalid questions.`);
        if (!nonEmpty(rawCandidate.reasoning)) errors.push(`Candidate ${targetId} requires reasoning.`);
        const ambiguity = typeof rawCandidate.ambiguity === 'string' ? rawCandidate.ambiguity.trim() : '';
        const proposedSummary = typeof rawCandidate.proposedSummary === 'string' ? rawCandidate.proposedSummary.trim() : '';
        const proposedValueJson = typeof rawCandidate.proposedValueJson === 'string' ? rawCandidate.proposedValueJson.trim() : '';
        let proposedValue: unknown;
        if (applicability === 'applicable') {
            if (operation !== 'replace') errors.push(`Applicable candidate ${targetId} must be one scalar replace.`);
            if (!proposedSummary) errors.push(`Applicable candidate ${targetId} requires a proposed summary.`);
            try { proposedValue = JSON.parse(proposedValueJson); } catch { errors.push(`Applicable candidate ${targetId} proposedValueJson is invalid.`); }
            if (proposedValue !== undefined && !isScalar(proposedValue)) {
                errors.push(`Applicable candidate ${targetId} proposed a non-scalar value.`);
            }
            if (proposedValue !== undefined && !sameShape(leaf.currentValue, proposedValue)) {
                errors.push(`Applicable candidate ${targetId} changes the target value shape.`);
            }
            if (proposedValue !== undefined && stablePlanningStringify(proposedValue) === stablePlanningStringify(leaf.currentValue)) {
                errors.push(`Applicable candidate ${targetId} does not actually change the target.`);
            }
            if (leaf.location.jsonPath === '$.architecture') {
                errors.push(`Architecture prose ${targetId} requires review rather than a model-authored broad rewrite.`);
            }
            if (proposedValue !== undefined) {
                const applied = applyPlanningTargetValue(input.structuredPRD, leaf.location, proposedValue);
                const appliedValue = applied ? readPlanningTargetValue(applied, leaf.location) : { found: false as const };
                if (!applied || !appliedValue.found || stablePlanningStringify(appliedValue.value) !== stablePlanningStringify(proposedValue)) {
                    errors.push(`Applicable candidate ${targetId} cannot be materialized by the bounded plan contract.`);
                }
            }
            if (ambiguity || (questions?.length ?? 0) > 0) errors.push(`Applicable candidate ${targetId} cannot leave unresolved ambiguity.`);
        } else {
            if (operation !== 'none' || proposedValueJson || proposedSummary) {
                errors.push(`Non-applicable candidate ${targetId} cannot carry a proposed mutation.`);
            }
            if (applicability === 'needs_input' && (!ambiguity || (questions?.length ?? 0) === 0)) {
                errors.push(`Needs-input candidate ${targetId} requires ambiguity and a focused question.`);
            }
            if (applicability !== 'needs_input' && (questions?.length ?? 0) > 0) {
                errors.push(`Candidate ${targetId} asks questions without needs_input applicability.`);
            }
        }
        candidates.push({
            id: `reasoning-${planningContentHash(`${input.baselineSpineVersionId}:${input.cause.id}:${target.id}:${rawCandidate.reasoning}`)}`,
            target: leaf,
            currentValue: leaf.currentValue,
            cause: { ...input.cause },
            evidence: evidenceRefIds.flatMap(id => evidenceById.get(id) ? [evidenceById.get(id)!] : []),
            reasoning: typeof rawCandidate.reasoning === 'string' ? rawCandidate.reasoning.trim() : '',
            confidence,
            evidenceCharacter,
            applicability,
            ...(operation !== 'none' ? { operation } : {}),
            ...(proposedValue !== undefined ? { proposedValue } : {}),
            ...(proposedSummary ? { proposedSummary } : {}),
            ...(ambiguity ? { ambiguity } : {}),
            questions: questions ?? [],
        });
    }
    if (seen.size !== targets.length) errors.push('Every allowed target must have exactly one candidate.');
    if (errors.length) throw new ComplexReasoningValidationError(errors);
    return candidates;
}

/**
 * Bounded, read-only model reasoning. This function never imports the project
 * store, never writes a planning verdict, and returns no directly applicable
 * patch. A caller must separately review and persist any candidate.
 */
export async function reasonAboutComplexPlanningTargets(
    input: ComplexTargetReasoningInput,
    options: ComplexTargetReasoningOptions = {},
): Promise<ComplexTargetReasoningResult> {
    const model = options.model ?? getStrongModel();
    const resolved = resolveTargets(input);
    const contextErrors = [...resolved.errors, ...validateInput(input, resolved.targets)];
    if (contextErrors.length) {
        return { ok: false, status: 'failed', reason: 'invalid_context', errors: [...new Set(contextErrors)], attempts: 0, model };
    }
    const evidence = contextEvidence(input, resolved.targets);
    const prompt = buildPrompt(input, resolved.targets, evidence);
    const transport = options.transport ?? defaultTransport;
    const maxRepairs = Math.max(0, Math.min(1, options.maxStructuredRepairAttempts ?? 1));
    let previousResponse = '';
    let validationErrors: string[] = [];
    for (let attempt = 1; attempt <= maxRepairs + 1; attempt += 1) {
        if (options.signal?.aborted) {
            return { ok: false, status: 'failed', reason: 'aborted', errors: ['Reasoning was cancelled.'], attempts: attempt - 1, model };
        }
        try {
            const raw = await transport({
                system: SYSTEM,
                prompt,
                schema: complexTargetReasoningSchema,
                model,
                signal: options.signal,
                attempt,
                repair: attempt > 1 ? { previousResponse, validationErrors } : undefined,
            });
            previousResponse = raw;
            try {
                const candidates = parseAndValidate(raw, input, resolved.targets, evidence);
                return {
                    ok: true,
                    status: 'complete',
                    baselineSpineVersionId: input.baselineSpineVersionId,
                    baselinePrdHash: planningContentHash(input.structuredPRD),
                    causeId: input.cause.id,
                    model,
                    attempts: attempt,
                    candidates,
                };
            } catch (error) {
                if (!(error instanceof ComplexReasoningValidationError)) throw error;
                validationErrors = error.errors;
                if (attempt <= maxRepairs) continue;
                return { ok: false, status: 'failed', reason: 'invalid_response', errors: validationErrors, attempts: attempt, model };
            }
        } catch (error) {
            if (options.signal?.aborted || isAbortError(error)) {
                return { ok: false, status: 'failed', reason: 'aborted', errors: ['Reasoning was cancelled.'], attempts: attempt, model };
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

/**
 * Safe bridge into Phase 1's impact builder. Only a validated, applicable
 * one-scalar replacement becomes a bounded hint. Every other truthful model
 * outcome remains review-only so the user can confirm or reinterpret it.
 */
export function complexCandidateToAlignmentHint(
    candidate: ComplexPlanningTargetCandidate,
    provenance: { model: string; provider?: string },
): PlanningAlignmentHint | undefined {
    const confidence: PlanningAlignmentHint['confidence'] = candidate.confidence === 'low' ? 'possible' : 'likely';
    const evidenceSummary = candidate.evidence.map(item => `${item.label ?? item.sourceType.replaceAll('_', ' ')}: ${item.excerpt}`);
    if (candidate.applicability === 'already_aligned' || candidate.applicability === 'not_applicable') {
        return {
            target: candidate.target.location,
            operation: 'replace',
            reason: candidate.reasoning,
            confidence,
            reasoningConfidence: candidate.confidence,
            evidenceCharacter: candidate.evidenceCharacter,
            analysisStatus: candidate.applicability,
            analysisMethod: 'model',
            model: provenance.model,
            provider: provenance.provider ?? 'gemini',
            ambiguity: candidate.ambiguity,
            questions: candidate.questions,
            evidenceSummary,
            requiredForVerdictAlignment: false,
        };
    }
    if (candidate.applicability === 'needs_input') {
        const questionText = candidate.questions.length ? ` Questions: ${candidate.questions.join(' ')}` : '';
        return {
            target: candidate.target.location,
            operation: 'replace',
            reason: candidate.reasoning,
            confidence,
            reasoningConfidence: candidate.confidence,
            evidenceCharacter: candidate.evidenceCharacter,
            analysisStatus: 'needs_input',
            analysisMethod: 'model',
            model: provenance.model,
            provider: provenance.provider ?? 'gemini',
            failureReason: `${candidate.ambiguity ?? 'Additional product input is required.'}${questionText}`,
            ambiguity: candidate.ambiguity,
            questions: candidate.questions,
            evidenceSummary,
            requiredForVerdictAlignment: false,
        };
    }
    if (candidate.operation !== 'replace' || candidate.proposedValue === undefined || !isScalar(candidate.proposedValue)) return undefined;
    return {
        target: candidate.target.location,
        operation: 'replace',
        proposedValue: candidate.proposedValue,
        proposedSummary: candidate.proposedSummary,
        reason: candidate.reasoning,
        confidence,
        reasoningConfidence: candidate.confidence,
        evidenceCharacter: candidate.evidenceCharacter,
        analysisStatus: 'bounded_applicable',
        analysisMethod: 'model',
        model: provenance.model,
        provider: provenance.provider ?? 'gemini',
        ambiguity: candidate.ambiguity,
        questions: candidate.questions,
        evidenceSummary,
        requiredForVerdictAlignment: false,
    };
}

export type IntegrateComplexCandidateResult =
    | { ok: true; preview: DecisionImpactPreview; proposalId: string }
    | { ok: false; reason: string };

/**
 * Replaces one existing review target without rebuilding or discarding the
 * rest of the preview. This is a pure transformation: the caller owns all
 * baseline/verdict rechecks and persistence.
 */
export function integrateComplexCandidateIntoPreview(input: {
    preview: DecisionImpactPreview;
    replaceProposalId: string;
    candidate: ComplexPlanningTargetCandidate;
    record: PlanningRecord;
    structuredPRD: StructuredPRD;
    currentSpineVersionId: string;
    model: string;
    provider?: string;
}): IntegrateComplexCandidateResult {
    const prior = input.preview.alignmentProposals?.find(item => item.id === input.replaceProposalId);
    if (!prior) return { ok: false, reason: 'The review target no longer exists.' };
    const latestDisposition = [...(input.record.events ?? [])].reverse().find(event => event.type === 'alignment_change_reviewed'
        && event.impactPreviewId === input.preview.id
        && event.proposalId === input.replaceProposalId);
    if (latestDisposition?.type === 'alignment_change_reviewed'
        && (latestDisposition.disposition === 'accepted' || latestDisposition.disposition === 'edited')) {
        return { ok: false, reason: 'Remove the accepted wording before requesting another interpretation.' };
    }
    const priorPath = prior.target.jsonPath;
    const nextPath = input.candidate.target.location.jsonPath;
    if (!priorPath || !nextPath || !(nextPath === priorPath || nextPath.startsWith(`${priorPath}.`) || nextPath.startsWith(`${priorPath}[`))) {
        return { ok: false, reason: 'The reasoned scalar is outside the original review target.' };
    }
    if (prior.target.entityId && input.candidate.target.location.entityId !== prior.target.entityId) {
        return { ok: false, reason: 'The reasoned scalar belongs to a different plan entity.' };
    }
    if (input.preview.baseline.spineContentHash !== planningContentHash(input.structuredPRD)) {
        return { ok: false, reason: 'The working plan changed after this preview was created.' };
    }
    if (input.preview.baseline.spineVersionId !== input.currentSpineVersionId) {
        return { ok: false, reason: 'The working plan version changed after this preview was created.' };
    }
    if (projectDecision(input.record).latestVerdictEventId !== input.preview.decisionEventId) {
        return { ok: false, reason: 'The decision changed after this preview was created.' };
    }
    const current = readPlanningTargetValue(input.structuredPRD, input.candidate.target.location);
    if (!current.found || stablePlanningStringify(current.value) !== stablePlanningStringify(input.candidate.currentValue)) {
        return { ok: false, reason: 'The reasoned scalar target is no longer current.' };
    }

    const status: AlignmentProposalContract['analysisStatus'] = input.candidate.applicability === 'applicable'
        ? 'bounded_applicable'
        : input.candidate.applicability === 'needs_input'
            ? 'needs_input'
            : input.candidate.applicability === 'already_aligned'
                ? 'already_aligned'
                : 'not_applicable';
    const mask = typeof current.value === 'string'
        ? '__synapse_preserved_target__'
        : typeof current.value === 'number'
            ? 0
            : typeof current.value === 'boolean'
                ? false
                : null;
    const masked = applyPlanningTargetValue(input.structuredPRD, input.candidate.target.location, mask);
    if (!masked) return { ok: false, reason: 'The scalar target is not locally materializable.' };
    const contract: AlignmentProposalContract = {
        version: 1,
        analysisStatus: status,
        authoredBy: 'synapse',
        method: 'model',
        model: input.model,
        provider: input.provider ?? 'gemini',
        baselineSpineVersionId: input.preview.baseline.spineVersionId,
        baselineSpineContentHash: input.preview.baseline.spineContentHash,
        decisionEventId: input.preview.decisionEventId,
        targetValueHash: planningContentHash(current.value),
        preservedContentHash: planningContentHash(masked),
        evidence: [
            ...input.record.evidence.map(evidence => ({
                refId: evidence.id,
                source: 'record_evidence' as const,
                sourceVersionId: evidence.sourceVersionId,
                contentHash: evidence.excerptHash ?? planningContentHash({ locator: evidence.locator, excerpt: evidence.excerpt }),
            })),
            ...(input.record.events ?? []).flatMap(event => (
                event.type === 'alignment_context_provided'
                && input.candidate.evidence.some(evidence => evidence.id === event.id)
                    ? [{
                        refId: event.id,
                        source: 'user_context' as const,
                        sourceVersionId: input.preview.baseline.spineVersionId,
                        contentHash: alignmentContextContentHash(event),
                    }]
                    : []
            )),
        ],
        maxTouchedTargets: 1,
        reasoningConfidence: input.candidate.confidence,
        evidenceCharacter: input.candidate.evidenceCharacter,
        failureReason: input.candidate.applicability === 'needs_input'
            ? input.candidate.ambiguity
            : input.candidate.applicability === 'not_applicable' ? input.candidate.reasoning : undefined,
    };
    const proposalId = `${input.replaceProposalId}-reasoned-${planningContentHash(input.candidate.id)}`;
    const evidenceSummary = input.candidate.evidence.map(item => `${item.label ?? item.sourceType.replaceAll('_', ' ')}: ${item.excerpt}`);
    const applicable = input.candidate.applicability === 'applicable'
        && input.candidate.operation === 'replace'
        && input.candidate.proposedValue !== undefined;
    const unboundProposal: AlignmentProposal = {
        id: proposalId,
        target: input.candidate.target.location,
        operation: applicable ? 'replace' : 'review',
        beforeSummary: stablePlanningStringify(current.value),
        proposedSummary: applicable ? input.candidate.proposedSummary : undefined,
        proposedValue: applicable ? input.candidate.proposedValue : undefined,
        reason: input.candidate.reasoning,
        confidence: input.candidate.confidence === 'low' ? 'possible' : 'likely',
        reasoningConfidence: input.candidate.confidence,
        evidenceCharacter: input.candidate.evidenceCharacter,
        contract,
        requiredForVerdictAlignment: prior.requiredForVerdictAlignment,
        requiresInput: input.candidate.applicability === 'needs_input',
        ambiguity: input.candidate.ambiguity,
        questions: input.candidate.questions,
        evidenceSummary,
    };
    const nextProposal: AlignmentProposal = {
        ...unboundProposal,
        contract: {
            ...contract,
            proposalContentHash: alignmentProposalContentHash(unboundProposal),
        },
    };
    const proposals = (input.preview.alignmentProposals ?? []).map(proposal =>
        proposal.id === input.replaceProposalId ? nextProposal : proposal,
    );
    const retainedPatches = (input.preview.proposedPrdPatch ?? []).filter(patch => patch.proposalId !== input.replaceProposalId);
    const patches = applicable ? [...retainedPatches, {
        proposalId,
        section: input.candidate.target.location.section,
        operation: 'replace' as const,
        entityId: input.candidate.target.location.entityId,
        entityType: input.candidate.target.location.entityType,
        jsonPath: input.candidate.target.location.jsonPath,
        beforeSummary: stablePlanningStringify(current.value),
        afterSummary: input.candidate.proposedSummary,
        value: input.candidate.proposedValue,
    }] : retainedPatches;

    let proposedPrd = input.structuredPRD;
    let allPatchesApply = true;
    for (const patch of patches) {
        const proposal = proposals.find(item => item.id === patch.proposalId);
        const next = proposal ? applyPlanningTargetValue(proposedPrd, proposal.target, patch.value) : undefined;
        if (!next) { allPatchesApply = false; break; }
        proposedPrd = next;
    }
    const nextPreview: DecisionImpactPreview = {
        ...input.preview,
        proposalContractVersion: 1,
        alignmentProposals: proposals,
        proposedPrdPatch: patches.length ? patches : undefined,
        proposedResultHash: allPatchesApply && patches.length ? planningContentHash(proposedPrd) : undefined,
        affectedPrdSections: [...new Set([...input.preview.affectedPrdSections, input.candidate.target.location.section])],
    };
    if (applicable) {
        const contractValidation = validateAlignmentProposalContract({
            record: input.record,
            preview: nextPreview,
            proposal: nextProposal,
            structuredPRD: input.structuredPRD,
        });
        if (!contractValidation.ok) return { ok: false, reason: contractValidation.reason };
    }
    return {
        ok: true,
        proposalId,
        preview: nextPreview,
    };
}
