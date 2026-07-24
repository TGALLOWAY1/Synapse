import type { PlanningRecord } from '../../types';
import { projectDecision } from './decisionProjection';
import { planningContentHash } from './planningHash';

export type BatchVerdictAction = 'accept_recommendation' | 'accept_default' | 'defer';
export type OpenPlanningStatus = 'open' | 'proposed';

type BaseBatchVerdictCandidate = {
    recordId: string;
    action: BatchVerdictAction;
    expectedStatus: OpenPlanningStatus;
    expectedTargetHash: string;
    expectedSpineVersionId?: string;
};

export type BatchVerdictCandidate =
    | (BaseBatchVerdictCandidate & {
        action: 'accept_recommendation';
        optionId: string;
        answer: string;
        expectedRecommendationIdentity: string;
    })
    | (BaseBatchVerdictCandidate & {
        action: 'accept_default';
        answer: string;
    })
    | (BaseBatchVerdictCandidate & {
        action: 'defer';
    });

/** The store guard is the full frozen candidate, not merely its target hash.
 * This lets the write boundary verify that the event payload matches the
 * exact option/default the user reviewed. */
export type BatchVerdictGuard = BatchVerdictCandidate;
type RecommendationBatchCandidate = Extract<
    BatchVerdictCandidate,
    { action: 'accept_recommendation' }
>;
type AssumptionDefaultBatchCandidate = Extract<
    BatchVerdictCandidate,
    { action: 'accept_default' }
>;
type DeferBatchCandidate = Extract<BatchVerdictCandidate, { action: 'defer' }>;

export type BatchVerdictItemResult = {
    recordId: string;
    reason: string;
};

export type BatchVerdictResult = {
    succeeded: string[];
    skipped: BatchVerdictItemResult[];
    failed: BatchVerdictItemResult[];
    /** The verdict is already durable when this best-effort follow-up runs.
     * Preview failures therefore cannot also classify the verdict as failed. */
    impactPreviewFailures?: BatchVerdictItemResult[];
};

const openStatus = (record: PlanningRecord): OpenPlanningStatus | undefined => {
    const status = projectDecision(record).status;
    return status === 'open' || status === 'proposed' ? status : undefined;
};

const presentedDefault = (record: PlanningRecord) =>
    record.statement.trim() || record.title.trim();

export function recommendationIdentity(record: PlanningRecord): string | undefined {
    if (record.type !== 'decision' && record.type !== 'open_question') return;
    const provenance = record.decisionOptionsProvenance;
    const recommendation = record.recommendationDetail;
    const option = record.decisionOptions?.find(item => item.id === recommendation?.optionId);
    if (provenance?.authoredBy !== 'synapse' || !recommendation?.optionId || !option) return;
    return planningContentHash({ provenance, recommendation, option });
}

export function batchVerdictTargetHash(
    record: PlanningRecord,
    action: BatchVerdictAction,
): string {
    const base = {
        id: record.id,
        type: record.type,
        status: projectDecision(record).status,
        statement: record.statement,
        currentSourceStatement: record.currentSourceStatement,
        sourceState: record.sourceState,
    };
    if (action === 'accept_recommendation') {
        return planningContentHash({
            ...base,
            recommendationIdentity: recommendationIdentity(record),
        });
    }
    if (action === 'accept_default') {
        return planningContentHash({ ...base, answer: presentedDefault(record) });
    }
    return planningContentHash(base);
}

export function recommendationBatchCandidate(
    record: PlanningRecord,
    currentSpineVersionId?: string,
): RecommendationBatchCandidate | undefined {
    const expectedStatus = openStatus(record);
    const expectedRecommendationIdentity = recommendationIdentity(record);
    const option = record.decisionOptions?.find(
        item => item.id === record.recommendationDetail?.optionId,
    );
    if (
        currentSpineVersionId
        && record.decisionOptionsProvenance?.sourceSpineVersionId !== currentSpineVersionId
    ) return;
    if (!expectedStatus || !expectedRecommendationIdentity || !option) return;
    return {
        recordId: record.id,
        action: 'accept_recommendation',
        expectedStatus,
        expectedTargetHash: batchVerdictTargetHash(record, 'accept_recommendation'),
        expectedSpineVersionId: currentSpineVersionId,
        expectedRecommendationIdentity,
        optionId: option.id,
        answer: option.label,
    };
}

export function assumptionDefaultBatchCandidate(
    record: PlanningRecord,
    currentSpineVersionId?: string,
): AssumptionDefaultBatchCandidate | undefined {
    const expectedStatus = openStatus(record);
    const answer = presentedDefault(record);
    if (record.type !== 'assumption' || !expectedStatus || !answer) return;
    return {
        recordId: record.id,
        action: 'accept_default',
        expectedStatus,
        answer,
        expectedTargetHash: batchVerdictTargetHash(record, 'accept_default'),
        expectedSpineVersionId: currentSpineVersionId,
    };
}

export function deferBatchCandidate(
    record: PlanningRecord,
    currentSpineVersionId?: string,
): DeferBatchCandidate | undefined {
    const expectedStatus = openStatus(record);
    if (!expectedStatus) return;
    return {
        recordId: record.id,
        action: 'defer',
        expectedStatus,
        expectedTargetHash: batchVerdictTargetHash(record, 'defer'),
        expectedSpineVersionId: currentSpineVersionId,
    };
}

export function revalidateBatchVerdictCandidate(
    record: PlanningRecord | undefined,
    candidate: BatchVerdictCandidate,
): { ok: true } | { ok: false; reason: string } {
    if (!record) {
        return { ok: false, reason: 'The planning record is no longer available.' };
    }
    if (record.id !== candidate.recordId || openStatus(record) !== candidate.expectedStatus) {
        return {
            ok: false,
            reason: 'The planning record was already answered or changed.',
        };
    }
    if (candidate.action === 'accept_recommendation') {
        const currentIdentity = recommendationIdentity(record);
        const currentOption = record.decisionOptions?.find(
            item => item.id === record.recommendationDetail?.optionId,
        );
        if (
            !currentOption
            || candidate.expectedRecommendationIdentity !== currentIdentity
            || candidate.optionId !== currentOption.id
            || candidate.answer !== currentOption.label
        ) {
            return {
                ok: false,
                reason: 'The recommendation changed before it could be accepted.',
            };
        }
    }
    if (
        candidate.action === 'accept_default'
        && candidate.answer !== presentedDefault(record)
    ) {
        return {
            ok: false,
            reason: 'The planning record changed before the batch action completed.',
        };
    }
    if (batchVerdictTargetHash(record, candidate.action) !== candidate.expectedTargetHash) {
        return {
            ok: false,
            reason: candidate.action === 'accept_recommendation'
                ? 'The recommendation changed before it could be accepted.'
                : 'The planning record changed before the batch action completed.',
        };
    }
    return { ok: true };
}
