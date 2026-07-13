import type {
    DecisionEvent,
    DecisionVerdictEvent,
    PlanningRecord,
    PlanningRecordStatus,
} from '../../types';
import { PLANNING_RECORD_SCHEMA_VERSION } from '../../types';

export type DecisionProjection = {
    status: PlanningRecordStatus;
    selectedOptionId?: string;
    answer?: string;
    rationale?: string;
    revisitAt?: number;
    supersededById?: string;
    latestVerdictEventId?: string;
    confirmedAt?: number;
    resultingSpineVersionId?: string;
    appliedImpactPreviewId?: string;
};

export type DecisionEventValidation =
    | { valid: true }
    | { valid: false; reason: string };

const VERDICT_TYPES = new Set<DecisionEvent['type']>([
    'option_selected',
    'custom_answered',
    'deferred',
    'premise_rejected',
    'reopened',
    'revised',
    'invalidated',
    'superseded',
]);

export const isDecisionVerdictEvent = (event: DecisionEvent): event is DecisionVerdictEvent =>
    VERDICT_TYPES.has(event.type);

/** Runtime companion to the event union for untyped restored/model data. */
export function validateDecisionEvent(event: DecisionEvent): DecisionEventValidation {
    if (!event.id || !event.planningRecordId || !Number.isFinite(event.at)) {
        return { valid: false, reason: 'Event identity and timestamp are required.' };
    }
    if (isDecisionVerdictEvent(event) && event.actor !== 'user') {
        return { valid: false, reason: 'Only a user may author a decision verdict.' };
    }
    if (event.type === 'option_selected' && !event.optionId) {
        return { valid: false, reason: 'An option selection requires an option id.' };
    }
    if (event.type === 'custom_answered' && !event.answer.trim()) {
        return { valid: false, reason: 'A custom answer cannot be empty.' };
    }
    if (event.type === 'revised' && !event.optionId && !event.answer?.trim()) {
        return { valid: false, reason: 'A revision requires an option or custom answer.' };
    }
    return { valid: true };
}

const initialStatus = (record: PlanningRecord): PlanningRecordStatus => {
    if (record.createdBy === 'specialist_review' || record.createdBy === 'synapse') return 'proposed';
    return record.status;
};

/** Derive current state without mutating the append-only event history. */
export function projectDecision(record: PlanningRecord): DecisionProjection {
    const projection: DecisionProjection = {
        status: initialStatus(record),
        answer: record.resolution,
        rationale: record.rationale,
        resultingSpineVersionId: record.resultingSpineVersionId,
        confirmedAt: record.confirmedAt,
    };

    for (const event of record.events ?? []) {
        if (!validateDecisionEvent(event).valid) continue;
        if (isDecisionVerdictEvent(event)) {
            projection.latestVerdictEventId = event.id;
            projection.rationale = event.rationale;
        }
        switch (event.type) {
            case 'created':
            case 'imported':
            case 'impact_preview_requested':
                break;
            case 'option_selected':
                projection.status = 'confirmed';
                projection.selectedOptionId = event.optionId;
                projection.answer = event.answer;
                projection.revisitAt = undefined;
                projection.confirmedAt = event.at;
                break;
            case 'custom_answered':
                projection.status = 'confirmed';
                projection.selectedOptionId = undefined;
                projection.answer = event.answer;
                projection.revisitAt = undefined;
                projection.confirmedAt = event.at;
                break;
            case 'deferred':
                projection.status = 'deferred';
                projection.revisitAt = event.revisitAt;
                break;
            case 'premise_rejected':
                projection.status = 'rejected';
                projection.answer = event.reason;
                break;
            case 'reopened':
                projection.status = 'open';
                projection.selectedOptionId = undefined;
                projection.answer = undefined;
                projection.revisitAt = undefined;
                projection.supersededById = undefined;
                projection.confirmedAt = undefined;
                break;
            case 'revised':
                projection.status = 'confirmed';
                projection.selectedOptionId = event.optionId;
                projection.answer = event.answer;
                projection.revisitAt = undefined;
                projection.confirmedAt = event.at;
                break;
            case 'invalidated':
                projection.status = 'invalidated';
                projection.answer = event.reason;
                break;
            case 'superseded':
                projection.status = 'superseded';
                projection.supersededById = event.supersededById;
                break;
            case 'applied_to_plan':
                projection.resultingSpineVersionId = event.resultingSpineVersionId;
                projection.appliedImpactPreviewId = event.impactPreviewId;
                break;
        }
    }
    return projection;
}

/**
 * Upgrade a legacy record's projection fields while preserving every legacy
 * field. AI/review-created records cannot enter as confirmed without a user
 * verdict event.
 */
export function normalizePlanningRecord(record: PlanningRecord): PlanningRecord {
    const projection = projectDecision(record);
    return {
        ...record,
        schemaVersion: PLANNING_RECORD_SCHEMA_VERSION,
        status: projection.status,
        resolution: projection.answer,
        rationale: projection.rationale,
        resultingSpineVersionId: projection.resultingSpineVersionId,
        confirmedAt: projection.status === 'confirmed' ? projection.confirmedAt : undefined,
    };
}

export type AppendDecisionEventResult =
    | { ok: true; record: PlanningRecord; duplicate: boolean }
    | { ok: false; reason: string };

/** Validate, deduplicate, append, then refresh legacy projection fields. */
export function appendDecisionEvent(
    record: PlanningRecord,
    event: DecisionEvent,
): AppendDecisionEventResult {
    if (event.planningRecordId !== record.id) {
        return { ok: false, reason: 'Event belongs to a different planning record.' };
    }
    const validation = validateDecisionEvent(event);
    if (!validation.valid) return { ok: false, reason: validation.reason };
    if ((record.events ?? []).some((existing) => existing.id === event.id)) {
        return { ok: true, record, duplicate: true };
    }
    const alreadyApplied = (record.events ?? []).some((existing) =>
        existing.type === 'applied_to_plan'
        && event.type === 'applied_to_plan'
        && existing.impactPreviewId === event.impactPreviewId,
    );
    if (alreadyApplied) return { ok: true, record, duplicate: true };
    const latestAt = record.events?.at(-1)?.at;
    if (latestAt !== undefined && event.at < latestAt) {
        return { ok: false, reason: 'Events must be appended in chronological order.' };
    }
    if (event.type === 'option_selected' && record.decisionOptions?.length
        && !record.decisionOptions.some((option) => option.id === event.optionId)) {
        return { ok: false, reason: 'Selected option does not belong to this decision.' };
    }
    if (event.type === 'revised'
        && !(record.events ?? []).some((existing) => existing.id === event.previousEventId && isDecisionVerdictEvent(existing))) {
        return { ok: false, reason: 'A revision must reference an earlier verdict event.' };
    }
    if (event.type === 'superseded' && event.supersededById === record.id) {
        return { ok: false, reason: 'A decision cannot supersede itself.' };
    }
    if (event.type === 'applied_to_plan' && !['confirmed', 'rejected'].includes(projectDecision(record).status)) {
        return { ok: false, reason: 'Only a resolved decision may be applied to the plan.' };
    }
    const withEvent: PlanningRecord = {
        ...record,
        events: [...(record.events ?? []), event],
        updatedAt: Math.max(record.updatedAt, event.at),
    };
    const projection = projectDecision(withEvent);
    return {
        ok: true,
        duplicate: false,
        record: {
            ...withEvent,
            schemaVersion: PLANNING_RECORD_SCHEMA_VERSION,
            status: projection.status,
            resolution: projection.answer,
            rationale: projection.rationale,
            resultingSpineVersionId: projection.resultingSpineVersionId,
            confirmedAt: projection.status === 'confirmed' ? projection.confirmedAt : undefined,
        },
    };
}
