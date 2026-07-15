import type {
    AssumptionEvidenceConclusion,
    AssumptionEvidenceRecord,
    AssumptionEvidenceSourceType,
    AssumptionInterpretationProposal,
    AssumptionUncertaintyTreatment,
    AssumptionValidationEvent,
    AssumptionValidationMethod,
    AssumptionValidationPlan,
    AssumptionValidationPlanProposal,
    AssumptionValidationState,
    AssumptionValidationWorkflowState,
    PlanningRecord,
} from '../../types';
import {
    ASSUMPTION_VALIDATION_CONTRACT_VERSION,
    ASSUMPTION_VALIDATION_SCHEMA_VERSION,
} from '../../types';
import { hashReviewValue, normalizeEvidenceText } from '../review/hash';

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type AssumptionValidationEventDraft = DistributiveOmit<AssumptionValidationEvent, 'integrityHash'>;

export type AssumptionValidationAppendContext = {
    currentSpineVersionId?: string;
    currentSpineContentHash?: string;
};

export type AssumptionValidationProjection = {
    workflowState: AssumptionValidationWorkflowState;
    currentPlan?: AssumptionValidationPlan;
    activeEvidence: AssumptionEvidenceRecord[];
    independentEvidence: AssumptionEvidenceRecord[];
    duplicateEvidenceIds: string[];
    evidenceFromAnotherQuestionIds: string[];
    acceptedConclusion?: AssumptionEvidenceConclusion;
    conclusionIsCurrent: boolean;
    latestOutcomeEventId?: string;
    userTreatment?: AssumptionUncertaintyTreatment;
    treatmentRationale?: string;
    revisitAt?: number;
    revisitCondition?: string;
    invalidEventIds: string[];
    hasHistoricalValidation: boolean;
};

const validationState = (record: PlanningRecord): AssumptionValidationState => record.assumptionValidation ?? {
    schemaVersion: ASSUMPTION_VALIDATION_SCHEMA_VERSION,
    events: [],
    planProposals: [],
    interpretationProposals: [],
};

const withoutContentHash = <T extends { contentHash: string }>(value: T): Omit<T, 'contentHash'> => {
    const { contentHash: _contentHash, ...payload } = value;
    return payload;
};

const withoutIntegrityHash = (event: AssumptionValidationEvent): AssumptionValidationEventDraft => {
    const { integrityHash: _integrityHash, ...payload } = event;
    return payload as AssumptionValidationEventDraft;
};

export const assumptionStatementHash = (record: Pick<PlanningRecord, 'statement'>): string =>
    hashReviewValue(normalizeEvidenceText(record.statement));

export const assumptionValidationPlanContentHash = (
    plan: Omit<AssumptionValidationPlan, 'contentHash'> | AssumptionValidationPlan,
): string => hashReviewValue('contentHash' in plan ? withoutContentHash(plan) : plan);

export const assumptionEvidenceContentHash = (
    evidence: Omit<AssumptionEvidenceRecord, 'contentHash'> | AssumptionEvidenceRecord,
): string => hashReviewValue('contentHash' in evidence ? withoutContentHash(evidence) : evidence);

export const assumptionPlanProposalContentHash = (
    proposal: Omit<AssumptionValidationPlanProposal, 'contentHash'> | AssumptionValidationPlanProposal,
): string => hashReviewValue('contentHash' in proposal ? withoutContentHash(proposal) : proposal);

export const assumptionInterpretationContentHash = (
    proposal: Omit<AssumptionInterpretationProposal, 'contentHash'> | AssumptionInterpretationProposal,
): string => hashReviewValue('contentHash' in proposal ? withoutContentHash(proposal) : proposal);

export const assumptionValidationEventIntegrityHash = (
    event: AssumptionValidationEventDraft | AssumptionValidationEvent,
): string => hashReviewValue('integrityHash' in event ? withoutIntegrityHash(event) : event);

export const sealAssumptionValidationEvent = <T extends AssumptionValidationEventDraft>(event: T): AssumptionValidationEvent => ({
    ...event,
    integrityHash: hashReviewValue(event),
}) as AssumptionValidationEvent;

export const sealAssumptionValidationPlan = (
    plan: Omit<AssumptionValidationPlan, 'contentHash'>,
): AssumptionValidationPlan => ({ ...plan, contentHash: assumptionValidationPlanContentHash(plan) });

const normalizeSourceIdentity = (value: string): string => normalizeEvidenceText(value).toLocaleLowerCase();

export const assumptionEvidenceSourceFingerprint = (
    sourceType: AssumptionEvidenceSourceType,
    sourceIdentity: string,
): string => hashReviewValue({ sourceType, sourceIdentity: normalizeSourceIdentity(sourceIdentity) });

export const sealAssumptionEvidence = (
    evidence: Omit<AssumptionEvidenceRecord, 'sourceFingerprint' | 'contentHash'>,
): AssumptionEvidenceRecord => {
    const withFingerprint = {
        ...evidence,
        sourceFingerprint: assumptionEvidenceSourceFingerprint(evidence.sourceType, evidence.sourceIdentity),
    };
    return { ...withFingerprint, contentHash: assumptionEvidenceContentHash(withFingerprint) };
};

export const assumptionEvidenceSetHash = (evidence: AssumptionEvidenceRecord[]): string => hashReviewValue(
    [...evidence]
        .sort((left, right) => left.id.localeCompare(right.id))
        .map(item => ({ id: item.id, contentHash: item.contentHash })),
);

const isPlanIntact = (plan: AssumptionValidationPlan): boolean =>
    Boolean(plan.id && plan.question.trim() && plan.method.label.trim())
    && plan.authoredBy === 'user'
    && plan.contentHash === assumptionValidationPlanContentHash(plan);

const isEvidenceIntact = (evidence: AssumptionEvidenceRecord): boolean =>
    Boolean(
        evidence.id
        && evidence.planningRecordId
        && evidence.source.trim()
        && evidence.sourceIdentity.trim()
        && evidence.observation.trim()
        && evidence.validationQuestion.trim(),
    )
    && evidence.authoredBy === 'user'
    && evidence.sourceFingerprint === assumptionEvidenceSourceFingerprint(evidence.sourceType, evidence.sourceIdentity)
    && evidence.contentHash === assumptionEvidenceContentHash(evidence);

const isPlanProposalIntact = (proposal: AssumptionValidationPlanProposal): boolean =>
    proposal.authoredBy === 'synapse'
    && proposal.contractVersion === ASSUMPTION_VALIDATION_CONTRACT_VERSION
    && Boolean(proposal.question.trim() && proposal.method.label.trim())
    && proposal.contentHash === assumptionPlanProposalContentHash(proposal);

const isInterpretationIntact = (proposal: AssumptionInterpretationProposal): boolean =>
    proposal.authoredBy === 'synapse'
    && proposal.contractVersion === ASSUMPTION_VALIDATION_CONTRACT_VERSION
    && Boolean(proposal.reasoning.trim())
    && proposal.contentHash === assumptionInterpretationContentHash(proposal);

type ReplayState = {
    plan?: AssumptionValidationPlan;
    evidence: Map<string, AssumptionEvidenceRecord>;
    lastOutcome?: Extract<AssumptionValidationEvent, { type: 'validation_outcome_recorded' }>;
    outcomeReopened: boolean;
    treatment?: Extract<AssumptionValidationEvent, { type: 'validation_uncertainty_treatment_recorded' }>;
    invalidEventIds: string[];
};

const replayValidation = (record: PlanningRecord): ReplayState => {
    const replay: ReplayState = {
        evidence: new Map(),
        outcomeReopened: false,
        invalidEventIds: [],
    };
    const seenIds = new Set<string>();
    let latestAt = -Infinity;

    for (const event of validationState(record).events) {
        let valid = Boolean(event.id && event.planningRecordId === record.id && Number.isFinite(event.at))
            && event.actor === 'user'
            && !seenIds.has(event.id)
            && event.at >= latestAt
            && event.integrityHash === assumptionValidationEventIntegrityHash(event);
        const currentEvidence = [...replay.evidence.values()];
        const evidenceHash = assumptionEvidenceSetHash(currentEvidence);

        if (valid) {
            switch (event.type) {
                case 'validation_plan_recorded':
                    valid = isPlanIntact(event.plan)
                        && event.plan.createdAt <= event.at
                        && event.expectedEvidenceSetHash === evidenceHash;
                    break;
                case 'validation_evidence_recorded':
                    valid = isEvidenceIntact(event.evidence)
                        && event.evidence.planningRecordId === record.id
                        && event.evidence.recordedAt <= event.at
                        && event.expectedEvidenceSetHash === evidenceHash
                        && event.evidence.assumptionStatementHash === event.assumptionStatementHash
                        && Boolean(replay.plan)
                        && event.evidence.validationPlanHash === replay.plan?.contentHash;
                    break;
                case 'validation_evidence_retracted': {
                    const existing = replay.evidence.get(event.evidenceId);
                    valid = Boolean(existing)
                        && existing?.contentHash === event.evidenceContentHash
                        && event.expectedEvidenceSetHash === evidenceHash
                        && Boolean(event.reason.trim());
                    break;
                }
                case 'validation_outcome_recorded':
                    valid = Boolean(replay.plan)
                        && event.expectedValidationPlanHash === replay.plan?.contentHash
                        && event.expectedEvidenceSetHash === evidenceHash
                        && (!['supported', 'partially_supported', 'contradicted'].includes(event.conclusion)
                            || currentEvidence.length > 0);
                    break;
                case 'validation_outcome_reopened':
                    valid = Boolean(event.reason.trim())
                        && replay.lastOutcome?.id === event.previousOutcomeEventId
                        && event.expectedValidationPlanHash === replay.plan?.contentHash
                        && event.expectedEvidenceSetHash === evidenceHash;
                    break;
                case 'validation_uncertainty_treatment_recorded':
                    valid = Boolean(event.rationale.trim()) && event.expectedEvidenceSetHash === evidenceHash;
                    break;
            }
        }
        if (!valid) {
            replay.invalidEventIds.push(event.id || '(missing event id)');
            continue;
        }

        seenIds.add(event.id);
        latestAt = event.at;
        switch (event.type) {
            case 'validation_plan_recorded':
                replay.plan = event.plan;
                break;
            case 'validation_evidence_recorded':
                replay.evidence.set(event.evidence.id, event.evidence);
                break;
            case 'validation_evidence_retracted':
                replay.evidence.delete(event.evidenceId);
                break;
            case 'validation_outcome_recorded':
                replay.lastOutcome = event;
                replay.outcomeReopened = false;
                break;
            case 'validation_outcome_reopened':
                replay.outcomeReopened = true;
                break;
            case 'validation_uncertainty_treatment_recorded':
                replay.treatment = event;
                break;
        }
    }
    return replay;
};

export function projectAssumptionValidation(
    record: PlanningRecord,
    now = Date.now(),
): AssumptionValidationProjection {
    const replay = replayValidation(record);
    const currentStatementHash = assumptionStatementHash(record);
    const currentPlan = replay.plan && replay.plan.contentHash === assumptionValidationPlanContentHash(replay.plan)
        ? replay.plan
        : undefined;
    const planEvent = [...validationState(record).events].reverse().find(event =>
        event.type === 'validation_plan_recorded' && event.plan.id === currentPlan?.id,
    );
    const planMatchesAssumption = planEvent?.assumptionStatementHash === currentStatementHash;
    const applicablePlan = planMatchesAssumption ? currentPlan : undefined;
    const activeEvidence = [...replay.evidence.values()];
    const evidenceFromAnotherQuestionIds: string[] = [];
    const seenFingerprints = new Set<string>();
    const duplicateEvidenceIds: string[] = [];
    const independentEvidence: AssumptionEvidenceRecord[] = [];

    for (const evidence of activeEvidence) {
        const belongsToCurrentQuestion = Boolean(applicablePlan)
            && evidence.assumptionStatementHash === currentStatementHash
            && evidence.validationPlanHash === applicablePlan?.contentHash;
        if (!belongsToCurrentQuestion) {
            evidenceFromAnotherQuestionIds.push(evidence.id);
            continue;
        }
        if (seenFingerprints.has(evidence.sourceFingerprint)) {
            duplicateEvidenceIds.push(evidence.id);
            continue;
        }
        seenFingerprints.add(evidence.sourceFingerprint);
        independentEvidence.push(evidence);
    }

    const currentEvidenceHash = assumptionEvidenceSetHash(activeEvidence);
    const outcome = replay.lastOutcome;
    const conclusionIsCurrent = Boolean(
        outcome
        && !replay.outcomeReopened
        && outcome.assumptionStatementHash === currentStatementHash
        && outcome.expectedValidationPlanHash === applicablePlan?.contentHash
        && outcome.expectedEvidenceSetHash === currentEvidenceHash,
    );
    const expired = Boolean(
        (applicablePlan?.expiresAt !== undefined && applicablePlan.expiresAt <= now)
        || (outcome?.revisitAt !== undefined && outcome.revisitAt <= now),
    );
    const hasHistoricalValidation = validationState(record).events.length > 0;
    let workflowState: AssumptionValidationWorkflowState;
    if (conclusionIsCurrent && !expired) workflowState = 'completed';
    else if (outcome || hasHistoricalValidation && !applicablePlan) workflowState = 'due_for_review';
    else if (independentEvidence.length > 0) workflowState = 'in_progress';
    else if (applicablePlan) workflowState = 'planned';
    else workflowState = 'not_planned';

    const legacyAccepted = !replay.treatment
        && !hasHistoricalValidation
        && record.type === 'assumption'
        && record.status === 'confirmed';

    return {
        workflowState,
        currentPlan: applicablePlan,
        activeEvidence,
        independentEvidence,
        duplicateEvidenceIds,
        evidenceFromAnotherQuestionIds,
        acceptedConclusion: conclusionIsCurrent && !expired ? outcome?.conclusion : undefined,
        conclusionIsCurrent: conclusionIsCurrent && !expired,
        latestOutcomeEventId: outcome?.id,
        userTreatment: replay.treatment?.treatment ?? (legacyAccepted ? 'accepted_without_validation' : undefined),
        treatmentRationale: replay.treatment?.rationale,
        revisitAt: replay.treatment?.revisitAt ?? outcome?.revisitAt ?? applicablePlan?.expiresAt,
        revisitCondition: replay.treatment?.revisitCondition ?? outcome?.revisitCondition ?? applicablePlan?.revisitCondition,
        invalidEventIds: replay.invalidEventIds,
        hasHistoricalValidation,
    };
}

export type AssumptionValidationEventValidation = { valid: true } | { valid: false; reason: string };

export function validateAssumptionValidationEvent(
    record: PlanningRecord,
    event: AssumptionValidationEvent,
    context: AssumptionValidationAppendContext = {},
): AssumptionValidationEventValidation {
    if (record.type !== 'assumption') return { valid: false, reason: 'Only assumption records can be validated.' };
    if (event.planningRecordId !== record.id) return { valid: false, reason: 'Validation event belongs to a different planning record.' };
    if (event.actor !== 'user') return { valid: false, reason: 'Only a user may record validation authority.' };
    if (!event.id || !Number.isFinite(event.at)) return { valid: false, reason: 'Validation event identity and timestamp are required.' };
    if (event.integrityHash !== assumptionValidationEventIntegrityHash(event)) return { valid: false, reason: 'Validation event integrity check failed.' };
    if (event.assumptionStatementHash !== assumptionStatementHash(record)) return { valid: false, reason: 'The assumption changed before this validation action was recorded.' };
    const state = validationState(record);
    if (state.events.some(existing => existing.id === event.id)) return { valid: true };
    const latestAt = state.events.at(-1)?.at;
    if (latestAt !== undefined && event.at < latestAt) return { valid: false, reason: 'Validation events must be appended in chronological order.' };
    if (event.expectedSpineVersionId) {
        if (!context.currentSpineVersionId || !context.currentSpineContentHash) {
            return { valid: false, reason: 'The current plan version is required to record this validation action.' };
        }
        if (event.expectedSpineVersionId !== context.currentSpineVersionId
            || event.expectedSpineContentHash !== context.currentSpineContentHash) {
            return { valid: false, reason: 'The plan changed before this validation action was recorded.' };
        }
    }
    const projection = projectAssumptionValidation(record, event.at);
    const evidenceHash = assumptionEvidenceSetHash(projection.activeEvidence);
    if ('expectedEvidenceSetHash' in event && event.expectedEvidenceSetHash !== evidenceHash) {
        return { valid: false, reason: 'The evidence changed before this validation action was recorded.' };
    }

    switch (event.type) {
        case 'validation_plan_recorded': {
            if (!isPlanIntact(event.plan)) return { valid: false, reason: 'Validation plan integrity check failed.' };
            if (event.sourceProposalId) {
                const proposal = state.planProposals.find(item => item.id === event.sourceProposalId);
                if (!proposal || !isPlanProposalIntact(proposal)
                    || event.sourceProposalContentHash !== proposal.contentHash) {
                    return { valid: false, reason: 'The validation plan proposal changed before it was recorded.' };
                }
                if (proposal.assumptionStatementHash !== event.assumptionStatementHash
                    || proposal.evidenceSetHash !== evidenceHash) {
                    return { valid: false, reason: 'The validation plan proposal is stale.' };
                }
                if (proposal.sourceSpineVersionId && (
                    proposal.sourceSpineVersionId !== context.currentSpineVersionId
                    || proposal.sourceSpineContentHash !== context.currentSpineContentHash
                    || event.expectedSpineVersionId !== proposal.sourceSpineVersionId
                    || event.expectedSpineContentHash !== proposal.sourceSpineContentHash
                )) return { valid: false, reason: 'The validation plan proposal is bound to a different plan version.' };
            }
            break;
        }
        case 'validation_evidence_recorded':
            if (!projection.currentPlan) return { valid: false, reason: 'Record a validation plan before adding evidence.' };
            if (!isEvidenceIntact(event.evidence) || event.evidence.planningRecordId !== record.id) {
                return { valid: false, reason: 'Evidence integrity or ownership check failed.' };
            }
            if (event.evidence.assumptionStatementHash !== event.assumptionStatementHash
                || event.evidence.validationPlanHash !== projection.currentPlan.contentHash
                || normalizeEvidenceText(event.evidence.validationQuestion) !== normalizeEvidenceText(projection.currentPlan.question)) {
                return { valid: false, reason: 'Evidence does not answer the current validation question.' };
            }
            break;
        case 'validation_evidence_retracted': {
            const evidence = projection.activeEvidence.find(item => item.id === event.evidenceId);
            if (!evidence || evidence.contentHash !== event.evidenceContentHash) {
                return { valid: false, reason: 'Evidence changed before it could be retracted.' };
            }
            if (!event.reason.trim()) return { valid: false, reason: 'Evidence retraction requires a reason.' };
            break;
        }
        case 'validation_outcome_recorded': {
            if (!projection.currentPlan || event.expectedValidationPlanHash !== projection.currentPlan.contentHash) {
                return { valid: false, reason: 'The validation plan changed before this outcome was recorded.' };
            }
            if (['supported', 'partially_supported', 'contradicted'].includes(event.conclusion)
                && projection.independentEvidence.length === 0) {
                return { valid: false, reason: 'This conclusion requires at least one current, independent evidence source.' };
            }
            if (event.sourceInterpretationId) {
                const interpretation = state.interpretationProposals.find(item => item.id === event.sourceInterpretationId);
                if (!interpretation || !isInterpretationIntact(interpretation)
                    || event.sourceInterpretationContentHash !== interpretation.contentHash) {
                    return { valid: false, reason: 'The interpretation changed before the user recorded an outcome.' };
                }
                if (interpretation.assumptionStatementHash !== event.assumptionStatementHash
                    || interpretation.validationPlanHash !== event.expectedValidationPlanHash
                    || interpretation.evidenceSetHash !== event.expectedEvidenceSetHash) {
                    return { valid: false, reason: 'The interpretation is stale.' };
                }
                if (interpretation.sourceSpineVersionId && (
                    interpretation.sourceSpineVersionId !== context.currentSpineVersionId
                    || interpretation.sourceSpineContentHash !== context.currentSpineContentHash
                    || event.expectedSpineVersionId !== interpretation.sourceSpineVersionId
                    || event.expectedSpineContentHash !== interpretation.sourceSpineContentHash
                )) return { valid: false, reason: 'The interpretation is bound to a different plan version.' };
            }
            break;
        }
        case 'validation_outcome_reopened':
            if (!projection.latestOutcomeEventId || projection.latestOutcomeEventId !== event.previousOutcomeEventId) {
                return { valid: false, reason: 'Only the current validation outcome can be reopened.' };
            }
            if (event.expectedValidationPlanHash !== projection.currentPlan?.contentHash) {
                return { valid: false, reason: 'The validation plan changed before reopening this outcome.' };
            }
            if (!event.reason.trim()) return { valid: false, reason: 'Reopening an outcome requires a reason.' };
            break;
        case 'validation_uncertainty_treatment_recorded':
            if (!event.rationale.trim()) return { valid: false, reason: 'Unresolved uncertainty requires an explicit rationale.' };
            break;
    }
    return { valid: true };
}

export type AppendAssumptionValidationEventResult =
    | { ok: true; record: PlanningRecord; duplicate: boolean; duplicateEvidenceOf?: string }
    | { ok: false; reason: string };

export function appendAssumptionValidationEvent(
    record: PlanningRecord,
    event: AssumptionValidationEvent,
    context: AssumptionValidationAppendContext = {},
): AppendAssumptionValidationEventResult {
    const state = validationState(record);
    if (state.events.some(existing => existing.id === event.id)) return { ok: true, record, duplicate: true };
    const validation = validateAssumptionValidationEvent(record, event, context);
    if (!validation.valid) return { ok: false, reason: validation.reason };
    const projection = projectAssumptionValidation(record, event.at);
    const duplicateEvidenceOf = event.type === 'validation_evidence_recorded'
        ? projection.activeEvidence.find(item => item.sourceFingerprint === event.evidence.sourceFingerprint)?.id
        : undefined;
    const nextState: AssumptionValidationState = {
        ...state,
        schemaVersion: ASSUMPTION_VALIDATION_SCHEMA_VERSION,
        events: [...state.events, event],
    };
    return {
        ok: true,
        duplicate: false,
        duplicateEvidenceOf,
        record: {
            ...record,
            assumptionValidation: nextState,
            updatedAt: Math.max(record.updatedAt, event.at),
        },
    };
}

export type AddAssumptionProposalResult =
    | { ok: true; record: PlanningRecord; duplicate: boolean }
    | { ok: false; reason: string };

export function addAssumptionValidationPlanProposal(
    record: PlanningRecord,
    proposal: AssumptionValidationPlanProposal,
    context: AssumptionValidationAppendContext = {},
): AddAssumptionProposalResult {
    if (record.type !== 'assumption' || proposal.planningRecordId !== record.id) {
        return { ok: false, reason: 'Validation plan proposal belongs to a different assumption.' };
    }
    if (!isPlanProposalIntact(proposal)) return { ok: false, reason: 'Validation plan proposal integrity check failed.' };
    if (proposal.sourceSpineVersionId && (
        proposal.sourceSpineVersionId !== context.currentSpineVersionId
        || proposal.sourceSpineContentHash !== context.currentSpineContentHash
    )) return { ok: false, reason: 'Validation plan proposal is bound to a different plan version.' };
    const projection = projectAssumptionValidation(record, proposal.createdAt);
    if (proposal.assumptionStatementHash !== assumptionStatementHash(record)
        || proposal.evidenceSetHash !== assumptionEvidenceSetHash(projection.activeEvidence)) {
        return { ok: false, reason: 'Validation plan proposal is stale.' };
    }
    const state = validationState(record);
    if (state.planProposals.some(item => item.id === proposal.id)) return { ok: true, record, duplicate: true };
    return {
        ok: true,
        duplicate: false,
        record: {
            ...record,
            assumptionValidation: { ...state, planProposals: [...state.planProposals, proposal] },
            updatedAt: Math.max(record.updatedAt, proposal.createdAt),
        },
    };
}

export function addAssumptionInterpretationProposal(
    record: PlanningRecord,
    proposal: AssumptionInterpretationProposal,
    context: AssumptionValidationAppendContext = {},
): AddAssumptionProposalResult {
    if (record.type !== 'assumption' || proposal.planningRecordId !== record.id) {
        return { ok: false, reason: 'Interpretation belongs to a different assumption.' };
    }
    if (!isInterpretationIntact(proposal)) return { ok: false, reason: 'Interpretation integrity check failed.' };
    if (proposal.sourceSpineVersionId && (
        proposal.sourceSpineVersionId !== context.currentSpineVersionId
        || proposal.sourceSpineContentHash !== context.currentSpineContentHash
    )) return { ok: false, reason: 'Interpretation is bound to a different plan version.' };
    const projection = projectAssumptionValidation(record, proposal.createdAt);
    if (!projection.currentPlan
        || proposal.assumptionStatementHash !== assumptionStatementHash(record)
        || proposal.validationPlanHash !== projection.currentPlan.contentHash
        || proposal.evidenceSetHash !== assumptionEvidenceSetHash(projection.activeEvidence)) {
        return { ok: false, reason: 'Interpretation is stale.' };
    }
    const activeIds = new Set(projection.activeEvidence.map(item => item.id));
    const referencedIds = [
        ...proposal.supportingEvidenceIds,
        ...proposal.contradictingEvidenceIds,
        ...proposal.inconclusiveEvidenceIds,
        ...proposal.irrelevantEvidenceIds,
        ...proposal.duplicateEvidenceIds,
    ];
    if (referencedIds.some(id => !activeIds.has(id))) {
        return { ok: false, reason: 'Interpretation references evidence outside this assumption.' };
    }
    const state = validationState(record);
    if (state.interpretationProposals.some(item => item.id === proposal.id)) return { ok: true, record, duplicate: true };
    return {
        ok: true,
        duplicate: false,
        record: {
            ...record,
            assumptionValidation: { ...state, interpretationProposals: [...state.interpretationProposals, proposal] },
            updatedAt: Math.max(record.updatedAt, proposal.createdAt),
        },
    };
}

export type BuildValidationPlanProposalInput = {
    record: PlanningRecord;
    question: string;
    method: AssumptionValidationMethod;
    supportSignals: string[];
    contradictionSignals: string[];
    inconclusiveConditions?: string[];
    limitations?: string[];
    revisitCondition?: string;
    expiresAt?: number;
    sourceSpineVersionId?: string;
    sourceSpineContentHash?: string;
    model?: string;
    provider?: string;
    createdAt?: number;
};

/** Builds a bounded advisory plan. Recording it still requires a user event. */
export function buildAssumptionValidationPlanProposal(
    input: BuildValidationPlanProposalInput,
): AssumptionValidationPlanProposal {
    const createdAt = input.createdAt ?? Date.now();
    const projection = projectAssumptionValidation(input.record, createdAt);
    const base = {
        id: '',
        planningRecordId: input.record.id,
        contractVersion: ASSUMPTION_VALIDATION_CONTRACT_VERSION,
        authoredBy: 'synapse' as const,
        question: normalizeEvidenceText(input.question),
        method: input.method,
        supportSignals: input.supportSignals,
        contradictionSignals: input.contradictionSignals,
        inconclusiveConditions: input.inconclusiveConditions ?? [],
        limitations: input.limitations ?? [],
        revisitCondition: input.revisitCondition,
        expiresAt: input.expiresAt,
        assumptionStatementHash: assumptionStatementHash(input.record),
        evidenceSetHash: assumptionEvidenceSetHash(projection.activeEvidence),
        sourceSpineVersionId: input.sourceSpineVersionId,
        sourceSpineContentHash: input.sourceSpineContentHash,
        model: input.model,
        provider: input.provider,
        createdAt,
    };
    const id = `assumption-plan-${hashReviewValue(base)}`;
    const withId = { ...base, id };
    return { ...withId, contentHash: assumptionPlanProposalContentHash(withId) };
}

export type EvidenceInterpretationClassification = {
    evidenceId: string;
    relation: 'supports' | 'contradicts' | 'inconclusive' | 'irrelevant';
};

export type BuildInterpretationProposalInput = {
    record: PlanningRecord;
    /** Optional advisory reclassification. When omitted, the deterministic
     * builder uses the user's relation recorded with each evidence item. */
    classifications?: EvidenceInterpretationClassification[];
    reasoning: string;
    limitations?: string[];
    sourceSpineVersionId?: string;
    sourceSpineContentHash?: string;
    model?: string;
    provider?: string;
    createdAt?: number;
};

/** Deterministically summarizes explicit evidence classifications. The result
 * is advisory and cannot create a user outcome. */
export function buildAssumptionInterpretationProposal(
    input: BuildInterpretationProposalInput,
): AssumptionInterpretationProposal {
    const createdAt = input.createdAt ?? Date.now();
    const projection = projectAssumptionValidation(input.record, createdAt);
    if (!projection.currentPlan) throw new Error('Record a current validation plan before interpreting evidence.');
    const active = new Map(projection.activeEvidence.map(item => [item.id, item]));
    const classifications = input.classifications ?? projection.activeEvidence.map(evidence => ({
        evidenceId: evidence.id,
        relation: evidence.relation,
    }));
    if (classifications.some(item => !active.has(item.evidenceId))) {
        throw new Error('Interpretation classification references evidence outside this assumption.');
    }
    const duplicate = new Set(projection.duplicateEvidenceIds);
    const buckets = {
        supports: [] as string[],
        contradicts: [] as string[],
        inconclusive: [] as string[],
        irrelevant: [] as string[],
    };
    for (const classification of classifications) {
        if (!duplicate.has(classification.evidenceId)) buckets[classification.relation].push(classification.evidenceId);
    }
    let recommendedConclusion: AssumptionEvidenceConclusion;
    if (buckets.supports.length && buckets.contradicts.length) recommendedConclusion = 'inconclusive';
    else if (buckets.contradicts.length) recommendedConclusion = 'contradicted';
    else if (buckets.supports.length && (buckets.inconclusive.length || buckets.irrelevant.length)) recommendedConclusion = 'partially_supported';
    else if (buckets.supports.length) recommendedConclusion = 'supported';
    else if (buckets.inconclusive.length) recommendedConclusion = 'inconclusive';
    else recommendedConclusion = 'more_evidence_needed';

    const base = {
        id: '',
        planningRecordId: input.record.id,
        contractVersion: ASSUMPTION_VALIDATION_CONTRACT_VERSION,
        authoredBy: 'synapse' as const,
        recommendedConclusion,
        reasoning: normalizeEvidenceText(input.reasoning),
        supportingEvidenceIds: buckets.supports,
        contradictingEvidenceIds: buckets.contradicts,
        inconclusiveEvidenceIds: buckets.inconclusive,
        irrelevantEvidenceIds: buckets.irrelevant,
        duplicateEvidenceIds: projection.duplicateEvidenceIds,
        limitations: input.limitations ?? [],
        assumptionStatementHash: assumptionStatementHash(input.record),
        validationPlanHash: projection.currentPlan.contentHash,
        evidenceSetHash: assumptionEvidenceSetHash(projection.activeEvidence),
        sourceSpineVersionId: input.sourceSpineVersionId,
        sourceSpineContentHash: input.sourceSpineContentHash,
        model: input.model,
        provider: input.provider,
        createdAt,
    };
    const id = `assumption-interpretation-${hashReviewValue(base)}`;
    const withId = { ...base, id };
    return { ...withId, contentHash: assumptionInterpretationContentHash(withId) };
}
